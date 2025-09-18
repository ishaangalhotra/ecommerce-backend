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
// Old middleware is removed as it's no longer needed
// const { authorize } = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/email');
const { sendSMS } = require('../utils/sms');
const { processPayment, createRefund } = require('../utils/payment');
const { calculateDeliveryFee, estimateDeliveryTime } = require('../utils/delivery');
const { generateInvoice } = require('../utils/invoice');
const logger = require('../utils/logger');
const redis = require('../config/redis');

// Safe Socket.IO import - prevents crashes if not properly set up
let io = null;
try {
  const app = require('../app');
  io = app.io;
} catch (error) {
  console.log('Socket.IO not available, real-time features are disabled.');
}

const router = express.Router();

// Order Rate Limiter - prevents abuse
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: 'Too many order requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});


/**
 * @route   POST /api/v1/orders/create
 * @desc    Create a new order from the user's cart
 * @access  Private (User)
 */
router.post('/create', orderLimiter, hybridProtect, async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      addressId,
      paymentMethod,
      couponCode,
      notes
    } = req.body;

    const cart = await Cart.findOne({
      user: userId
    }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty.'
      });
    }

    const user = await User.findById(userId).populate('addresses');
    const selectedAddress = user.addresses.find(addr => addr._id.toString() === addressId);
    if (!selectedAddress) {
      return res.status(404).json({
        success: false,
        message: 'Address not found.'
      });
    }

    let subtotal = cart.items.reduce((acc, item) => acc + (item.product.price * item.quantity), 0);
    let discount = 0;
    let coupon = null;

    if (couponCode) {
      try {
        const couponResult = await applyCoupon(couponCode, subtotal);
        discount = couponResult.discount;
        coupon = couponResult.coupon;
        subtotal -= discount;
      } catch (error) {
        logger.warn('Coupon application failed', {
          userId,
          couponCode,
          error: error.message
        });
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
    }

    const deliveryFee = calculateDeliveryFee(selectedAddress.pinCode);
    const totalAmount = subtotal + deliveryFee;

    const order = new Order({
      user: userId,
      items: cart.items.map(item => ({
        product: item.product._id,
        quantity: item.quantity,
        price: item.product.price,
        // snapshot product data for historical record
        snapshot: {
          name: item.product.name,
          images: item.product.images,
          brand: item.product.brand
        }
      })),
      shippingAddress: selectedAddress,
      totalAmount,
      deliveryFee,
      discount,
      couponCode: coupon?.code,
      paymentMethod,
      orderStatus: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      notes,
      estimatedDelivery: estimateDeliveryTime()
    });

    await order.save();

    await Cart.findByIdAndUpdate(cart._id, {
      $set: {
        items: []
      }
    });

    // Handle payment processing (asynchronous)
    if (paymentMethod === 'card') {
      processPayment(order, req.body.paymentInfo)
        .then(async result => {
          if (result.success) {
            order.paymentStatus = PaymentStatus.PAID;
            order.orderStatus = OrderStatus.CONFIRMED;
            await order.save();
            // Emit confirmation event via socket
            io?.to(userId.toString()).emit('order_confirmed', {
              orderId: order._id
            });
            sendEmail({
              to: user.email,
              subject: 'Your Order is Confirmed!',
              html: 'Thank you for your order. We have received your payment and your order is confirmed.'
            });
            sendSMS(user.phone, `Your QuickLocal order #${order._id} is confirmed.`);
          } else {
            order.paymentStatus = PaymentStatus.FAILED;
            await order.save();
            io?.to(userId.toString()).emit('order_failed', {
              orderId: order._id,
              message: result.message
            });
            sendEmail({
              to: user.email,
              subject: 'Order Payment Failed',
              html: `There was an issue processing your payment. Your order #${order._id} has been saved as pending.`
            });
          }
        })
        .catch(async err => {
          logger.error('Payment processing failed', err);
          order.paymentStatus = PaymentStatus.FAILED;
          await order.save();
        });
    } else {
      // For COD, mark as confirmed immediately
      order.orderStatus = OrderStatus.CONFIRMED;
      await order.save();
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      orderId: order._id,
      paymentStatus: order.paymentStatus
    });

  } catch (error) {
    logger.error('Order creation failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order. Please try again later.'
    });
  }
});


/**
 * @route   GET /api/v1/orders
 * @desc    Get user's own orders
 * @access  Private (User)
 */
router.get('/', hybridProtect, async (req, res) => {
  try {
    const userId = req.user._id;
    const orders = await Order.find({
        user: userId
      })
      .sort({
        createdAt: -1
      })
      .populate('items.product', 'name images'); // Populate with a select subset of product data
    res.json({
      success: true,
      orders
    });
  } catch (error) {
    logger.error('Failed to get orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve orders.'
    });
  }
});

/**
 * @route   GET /api/v1/orders/:orderId
 * @desc    Get a single order by ID
 * @access  Private (User)
 */
router.get('/:orderId', hybridProtect, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      user: req.user._id
    }).populate('items.product');
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.'
      });
    }
    res.json({
      success: true,
      order
    });
  } catch (error) {
    logger.error('Failed to get order details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve order details.'
    });
  }
});

/**
 * @route   PATCH /api/v1/orders/:orderId/cancel
 * @desc    Cancel a pending order
 * @access  Private (User)
 */
router.patch('/:orderId/cancel', hybridProtect, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      user: req.user._id
    });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.'
      });
    }
    if (order.orderStatus !== OrderStatus.PENDING && order.orderStatus !== OrderStatus.CONFIRMED) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled at this stage.'
      });
    }

    order.orderStatus = OrderStatus.CANCELLED;
    order.cancelledAt = new Date();
    await order.save();

    // If order was paid, initiate a refund
    if (order.paymentStatus === PaymentStatus.PAID) {
      createRefund(order.paymentId, order.totalAmount)
        .then(() => {
          order.paymentStatus = PaymentStatus.REFUNDED;
          order.save();
          io?.to(req.user._id.toString()).emit('order_refunded', {
            orderId: order._id
          });
          sendEmail({
            to: req.user.email,
            subject: 'Order Cancelled & Refunded',
            html: `Your order #${order._id} has been cancelled and a refund has been initiated.`
          });
        })
        .catch(err => {
          logger.error('Refund initiation failed', err);
          sendEmail({
            to: req.user.email,
            subject: 'Order Cancelled - Refund Failed',
            html: `Your order #${order._id} has been cancelled, but we faced an issue with your refund. Please contact support.`
          });
        });
    } else {
      io?.to(req.user._id.toString()).emit('order_cancelled', {
        orderId: order._id
      });
      sendEmail({
        to: req.user.email,
        subject: 'Order Cancelled',
        html: `Your order #${order._id} has been cancelled successfully.`
      });
    }
    res.json({
      success: true,
      message: 'Order has been cancelled.',
      order
    });
  } catch (error) {
    logger.error('Failed to cancel order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order.'
    });
  }
});

// Mock utility functions for demonstration
function getMockTrackingData(orderId) {
  try {
    return {
      orderId,
      status: 'Out for delivery',
      location: {
        lat: 28.6139 + (Math.random() - 0.5) * 0.01,
        lng: 77.2090 + (Math.random() - 0.5) * 0.01
      },
      estimatedArrival: new Date(Date.now() + 15 * 60000), // 15 minutes
      distanceRemaining: Math.random() * 5 + 1 // 1-6 km
    };
  } catch (error) {
    logger.error('Get delivery tracking error:', error);
    return null;
  }
}

async function getDeliveryAgentLocation(agentId) {
  try {
    const cached = await redis.get(`agent:location:${agentId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  } catch (error) {
    logger.error('Get agent location error:', error);
    return null;
  }
}

async function applyCoupon(couponCode, subtotal) {
  // Mock coupon validation - implement with real coupon system
  const mockCoupons = {
    'SAVE10': {
      type: 'percentage',
      value: 10,
      minOrder: 100
    },
    'FLAT50': {
      type: 'fixed',
      value: 50,
      minOrder: 200
    },
    'FIRST20': {
      type: 'percentage',
      value: 20,
      minOrder: 0
    }
  };

  const coupon = mockCoupons[couponCode.toUpperCase()];
  if (!coupon) {
    throw new Error('Invalid coupon code');
  }

  if (subtotal < coupon.minOrder) {
    throw new Error(`Minimum order amount ₹${coupon.minOrder} required.`);
  }

  let discountAmount = 0;
  if (coupon.type === 'percentage') {
    discountAmount = subtotal * (coupon.value / 100);
  } else if (coupon.type === 'fixed') {
    discountAmount = coupon.value;
  }

  return {
    discount: discountAmount,
    coupon
  };
}

module.exports = router;