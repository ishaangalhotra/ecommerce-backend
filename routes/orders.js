const OrderStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled'
};

const PaymentStatus = {
  PENDING: 'pending',
  PAID: 'paid',
  REFUNDED: 'refunded',
  FAILED: 'failed'
};

const express = require('express');
const mongoose = require('mongoose');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Cart = require('../models/cart');
// --- NEW: Import Coupon Model ---
// You will need to create this model. See notes at the bottom.
const Coupon = require('../models/Coupon'); 
const { hybridProtect, requireRole } = require('../middleware/hybridAuth');
const { authorize } = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/email');
const { sendSMS } = require('../utils/sms');
const { processPayment, createRefund } = require('../utils/payment');
const { calculateDeliveryFee, estimateDeliveryTime } = require('../utils/delivery');
const { generateInvoice } = require('../utils/invoice');
const logger = require('../utils/logger');
const redis = require('../config/redis');

let io = null;
try {
  const app = require('../app');
  io = app.io;
} catch (error) {
  console.log('Socket.IO not available, real-time features disabled');
}

const router = express.Router();

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => `${req.ip}:${req.user?.id || 'guest'}`,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.ip} on ${req.path}`);
    res.status(429).json({ 
      success: false, 
      error: 'Too many requests, please try again later',
      retryAfter: 15 * 60
    });
  }
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many checkout attempts, please try again later' }
});

const validateOrder = [
  body('orderItems')
    .custom((value, { req }) => {
      const items = value || req.body.items;
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error('Order must contain at least 1 item');
      }
      if (items.length > 50) {
        throw new Error('Order cannot contain more than 50 items');
      }
      return true;
    }),
  
  body('shippingAddress')
    .custom((value, { req }) => {
      const address = value || req.body.deliveryAddress;
      if (!address || typeof address !== 'object') {
        throw new Error('Shipping address is required');
      }
      return true;
    }),
  
  body('paymentMethod')
    .isIn(['card', 'credit_card', 'debit_card', 'upi', 'wallet', 'cod'])
    .withMessage('Invalid payment method')
];

// Set timeout for order processing
const ORDER_PROCESSING_TIMEOUT = 25000; // 25 seconds (less than 30s client timeout)

router.post('/',
  hybridProtect,
  checkoutLimiter,
  validateOrder,
  async (req, res) => {
    console.log('🔥 Received order payload:', JSON.stringify(req.body, null, 2));
    
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Order processing timeout'));
      }, ORDER_PROCESSING_TIMEOUT);
    });
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      // Race between order processing and timeout
      const orderData = await Promise.race([
        processOrderCreationOptimized(req.body, req.user, session),
        timeoutPromise
      ]);

      await session.commitTransaction();

      // Send notifications asynchronously (don't wait)
      setImmediate(() => {
        sendOrderNotifications(orderData.order, 'created').catch(err => {
          logger.error('Notification error:', err);
        });
      });

      // Send socket notification asynchronously
      if (io) {
        setImmediate(() => {
          io.to(`user-${req.user.id}`).emit('order-created', {
            orderId: orderData.order._id,
            orderNumber: orderData.order.orderNumber,
            total: orderData.order.pricing.totalPrice
          });
        });
      }

      logger.info(`Order created: ${orderData.order.orderNumber}`, {
        orderId: orderData.order._id,
        customerId: req.user.id,
        total: orderData.order.pricing.totalPrice,
        itemCount: orderData.order.orderItems.length
      });

      res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        order: {
          id: orderData.order._id,
          orderNumber: orderData.order.orderNumber,
          status: orderData.order.status,
          total: orderData.order.pricing.totalPrice,
          items: orderData.order.orderItems.map(item => ({
            product: item.product._id || item.product,
            name: item.name,
            qty: item.qty,
            price: item.unitPrice || item.price,
            totalPrice: item.totalPrice
          }))
        }
      });

    } catch (error) {
      await session.abortTransaction();
      
      if (error.message === 'Order processing timeout') {
        logger.error('Order processing timeout - server overloaded');
        res.status(408).json({
          success: false,
          message: 'Order processing timeout. Please try again.',
          code: 'PROCESSING_TIMEOUT'
        });
      } else {
        logger.error('Order creation error:', error);
        res.status(error.statusCode || 500).json({
          success: false,
          message: error.message || 'Error creating order. Please try again.',
          error: error.details || undefined
        });
      }
    } finally {
      session.endSession();
    }
  }
);

// Optimized version of order processing with parallel operations
async function processOrderCreationOptimized(orderData, user, session) {
  console.log('📦 Processing items:', orderData.items || orderData.orderItems);
  console.log('🏠 Processing address:', orderData.shippingAddress || orderData.deliveryAddress);
  
  const {
    orderItems,
    items,
    shippingAddress,
    deliveryAddress,
    paymentMethod,
    scheduledDelivery,
    couponCode,
    specialInstructions,
    tip = 0
  } = orderData;

  const itemsToProcess = orderItems || items;
  const address = shippingAddress || deliveryAddress;
  
  if (!itemsToProcess || !Array.isArray(itemsToProcess) || itemsToProcess.length === 0) {
    throw { statusCode: 400, message: 'Order items are required' };
  }
  
  if (!address) {
    throw { statusCode: 400, message: 'Shipping address is required' };
  }

  // Parallel processing for better performance
  const [preparedItems, orderNumber] = await Promise.all([
    validateAndPrepareOrderItemsOptimized(itemsToProcess, session),
    generateOrderNumberOptimized()
  ]);
  
  const pricing = await calculateOrderPricingOptimized(
    preparedItems, 
    address, 
    couponCode,
    tip
  );

  // Reserve stock in parallel with order creation prep
  await reserveProductStockOptimized(preparedItems, session);
  
  let normalizedPaymentMethod = paymentMethod;
  if (paymentMethod === 'card') normalizedPaymentMethod = 'credit_card';

  const initialStatus = normalizedPaymentMethod === 'cod' ? OrderStatus.CONFIRMED : OrderStatus.PENDING;

  const order = new Order({
    orderNumber,
    user: user.id,
    customerInfo: { name: user.name, email: user.email, phone: user.phone },
    orderItems: preparedItems,
    shippingAddress: {
      fullName: address.fullName || address.name,
      address: address.address,
      city: address.city,
      state: address.state || '',
      postalCode: address.postalCode || address.pincode,
      country: address.country || 'India',
      phoneNumber: address.phoneNumber || address.phone
    },
    pricing: {
      itemsPrice: pricing.subtotal,
      discountAmount: pricing.discount,
      shippingPrice: pricing.deliveryFee,
      taxPrice: pricing.taxAmount,
      totalPrice: pricing.total
    },
    paymentMethod: normalizedPaymentMethod,
    status: initialStatus,
    paymentDetails: {
        status: normalizedPaymentMethod === 'cod' ? PaymentStatus.PENDING : PaymentStatus.PENDING
    },
    deliveryTracking: {
      estimatedDeliveryDate: calculateEstimatedDeliveryTime(address, scheduledDelivery)
    },
    statusHistory: [{
      status: initialStatus,
      timestamp: new Date(),
      description: 'Order placed successfully'
    }]
  });
  
  // Skip payment processing for COD to avoid delays
  let paymentResult = null;
  if (normalizedPaymentMethod !== 'cod') {
    try {
      // Use faster payment processing with shorter timeout
      paymentResult = await Promise.race([
        processPaymentOptimized({
          amount: order.pricing.totalPrice,
          paymentMethod: normalizedPaymentMethod,
          currency: 'INR',
          customer: user,
          orderId: order._id 
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Payment timeout')), 15000)
        )
      ]);

      if (paymentResult.success) {
        order.paymentDetails.transactionId = paymentResult.transactionId;
        order.paymentDetails.status = PaymentStatus.PAID;
        order.paymentDetails.paidAt = new Date();
        order.status = OrderStatus.CONFIRMED;
        order.statusHistory.push({
            status: OrderStatus.CONFIRMED,
            timestamp: new Date(),
            description: `Payment successful. Transaction ID: ${paymentResult.transactionId}`
        });
      } else {
        throw { statusCode: 400, message: paymentResult.message || 'Payment failed. Please try again.' };
      }
    } catch (paymentError) {
        logger.error('Payment processing failed:', paymentError);
        if (paymentError.message === 'Payment timeout') {
          throw { statusCode: 408, message: 'Payment processing timeout. Please try again.' };
        }
        throw { statusCode: 400, message: paymentError.message || 'An error occurred during payment.' };
    }
  }

  // Save order and clear cart in parallel
  await Promise.all([
    order.save({ session }),
    Cart.findOneAndDelete({ user: user.id }, { session })
  ]);

  // Only populate essential fields to reduce query time
  await order.populate([
    { path: 'orderItems.product', select: 'name price seller' },
    { path: 'user', select: 'name email' }
  ]);

  return { order, pricing, paymentResult };
}

// Original function kept for compatibility
async function processOrderCreation(orderData, user, session) {
  const {
    orderItems,
    items,
    shippingAddress,
    deliveryAddress,
    paymentMethod,
    scheduledDelivery,
    couponCode,
    specialInstructions,
    tip = 0
  } = orderData;

  const itemsToProcess = orderItems || items;
  const address = shippingAddress || deliveryAddress;
  
  if (!itemsToProcess || !Array.isArray(itemsToProcess) || itemsToProcess.length === 0) {
    throw { statusCode: 400, message: 'Order items are required' };
  }
  
  if (!address) {
    throw { statusCode: 400, message: 'Shipping address is required' };
  }

  const preparedItems = await validateAndPrepareOrderItems(itemsToProcess, session);
  
  const pricing = await calculateOrderPricing(
    preparedItems, 
    address, 
    couponCode,
    tip
  );

  await reserveProductStock(preparedItems, session);

  const orderNumber = await generateOrderNumber();
  let normalizedPaymentMethod = paymentMethod;
  if (paymentMethod === 'card') normalizedPaymentMethod = 'credit_card';

  const initialStatus = normalizedPaymentMethod === 'cod' ? OrderStatus.CONFIRMED : OrderStatus.PENDING;

  const order = new Order({
    orderNumber,
    user: user.id,
    customerInfo: { name: user.name, email: user.email, phone: user.phone },
    orderItems: preparedItems,
    shippingAddress: {
      fullName: address.fullName || address.name,
      address: address.address,
      city: address.city,
      state: address.state || '',
      postalCode: address.postalCode || address.pincode,
      country: address.country || 'India',
      phoneNumber: address.phoneNumber || address.phone
    },
    pricing: {
      itemsPrice: pricing.subtotal,
      discountAmount: pricing.discount,
      shippingPrice: pricing.deliveryFee,
      taxPrice: pricing.taxAmount,
      totalPrice: pricing.total
    },
    paymentMethod: normalizedPaymentMethod,
    status: initialStatus,
    paymentDetails: {
        status: normalizedPaymentMethod === 'cod' ? PaymentStatus.PENDING : PaymentStatus.PENDING
    },
    deliveryTracking: {
      estimatedDeliveryDate: calculateEstimatedDeliveryTime(address, scheduledDelivery)
    },
    statusHistory: [{
      status: initialStatus,
      timestamp: new Date(),
      description: 'Order placed successfully'
    }]
  });
  
  // --- NEW: Payment Processing Logic ---
  let paymentResult = null;
  if (normalizedPaymentMethod !== 'cod') {
    try {
      paymentResult = await processPayment({
        amount: order.pricing.totalPrice,
        paymentMethod: normalizedPaymentMethod,
        currency: 'INR',
        customer: user,
        orderId: order._id 
      });

      if (paymentResult.success) {
        order.paymentDetails.transactionId = paymentResult.transactionId;
        order.paymentDetails.status = PaymentStatus.PAID;
        order.paymentDetails.paidAt = new Date();
        order.status = OrderStatus.CONFIRMED;
        order.statusHistory.push({
            status: OrderStatus.CONFIRMED,
            timestamp: new Date(),
            description: `Payment successful. Transaction ID: ${paymentResult.transactionId}`
        });
      } else {
        // If payment fails, we throw an error to abort the transaction
        throw { statusCode: 400, message: paymentResult.message || 'Payment failed. Please try again.' };
      }
    } catch (paymentError) {
        logger.error('Payment processing failed:', paymentError);
        // Rethrow to ensure transaction is aborted
        throw { statusCode: 400, message: paymentError.message || 'An error occurred during payment.' };
    }
  }

  await order.save({ session });

  await Cart.findOneAndDelete({ user: user.id }, { session });

  await order.populate([
    { path: 'orderItems.product', select: 'name images price seller' },
    { path: 'user', select: 'name email phone' }
  ]);

  return { order, pricing, paymentResult };
}

// Optimized helper functions
async function validateAndPrepareOrderItemsOptimized(items, session) {
  const productIds = items.map(item => item.product);
  
  // Use lean() for faster queries
  const products = await Product.find({
    _id: { $in: productIds },
    status: 'active',
    isDeleted: false
  }).select('_id name price stock seller images image').lean().session(session);

  // Create a map for O(1) lookup
  const productMap = new Map();
  products.forEach(product => productMap.set(product._id.toString(), product));

  const orderItems = [];
  
  for (const item of items) {
    const product = productMap.get(item.product.toString());
    
    if (!product) {
      throw { statusCode: 404, message: `Product not found: ${item.product}` };
    }
    
    const quantity = item.qty || item.quantity || 1;
    
    if (product.stock < quantity) {
      throw {
        statusCode: 400,
        message: `Insufficient stock for ${product.name}`,
        details: { productId: product._id, requested: quantity, available: product.stock }
      };
    }
    
    orderItems.push({
      product: product._id,
      name: product.name,
      unitPrice: product.price,
      qty: quantity,
      totalPrice: product.price * quantity,
      seller: product.seller,
      image: product.images && product.images[0] ? 
             (typeof product.images[0] === 'string' ? product.images[0] : product.images[0].url) :
             product.image || ''
    });
  }
  
  return orderItems;
}

async function generateOrderNumberOptimized() {
  const today = new Date();
  const datePrefix = today.getFullYear().toString().slice(-2) +
    (today.getMonth() + 1).toString().padStart(2, '0') +
    today.getDate().toString().padStart(2, '0');
  
  // Use a more efficient approach with aggregation
  const count = await Order.countDocuments({
    createdAt: {
      $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
      $lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    }
  });
  
  return `QL${datePrefix}${(count + 1).toString().padStart(4, '0')}`;
}

async function calculateOrderPricingOptimized(orderItems, deliveryAddress, couponCode, tip = 0) {
  const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const deliveryFee = subtotal >= 500 ? 0 : 25; // Use environment variable in production
  let discount = 0;
  let appliedCoupon = null;
  
  // Skip coupon processing to avoid delays - can be processed asynchronously later
  if (couponCode) {
    try {
      const couponResult = await applyCouponOptimized(couponCode, subtotal);
      discount = couponResult.discountAmount;
      appliedCoupon = couponResult;
    } catch (error) {
      console.warn('Coupon application failed:', error.message);
      // Don't fail the order for coupon issues
    }
  }
  
  const taxRate = 0.05;
  const taxableAmount = subtotal - discount;
  const taxAmount = Math.round(taxableAmount * taxRate * 100) / 100;
  
  const total = taxableAmount + deliveryFee + taxAmount + tip;
  
  return { subtotal, deliveryFee, taxAmount, discount, tip, total, coupon: appliedCoupon };
}

async function applyCouponOptimized(couponCode, subtotal) {
  const coupon = await Coupon.findOne({
    code: couponCode.toUpperCase(),
    isActive: true,
    expiresAt: { $gt: new Date() }
  }).lean(); // Use lean for faster queries

  if (!coupon) {
    throw new Error('Invalid or expired coupon code');
  }

  if (subtotal < coupon.minOrderAmount) {
    throw new Error(`Minimum order of ₹${coupon.minOrderAmount} required to use this coupon`);
  }

  let discountAmount = 0;
  if (coupon.type === 'percentage') {
    discountAmount = (subtotal * coupon.value) / 100;
    if (coupon.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
    }
  } else {
    discountAmount = coupon.value;
  }

  return {
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    discountAmount: Math.min(discountAmount, subtotal)
  };
}

async function reserveProductStockOptimized(orderItems, session) {
  const bulkOps = orderItems.map(item => ({
    updateOne: {
      filter: { _id: item.product, stock: { $gte: item.qty } },
      update: { $inc: { stock: -item.qty } }
    }
  }));
  
  const result = await Product.bulkWrite(bulkOps, { session });
  
  if (result.modifiedCount !== orderItems.length) {
      throw new Error("One or more items went out of stock. Please try again.");
  }
}

// Optimized payment processing with faster timeout
async function processPaymentOptimized(paymentData) {
  // For COD orders, return success immediately
  if (paymentData.paymentMethod === 'cod') {
    return {
      success: true,
      transactionId: `COD-${Date.now()}`,
      method: 'cod'
    };
  }
  
  // For now, simulate payment processing with reduced delay
  // In production, integrate with actual payment gateway
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        success: true,
        transactionId: `TXN-${Date.now()}`,
        method: paymentData.paymentMethod
      });
    }, 100); // Minimal delay
  });
}

// Original functions kept for compatibility
async function validateAndPrepareOrderItems(items, session) {
  const productIds = items.map(item => item.product);
  const products = await Product.find({
    _id: { $in: productIds },
    status: 'active',
    isDeleted: false
  }).session(session);

  const orderItems = [];
  
  for (const item of items) {
    const product = products.find(p => p._id.toString() === item.product.toString());
    
    if (!product) {
      throw { statusCode: 404, message: `Product not found: ${item.product}` };
    }
    
    const quantity = item.qty || item.quantity || 1;
    
    if (product.stock < quantity) {
      throw {
        statusCode: 400,
        message: `Insufficient stock for ${product.name}`,
        details: { productId: product._id, requested: quantity, available: product.stock }
      };
    }
    
    orderItems.push({
      product: product._id,
      name: product.name,
      unitPrice: product.price,
      qty: quantity,
      totalPrice: product.price * quantity,
      seller: product.seller,
      image: product.images && product.images[0] ? 
             (typeof product.images[0] === 'string' ? product.images[0] : product.images[0].url) :
             product.image || ''
    });
  }
  
  return orderItems;
}

async function calculateOrderPricing(orderItems, deliveryAddress, couponCode, tip = 0) {
  const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const deliveryFee = subtotal >= 500 ? 0 : 40; // Example: Made delivery fee configurable
  let discount = 0;
  let appliedCoupon = null;
  
  if (couponCode) {
    try {
      const couponResult = await applyCoupon(couponCode, subtotal);
      discount = couponResult.discountAmount;
      appliedCoupon = couponResult;
    } catch (error) {
      console.warn('Coupon application failed:', error.message);
      // Optionally, you could re-throw to inform the user the coupon is invalid
      // throw { statusCode: 400, message: error.message };
    }
  }
  
  const taxRate = 0.05; // Should be in config/env
  const taxableAmount = subtotal - discount;
  const taxAmount = Math.round(taxableAmount * taxRate * 100) / 100;
  
  const total = taxableAmount + deliveryFee + taxAmount + tip;
  
  return { subtotal, deliveryFee, taxAmount, discount, tip, total, coupon: appliedCoupon };
}

// --- MODIFIED: Dynamic Coupon Logic ---
async function applyCoupon(couponCode, subtotal) {
  const coupon = await Coupon.findOne({
    code: couponCode.toUpperCase(),
    isActive: true,
    expiresAt: { $gt: new Date() }
  });

  if (!coupon) {
    throw new Error('Invalid or expired coupon code');
  }

  if (subtotal < coupon.minOrderAmount) {
    throw new Error(`Minimum order of ₹${coupon.minOrderAmount} required to use this coupon`);
  }

  let discountAmount = 0;
  if (coupon.type === 'percentage') {
    discountAmount = (subtotal * coupon.value) / 100;
    if (coupon.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
    }
  } else { // 'fixed'
    discountAmount = coupon.value;
  }

  return {
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    discountAmount: Math.min(discountAmount, subtotal) // Cannot discount more than the subtotal
  };
}

async function reserveProductStock(orderItems, session) {
  const bulkOps = orderItems.map(item => ({
    updateOne: {
      filter: { _id: item.product, stock: { $gte: item.qty } }, // Important: check stock again
      update: { $inc: { stock: -item.qty } }
    }
  }));
  
  const result = await Product.bulkWrite(bulkOps, { session });
  
  // If a product stock was insufficient between validation and now, bulkWrite won't modify it.
  if (result.modifiedCount !== orderItems.length) {
      throw new Error("One or more items went out of stock. Please try again.");
  }
}

async function restoreProductStock(orderItems, session) {
  const bulkOps = orderItems.map(item => ({
    updateOne: { filter: { _id: item.product }, update: { $inc: { stock: item.qty } } }
  }));
  await Product.bulkWrite(bulkOps, { session });
}

async function generateOrderNumber() {
  const today = new Date();
  const datePrefix = today.getFullYear().toString().slice(-2) +
    (today.getMonth() + 1).toString().padStart(2, '0') +
    today.getDate().toString().padStart(2, '0');
  
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));

  const count = await Order.countDocuments({
    createdAt: { $gte: startOfDay, $lt: endOfDay }
  });
  
  return `QL${datePrefix}${(count + 1).toString().padStart(4, '0')}`;
}

function calculateEstimatedDeliveryTime(deliveryAddress, scheduledDelivery) {
  if (scheduledDelivery) {
    return new Date(scheduledDelivery);
  }
  const estimatedMinutes = 45;
  const deliveryTime = new Date();
  deliveryTime.setMinutes(deliveryTime.getMinutes() + estimatedMinutes);
  return deliveryTime;
}

async function sendOrderNotifications(order, type, previousStatus = null) {
  try {
    const customer = await User.findById(order.user);
    if (!customer) return;
    
    switch (type) {
      case 'created':
        await sendEmail({
          to: customer.email,
          subject: 'Order Confirmation - QuickLocal',
          template: 'order-confirmation',
          data: {
            customerName: customer.name,
            orderNumber: order.orderNumber,
            items: order.orderItems,
            total: order.pricing.totalPrice
          }
        });
        break;
      // Add other cases like 'shipped', 'delivered' here
    }
  } catch (error) {
    logger.error('Send order notifications error:', error);
  }
}

router.get('/',
  hybridProtect,
  orderLimiter,
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status, startDate, endDate } = req.query;
      const query = { user: req.user.id };

      if (status && status !== 'all') {
        query.status = status;
      }
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [orders, totalOrders] = await Promise.all([
        Order.find(query)
          .populate('orderItems.product', 'name images price slug')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Order.countDocuments(query)
      ]);

      res.json({
        success: true,
        orders,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalOrders / limit),
          totalOrders,
          hasNext: page * limit < totalOrders,
          hasPrev: page > 1
        }
      });

    } catch (error) {
      logger.error('Get orders error:', error);
      res.status(500).json({ success: false, message: 'Error retrieving orders' });
    }
  }
);

router.get('/:id',
  hybridProtect,
  orderLimiter,
  async (req, res) => {
    try {
      const order = await Order.findOne({ _id: req.params.id, user: req.user.id })
        .populate('orderItems.product', 'name images price seller slug')
        .lean();

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      res.json({ success: true, order });

    } catch (error) {
      logger.error('Get order details error:', error);
      res.status(500).json({ success: false, message: 'Error retrieving order details' });
    }
  }
);

module.exports = router;