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
      // Accept both 'orderItems' and 'items'
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
      // Accept both 'shippingAddress' and 'deliveryAddress'
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

router.post('/',
  hybridProtect,
  checkoutLimiter,
  validateOrder,
  async (req, res) => {
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

      console.log('ðŸ“¥ Received order payload:', JSON.stringify(req.body, null, 2));

      const orderData = await processOrderCreation(req.body, req.user, session);

      await session.commitTransaction();

      sendOrderNotifications(orderData.order, 'created');

      if (io) {
        io.to(`user-${req.user.id}`).emit('order-created', {
          orderId: orderData.order._id,
          orderNumber: orderData.order.orderNumber,
          total: orderData.order.pricing.totalPrice
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
            product: item.product._id,
            name: item.name,
            qty: item.qty,
            price: item.unitPrice || item.price,
            totalPrice: item.totalPrice
          }))
        }
      });

    } catch (error) {
      await session.abortTransaction();
      logger.error('Order creation error:', error);
      
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Error creating order. Please try again.',
        error: error.details || undefined
      });
    } finally {
      session.endSession();
    }
  }
);

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

  // Accept both field names
  const itemsToProcess = orderItems || items;
  const address = shippingAddress || deliveryAddress;
  
  if (!itemsToProcess || !Array.isArray(itemsToProcess) || itemsToProcess.length === 0) {
    throw {
      statusCode: 400,
      message: 'Order items are required'
    };
  }
  
  if (!address) {
    throw {
      statusCode: 400,
      message: 'Shipping address is required'
    };
  }

  console.log('ðŸ“¦ Processing items:', itemsToProcess);
  console.log('ðŸ“ Processing address:', address);

  const preparedItems = await validateAndPrepareOrderItems(itemsToProcess, session);
  
  const pricing = await calculateOrderPricing(
    preparedItems, 
    address, 
    couponCode,
    tip
  );

  await reserveProductStock(preparedItems, session);

  const orderNumber = await generateOrderNumber();

  // Normalize payment method
  let normalizedPaymentMethod = paymentMethod;
  if (paymentMethod === 'card') normalizedPaymentMethod = 'credit_card';

  const order = new Order({
    orderNumber,
    user: user.id,
    customerInfo: {
      name: user.name,
      email: user.email,
      phone: user.phone
    },
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
    status: 'pending',
    isPaid: normalizedPaymentMethod !== 'cod',
    deliveryTracking: {
      estimatedDeliveryDate: calculateEstimatedDeliveryTime(address, scheduledDelivery)
    },
    statusHistory: [{
      status: 'pending',
      timestamp: new Date(),
      description: 'Order placed successfully'
    }]
  });

  await order.save({ session });

  let paymentResult = null;
  if (normalizedPaymentMethod !== 'cod') {
    // Payment processing logic here
  }

  await Cart.findOneAndDelete({ user: user.id }, { session });

  await order.populate([
    { path: 'orderItems.product', select: 'name images price seller' },
    { path: 'user', select: 'name email phone' }
  ]);

  return { order, pricing, paymentResult };
}

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
      throw {
        statusCode: 404,
        message: `Product not found: ${item.product}`
      };
    }
    
    const quantity = item.qty || item.quantity || 1;
    
    if (product.stock < quantity) {
      throw {
        statusCode: 400,
        message: `Insufficient stock for ${product.name}`,
        details: {
          productId: product._id,
          requested: quantity,
          available: product.stock
        }
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
  
  const deliveryFee = subtotal >= 500 ? 0 : 25;
  
  let discount = 0;
  let coupon = null;
  
  if (couponCode) {
    try {
      coupon = await applyCoupon(couponCode, subtotal);
      discount = coupon.discountAmount;
    } catch (error) {
      console.warn('Coupon application failed:', error.message);
    }
  }
  
  const taxRate = 0.05;
  const taxAmount = Math.round((subtotal - discount) * taxRate * 100) / 100;
  
  const total = subtotal + deliveryFee + taxAmount + tip - discount;
  
  return {
    subtotal,
    deliveryFee,
    taxAmount,
    discount,
    tip,
    total,
    coupon
  };
}

async function reserveProductStock(orderItems, session) {
  const bulkOps = orderItems.map(item => ({
    updateOne: {
      filter: { _id: item.product },
      update: { $inc: { stock: -item.qty } }
    }
  }));
  
  await Product.bulkWrite(bulkOps, { session });
}

async function restoreProductStock(orderItems, session) {
  const bulkOps = orderItems.map(item => ({
    updateOne: {
      filter: { _id: item.product },
      update: { $inc: { stock: item.qty } }
    }
  }));
  
  await Product.bulkWrite(bulkOps, { session });
}

async function generateOrderNumber() {
  const today = new Date();
  const datePrefix = today.getFullYear().toString().slice(-2) +
    (today.getMonth() + 1).toString().padStart(2, '0') +
    today.getDate().toString().padStart(2, '0');
  
  const count = await Order.countDocuments({
    createdAt: {
      $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
      $lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    }
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
    }
  } catch (error) {
    logger.error('Send order notifications error:', error);
  }
}

async function applyCoupon(couponCode, subtotal) {
  const mockCoupons = {
    'SAVE10': { type: 'percentage', value: 10, minOrder: 100 },
    'FLAT50': { type: 'fixed', value: 50, minOrder: 200 },
    'FIRST20': { type: 'percentage', value: 20, minOrder: 0 }
  };
  
  const coupon = mockCoupons[couponCode.toUpperCase()];
  if (!coupon) {
    throw new Error('Invalid coupon code');
  }
  
  if (subtotal < coupon.minOrder) {
    throw new Error(`Minimum order amount â‚¹${coupon.minOrder} required`);
  }
  
  let discountAmount = 0;
  if (coupon.type === 'percentage') {
    discountAmount = (subtotal * coupon.value) / 100;
  } else {
    discountAmount = coupon.value;
  }
  
  return {
    code: couponCode,
    type: coupon.type,
    value: coupon.value,
    discountAmount: Math.min(discountAmount, subtotal)
  };
}

router.get('/',
  hybridProtect,
  orderLimiter,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        startDate,
        endDate
      } = req.query;

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
          .limit(limit)
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
      res.status(500).json({
        success: false,
        message: 'Error retrieving orders'
      });
    }
  }
);

router.get('/:id',
  hybridProtect,
  orderLimiter,
  async (req, res) => {
    try {
      const order = await Order.findOne({
        _id: req.params.id,
        user: req.user.id
      })
      .populate('orderItems.product', 'name images price seller slug')
      .lean();

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      res.json({
        success: true,
        order
      });

    } catch (error) {
      logger.error('Get order details error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving order details'
      });
    }
  }
);

module.exports = router;