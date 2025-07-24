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
const Cart = require('../models/Cart');
const { protect, authorize } = require('../middleware/authMiddleware');
const { sendEmail } = require('../utils/email');
const { sendSMS } = require('../utils/sms');
const { processPayment, createRefund } = require('../utils/payment');
const { calculateDeliveryFee, estimateDeliveryTime } = require('../utils/delivery');
const { generateInvoice } = require('../utils/invoice');
const logger = require('../utils/logger');
const redis = require('../config/redis');
const { io } = require('../server');
const router = express.Router();

// Enhanced rate limiting with Redis
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  keyGenerator: (req) => `${req.ip}:${req.user?.id || 'guest'}`,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.ip} on ${req.path}`);
    res.status(429).json({ 
      success: false, 
      error: 'Too many requests, please try again later',
      retryAfter: 15 * 60 // 15 minutes in seconds
    });
  }
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 checkout attempts per minute
  message: { error: 'Too many checkout attempts, please try again later' }
});

// Validation middleware with enhanced security
const validateOrder = [
  body('items')
    .isArray({ min: 1, max: 50 })
    .withMessage('Order must contain 1-50 items'),
  
  body('items.*.product')
    .isMongoId()
    .withMessage('Invalid product ID')
    .customSanitizer(value => mongoose.Types.ObjectId(value)),
  
  body('items.*.quantity')
    .isInt({ min: 1, max: 100 })
    .withMessage('Quantity must be between 1-100')
    .toInt(),
  
  body('deliveryAddress')
    .isObject()
    .withMessage('Delivery address is required'),
  
  body('deliveryAddress.street')
    .trim()
    .escape()
    .isLength({ min: 5, max: 200 })
    .withMessage('Street address must be 5-200 characters'),
  
  body('deliveryAddress.city')
    .trim()
    .escape()
    .isLength({ min: 2, max: 50 })
    .withMessage('City must be 2-50 characters'),
  
  body('deliveryAddress.pincode')
    .matches(/^[1-9][0-9]{5}$/)
    .withMessage('Invalid pincode format'),
  
  body('deliveryAddress.coordinates')
    .optional()
    .isArray({ min: 2, max: 2 })
    .withMessage('Coordinates must be [longitude, latitude]'),
  
  body('paymentMethod')
    .isIn(['card', 'upi', 'wallet', 'cod'])
    .withMessage('Invalid payment method'),
  
  body('scheduledDelivery')
    .optional()
    .isISO8601()
    .withMessage('Invalid scheduled delivery date')
    .custom(value => {
      const minDeliveryTime = new Date(Date.now() + 30 * 60000); // 30 minutes from now
      if (new Date(value) <= minDeliveryTime) {
        throw new Error('Scheduled delivery must be at least 30 minutes in future');
      }
      return true;
    }),
  
  body('couponCode')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 3, max: 20 })
    .withMessage('Invalid coupon code format'),
  
  body('specialInstructions')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 500 })
    .withMessage('Special instructions must be under 500 characters'),
  
  body('tip')
    .optional()
    .isFloat({ min: 0, max: 1000 })
    .withMessage('Tip must be between ₹0-1000')
    .toFloat()
];

const validateOrderUpdate = [
  body('status')
    .optional()
    .isIn(Object.values(OrderStatus))
    .withMessage('Invalid order status'),
  
  body('deliveryAgent')
    .optional()
    .isMongoId()
    .withMessage('Invalid delivery agent ID'),
  
  body('estimatedDeliveryTime')
    .optional()
    .isISO8601()
    .withMessage('Invalid estimated delivery time'),
  
  body('notes')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 1000 })
    .withMessage('Notes must be under 1000 characters')
];

const searchValidation = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Page must be 1-1000')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be 1-100')
    .toInt(),
  
  query('status')
    .optional()
    .isIn([...Object.values(OrderStatus), 'all'])
    .withMessage('Invalid status filter'),
  
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
  
  query('search')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 100 })
    .withMessage('Search query too long')
];

/**
 * @swagger
 * /orders:
 *   post:
 *     summary: Create a new order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderRequest'
 *     responses:
 *       201:
 *         description: Order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderResponse'
 */
router.post('/',
  protect,
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

      const orderData = await processOrderCreation(req.body, req.user, session);

      // Commit transaction
      await session.commitTransaction();

      // Send notifications (async)
      sendOrderNotifications(orderData.order, 'created');

      // Emit real-time event
      io.to(`user-${req.user.id}`).emit('order-created', {
        orderId: orderData.order._id,
        orderNumber: orderData.order.orderNumber,
        total: orderData.pricing.total
      });

      logger.info(`Order created: ${orderData.order.orderNumber}`, {
        orderId: orderData.order._id,
        customerId: req.user.id,
        total: orderData.pricing.total,
        itemCount: orderData.order.items.length
      });

      res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        order: formatOrderResponse(orderData.order, orderData.paymentResult)
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
    items,
    deliveryAddress,
    paymentMethod,
    scheduledDelivery,
    couponCode,
    specialInstructions,
    tip = 0
  } = orderData;

  // Validate and prepare order items
  const orderItems = await validateAndPrepareOrderItems(items, session);
  
  // Calculate order totals
  const pricing = await calculateOrderPricing(
    orderItems, 
    deliveryAddress, 
    couponCode,
    tip
  );

  // Check product availability and reserve stock
  await reserveProductStock(orderItems, session);

  // Generate order number
  const orderNumber = await generateOrderNumber();

  // Create order
  const order = new Order({
    orderNumber,
    customer: user.id,
    items: orderItems,
    pricing,
    deliveryAddress,
    paymentMethod,
    scheduledDelivery: scheduledDelivery ? new Date(scheduledDelivery) : null,
    specialInstructions,
    status: OrderStatus.PENDING,
    paymentStatus: paymentMethod === 'cod' ? PaymentStatus.PENDING : PaymentStatus.PENDING,
    estimatedDeliveryTime: calculateEstimatedDeliveryTime(deliveryAddress, scheduledDelivery),
    timeline: [{
      status: OrderStatus.PENDING,
      timestamp: new Date(),
      description: 'Order placed successfully'
    }]
  });

  await order.save({ session });

  // Process payment (if not COD)
  let paymentResult = null;
  if (paymentMethod !== 'cod') {
    paymentResult = await processPayment({
      orderId: order._id,
      amount: pricing.total,
      paymentMethod,
      customerEmail: user.email,
      customerPhone: user.phone
    });

    if (!paymentResult.success) {
      throw {
        statusCode: 400,
        message: 'Payment processing failed',
        details: paymentResult.error
      };
    }

    order.paymentStatus = PaymentStatus.PAID;
    order.paymentDetails = {
      transactionId: paymentResult.transactionId,
      gateway: paymentResult.gateway,
      paidAt: new Date()
    };
    await order.save({ session });
  }

  // Clear user's cart
  await Cart.findOneAndDelete({ user: user.id }, { session });

  // Populate order for response
  await order.populate([
    { path: 'items.product', select: 'name images price seller' },
    { path: 'customer', select: 'name email phone' }
  ]);

  return { order, pricing, paymentResult };
}

function formatOrderResponse(order, paymentResult) {
  return {
    id: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: order.pricing.total,
    estimatedDeliveryTime: order.estimatedDeliveryTime,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    items: order.items.map(item => ({
      product: item.product._id,
      name: item.product.name,
      price: item.price,
      quantity: item.quantity,
      totalPrice: item.totalPrice
    })),
    paymentDetails: paymentResult
  };
}

/**
 * @swagger
 * /orders:
 *   get:
 *     summary: Get user's orders
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - $ref: '#/components/parameters/status'
 *       - $ref: '#/components/parameters/startDate'
 *       - $ref: '#/components/parameters/endDate'
 *       - $ref: '#/components/parameters/search'
 *     responses:
 *       200:
 *         description: List of user's orders
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderListResponse'
 */
router.get('/',
  protect,
  orderLimiter,
  searchValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const results = await getUserOrders(req.user.id, req.query);

      res.json({
        success: true,
        orders: results.orders,
        pagination: results.pagination,
        stats: results.stats
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

async function getUserOrders(userId, queryParams) {
  const {
    page = 1,
    limit = 20,
    status,
    startDate,
    endDate,
    search
  } = queryParams;

  // Build query
  const query = { customer: userId };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { 'items.product.name': { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  // Get orders with pagination
  const [orders, totalOrders] = await Promise.all([
    Order.find(query)
      .populate('items.product', 'name images price slug')
      .select('-paymentDetails -timeline')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(query)
  ]);

  // Calculate summary stats
  const stats = await calculateOrderStats(userId);

  return {
    orders,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      hasNext: page * limit < totalOrders,
      hasPrev: page > 1
    },
    stats
  };
}

async function calculateOrderStats(userId) {
  const stats = await Order.aggregate([
    { $match: { customer: userId } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: '$pricing.total' },
        averageOrderValue: { $avg: '$pricing.total' },
        statusCounts: {
          $push: '$status'
        }
      }
    },
    {
      $addFields: {
        statusDistribution: {
          pending: {
            $size: {
              $filter: {
                input: '$statusCounts',
                cond: { $eq: ['$$this', OrderStatus.PENDING] }
              }
            }
          },
          confirmed: {
            $size: {
              $filter: {
                input: '$statusCounts',
                cond: { $eq: ['$$this', OrderStatus.CONFIRMED] }
              }
            }
          },
          delivered: {
            $size: {
              $filter: {
                input: '$statusCounts',
                cond: { $eq: ['$$this', OrderStatus.DELIVERED] }
              }
            }
          },
          cancelled: {
            $size: {
              $filter: {
                input: '$statusCounts',
                cond: { $eq: ['$$this', OrderStatus.CANCELLED] }
              }
            }
          }
        }
      }
    }
  ]);

  return stats[0] || {
    totalOrders: 0,
    totalSpent: 0,
    averageOrderValue: 0,
    statusDistribution: {
      pending: 0,
      confirmed: 0,
      delivered: 0,
      cancelled: 0
    }
  };
}

/**
 * @swagger
 * /orders/{id}:
 *   get:
 *     summary: Get order details
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/orderId'
 *     responses:
 *       200:
 *         description: Order details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderDetailsResponse'
 */
router.get('/:id',
  protect,
  orderLimiter,
  async (req, res) => {
    try {
      const order = await getOrderDetails(req.params.id, req.user.id);

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

async function getOrderDetails(orderId, userId) {
  const order = await Order.findOne({
    _id: orderId,
    customer: userId
  })
  .populate('items.product', 'name images price seller slug')
  .populate('deliveryAgent', 'name phone rating')
  .lean();

  if (!order) return null;

  // Calculate delivery progress
  const deliveryProgress = calculateDeliveryProgress(order.status);

  // Get real-time tracking info if order is out for delivery
  let trackingInfo = null;
  if (order.status === OrderStatus.OUT_FOR_DELIVERY && order.deliveryAgent) {
    trackingInfo = await getDeliveryTrackingInfo(order._id);
  }

  return {
    ...order,
    deliveryProgress,
    trackingInfo,
    canCancel: canCancelOrder(order.status),
    canReorder: order.status === OrderStatus.DELIVERED,
    estimatedTimeRemaining: calculateTimeRemaining(order.estimatedDeliveryTime)
  };
}

/**
 * @swagger
 * /orders/{id}/track:
 *   get:
 *     summary: Get real-time order tracking
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/orderId'
 *     responses:
 *       200:
 *         description: Real-time tracking information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderTrackingResponse'
 */
router.get('/:id/track',
  protect,
  orderLimiter,
  async (req, res) => {
    try {
      const trackingInfo = await getOrderTracking(req.params.id, req.user.id);

      if (!trackingInfo) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      res.json({
        success: true,
        tracking: trackingInfo
      });

    } catch (error) {
      logger.error('Order tracking error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving tracking information'
      });
    }
  }
);

async function getOrderTracking(orderId, userId) {
  const order = await Order.findOne({
    _id: orderId,
    customer: userId
  })
  .populate('deliveryAgent', 'name phone rating')
  .select('status deliveryAgent estimatedDeliveryTime timeline');

  if (!order) return null;

  // Get real-time location if available
  let liveLocation = null;
  if (order.status === OrderStatus.OUT_FOR_DELIVERY && order.deliveryAgent) {
    liveLocation = await getDeliveryAgentLocation(order.deliveryAgent._id);
  }

  // Calculate delivery metrics
  return {
    orderId: order._id,
    status: order.status,
    timeline: order.timeline,
    deliveryAgent: order.deliveryAgent,
    metrics: {
      estimatedTimeRemaining: calculateTimeRemaining(order.estimatedDeliveryTime),
      deliveryProgress: calculateDeliveryProgress(order.status),
      currentLocation: liveLocation,
      canContactAgent: order.status === OrderStatus.OUT_FOR_DELIVERY
    },
    lastUpdated: new Date()
  };
}

/**
 * @swagger
 * /orders/{id}/cancel:
 *   patch:
 *     summary: Cancel an order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/orderId'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 5
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Order cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderCancellationResponse'
 */
router.patch('/:id/cancel',
  protect,
  [
    body('reason')
      .trim()
      .escape()
      .isLength({ min: 5, max: 500 })
      .withMessage('Cancellation reason must be 5-500 characters')
  ],
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

      const { reason } = req.body;
      const result = await cancelOrder(req.params.id, req.user.id, reason, session);

      await session.commitTransaction();

      // Send notifications
      sendOrderNotifications(result.order, 'cancelled');

      // Emit real-time event
      io.to(`user-${req.user.id}`).emit('order-cancelled', {
        orderId: result.order._id,
        orderNumber: result.order.orderNumber
      });

      logger.info(`Order cancelled: ${result.order.orderNumber}`, {
        orderId: result.order._id,
        customerId: req.user.id,
        reason
      });

      res.json({
        success: true,
        message: 'Order cancelled successfully',
        order: {
          id: result.order._id,
          status: result.order.status,
          refundStatus: result.order.paymentStatus,
          expectedRefundTime: '3-5 business days'
        }
      });

    } catch (error) {
      await session.abortTransaction();
      logger.error('Order cancellation error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Error cancelling order',
        details: error.details
      });
    } finally {
      session.endSession();
    }
  }
);

async function cancelOrder(orderId, userId, reason, session) {
  const order = await Order.findOne({
    _id: orderId,
    customer: userId
  }).session(session);

  if (!order) {
    throw {
      statusCode: 404,
      message: 'Order not found'
    };
  }

  // Check if order can be cancelled
  if (!canCancelOrder(order.status)) {
    throw {
      statusCode: 400,
      message: 'Order cannot be cancelled at this stage'
    };
  }

  // Update order status
  order.status = OrderStatus.CANCELLED;
  order.cancellationReason = reason;
  order.cancelledAt = new Date();
  order.timeline.push({
    status: OrderStatus.CANCELLED,
    timestamp: new Date(),
    description: `Order cancelled by customer: ${reason}`
  });

  await order.save({ session });

  // Restore product stock
  await restoreProductStock(order.items, session);

  // Process refund if payment was made
  if (order.paymentStatus === PaymentStatus.PAID) {
    const refundResult = await createRefund({
      orderId: order._id,
      amount: order.pricing.total,
      reason: 'Order cancelled by customer'
    });

    if (refundResult.success) {
      order.paymentStatus = PaymentStatus.REFUNDED;
      order.refundDetails = {
        refundId: refundResult.refundId,
        amount: refundResult.amount,
        processedAt: new Date()
      };
      await order.save({ session });
    } else {
      throw {
        statusCode: 500,
        message: 'Refund processing failed',
        details: refundResult.error
      };
    }
  }

  return { order };
}

/**
 * @swagger
 * /orders/{id}/reorder:
 *   post:
 *     summary: Reorder items from a previous order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/orderId'
 *     responses:
 *       200:
 *         description: Items added to cart for reorder
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReorderResponse'
 */
router.post('/:id/reorder',
  protect,
  orderLimiter,
  async (req, res) => {
    try {
      const result = await processReorder(req.params.id, req.user.id);

      res.json({
        success: true,
        message: `${result.availableItems.length} items added to cart`,
        summary: {
          itemsAdded: result.availableItems.length,
          itemsUnavailable: result.unavailableItems.length,
          cartTotal: result.cart.items.length
        },
        unavailableItems: result.unavailableItems.length > 0 ? result.unavailableItems : undefined
      });

    } catch (error) {
      logger.error('Reorder error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Error processing reorder',
        details: error.details
      });
    }
  }
);

async function processReorder(orderId, userId) {
  const order = await Order.findOne({
    _id: orderId,
    customer: userId,
    status: OrderStatus.DELIVERED
  }).populate('items.product', 'name price stock status');

  if (!order) {
    throw {
      statusCode: 404,
      message: 'Order not found or not eligible for reorder'
    };
  }

  // Check product availability
  const availableItems = [];
  const unavailableItems = [];

  for (const item of order.items) {
    if (item.product && 
        item.product.status === 'active' && 
        item.product.stock >= item.quantity) {
      availableItems.push({
        product: item.product._id,
        quantity: item.quantity,
        price: item.product.price
      });
    } else {
      unavailableItems.push({
        name: item.product?.name || 'Unknown Product',
        reason: !item.product ? 'Product no longer available' :
               item.product.status !== 'active' ? 'Product inactive' :
               'Insufficient stock'
      });
    }
  }

  if (availableItems.length === 0) {
    throw {
      statusCode: 400,
      message: 'No items from this order are currently available',
      details: { unavailableItems }
    };
  }

  // Add available items to cart
  let cart = await Cart.findOne({ user: userId });
  
  if (!cart) {
    cart = new Cart({ user: userId, items: [] });
  }

  // Merge with existing cart items
  for (const newItem of availableItems) {
    const existingItemIndex = cart.items.findIndex(
      item => item.product.toString() === newItem.product.toString()
    );

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity += newItem.quantity;
    } else {
      cart.items.push(newItem);
    }
  }

  await cart.save();

  logger.info(`Order reorder processed: ${order.orderNumber}`, {
    orderId: order._id,
    customerId: userId,
    availableItems: availableItems.length,
    unavailableItems: unavailableItems.length
  });

  return { cart, availableItems, unavailableItems };
}

// ==================== SELLER ROUTES ====================

/**
 * @swagger
 * /orders/seller/orders:
 *   get:
 *     summary: Get orders for seller
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - $ref: '#/components/parameters/status'
 *       - $ref: '#/components/parameters/startDate'
 *       - $ref: '#/components/parameters/endDate'
 *     responses:
 *       200:
 *         description: List of seller's orders
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SellerOrderResponse'
 */
router.get('/seller/orders',
  protect,
  authorize('seller', 'admin'),
  orderLimiter,
  searchValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const results = await getSellerOrders(req.user.id, req.query);

      res.json({
        success: true,
        orders: results.orders,
        pagination: results.pagination,
        analytics: results.analytics
      });

    } catch (error) {
      logger.error('Get seller orders error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving seller orders'
      });
    }
  }
);

async function getSellerOrders(sellerId, queryParams) {
  const {
    page = 1,
    limit = 20,
    status,
    startDate,
    endDate
  } = queryParams;

  // Build aggregation pipeline to get seller's orders
  const matchStage = {
    'items.seller': sellerId
  };

  if (status && status !== 'all') {
    matchStage.status = status;
  }

  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }

  const skip = (page - 1) * limit;

  const pipeline = [
    { $match: matchStage },
    {
      $addFields: {
        sellerItems: {
          $filter: {
            input: '$items',
            cond: { $eq: ['$$this.seller', sellerId] }
          }
        }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: 'customer',
        foreignField: '_id',
        as: 'customer',
        pipeline: [
          { $project: { name: 1, phone: 1, email: 1 } }
        ]
      }
    },
    {
      $addFields: {
        customer: { $arrayElemAt: ['$customer', 0] },
        sellerTotal: { $sum: '$sellerItems.totalPrice' },
        sellerItemCount: { $size: '$sellerItems' }
      }
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        orderNumber: 1,
        status: 1,
        customer: 1,
        sellerItems: 1,
        sellerTotal: 1,
        sellerItemCount: 1,
        deliveryAddress: 1,
        createdAt: 1,
        estimatedDeliveryTime: 1
      }
    }
  ];

  const [orders, totalOrders, analytics] = await Promise.all([
    Order.aggregate(pipeline),
    Order.countDocuments(matchStage),
    getSellerAnalytics(sellerId)
  ]);

  return {
    orders,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      hasNext: page * limit < totalOrders,
      hasPrev: page > 1
    },
    analytics
  };
}

async function getSellerAnalytics(sellerId) {
  const analytics = await Order.aggregate([
    { $match: { 'items.seller': sellerId } },
    {
      $addFields: {
        sellerItems: {
          $filter: {
            input: '$items',
            cond: { $eq: ['$$this.seller', sellerId] }
          }
        }
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: { $sum: '$sellerItems.totalPrice' } },
        avgOrderValue: { $avg: { $sum: '$sellerItems.totalPrice' } },
        statusDistribution: {
          $push: '$status'
        }
      }
    }
  ]);

  return analytics[0] || {
    totalOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0
  };
}

/**
 * @swagger
 * /orders/{id}/status:
 *   patch:
 *     summary: Update order status (Seller/Admin only)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/orderId'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OrderStatusUpdate'
 *     responses:
 *       200:
 *         description: Order status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderStatusResponse'
 */
router.patch('/:id/status',
  protect,
  authorize('seller', 'admin'),
  validateOrderUpdate,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const result = await updateOrderStatus(
        req.params.id,
        req.user,
        req.body
      );

      // Send notifications
      sendOrderNotifications(result.order, 'status_updated', result.previousStatus);

      // Emit real-time event
      io.to(`user-${result.order.customer._id}`).emit('order-status-updated', {
        orderId: result.order._id,
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        estimatedDeliveryTime: result.order.estimatedDeliveryTime
      });

      logger.info(`Order status updated: ${result.order.orderNumber}`, {
        orderId: result.order._id,
        previousStatus: result.previousStatus,
        newStatus: result.order.status,
        updatedBy: req.user.id
      });

      res.json({
        success: true,
        message: `Order status updated to ${result.order.status}`,
        order: {
          id: result.order._id,
          status: result.order.status,
          estimatedDeliveryTime: result.order.estimatedDeliveryTime,
          timeline: result.order.timeline
        }
      });

    } catch (error) {
      logger.error('Update order status error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Error updating order status',
        details: error.details
      });
    }
  }
);

async function updateOrderStatus(orderId, user, updateData) {
  const { status, notes, estimatedDeliveryTime } = updateData;

  const order = await Order.findById(orderId)
    .populate('customer', 'name email phone')
    .populate('items.product', 'name seller');

  if (!order) {
    throw {
      statusCode: 404,
      message: 'Order not found'
    };
  }

  // Check if user can update this order
  const canUpdate = user.role === 'admin' || 
                   order.items.some(item => item.product.seller.toString() === user.id);

  if (!canUpdate) {
    throw {
      statusCode: 403,
      message: 'Not authorized to update this order'
    };
  }

  // Validate status transition
  if (!isValidStatusTransition(order.status, status)) {
    throw {
      statusCode: 400,
      message: `Cannot change status from ${order.status} to ${status}`
    };
  }

  // Update order
  const previousStatus = order.status;
  order.status = status;
  
  if (estimatedDeliveryTime) {
    order.estimatedDeliveryTime = new Date(estimatedDeliveryTime);
  }

  // Add to timeline
  order.timeline.push({
    status,
    timestamp: new Date(),
    description: getStatusDescription(status),
    updatedBy: user.id,
    notes
  });

  // Set delivery completion time
  if (status === OrderStatus.DELIVERED) {
    order.deliveredAt = new Date();
  }

  await order.save();

  return { order, previousStatus };
}

// ==================== ADMIN ROUTES ====================

/**
 * @swagger
 * /orders/admin/all:
 *   get:
 *     summary: Get all orders (Admin only)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/page'
 *       - $ref: '#/components/parameters/limit'
 *       - $ref: '#/components/parameters/status'
 *       - $ref: '#/components/parameters/startDate'
 *       - $ref: '#/components/parameters/endDate'
 *       - $ref: '#/components/parameters/search'
 *     responses:
 *       200:
 *         description: List of all orders
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminOrderResponse'
 */
router.get('/admin/all',
  protect,
  authorize('admin'),
  orderLimiter,
  searchValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const results = await getAllOrders(req.query);

      res.json({
        success: true,
        orders: results.orders,
        pagination: results.pagination,
        analytics: results.analytics
      });

    } catch (error) {
      logger.error('Get admin orders error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving orders'
      });
    }
  }
);

async function getAllOrders(queryParams) {
  const {
    page = 1,
    limit = 20,
    status,
    startDate,
    endDate,
    search
  } = queryParams;

  // Build query
  const query = {};

  if (status && status !== 'all') {
    query.status = status;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  if (search) {
    query.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { 'customer.name': { $regex: search, $options: 'i' } },
      { 'customer.email': { $regex: search, $options: 'i' } }
    ];
  }

  const skip = (page - 1) * limit;

  const [orders, totalOrders, analytics] = await Promise.all([
    Order.find(query)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    
    Order.countDocuments(query),
    
    // Get comprehensive analytics
    Order.aggregate([
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.total' },
          avgOrderValue: { $avg: '$pricing.total' },
          totalDeliveryFees: { $sum: '$pricing.deliveryFee' },
          statusCounts: {
            $push: '$status'
          }
        }
      }
    ])
  ]);

  return {
    orders,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      hasNext: page * limit < totalOrders,
      hasPrev: page > 1
    },
    analytics: analytics[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      totalDeliveryFees: 0
    }
  };
}

// ==================== HELPER FUNCTIONS ====================

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
    
    if (product.stock < item.quantity) {
      throw {
        statusCode: 400,
        message: `Insufficient stock for ${product.name}`,
        details: {
          productId: product._id,
          requested: item.quantity,
          available: product.stock
        }
      };
    }
    
    orderItems.push({
      product: product._id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      totalPrice: product.price * item.quantity,
      seller: product.seller
    });
  }
  
  return orderItems;
}

async function calculateOrderPricing(orderItems, deliveryAddress, couponCode, tip = 0) {
  const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
  
  // Calculate delivery fee
  const deliveryFee = await calculateDeliveryFee(deliveryAddress, subtotal);
  
  // Apply coupon if provided
  let discount = 0;
  let coupon = null;
  
  if (couponCode) {
    coupon = await applyCoupon(couponCode, subtotal);
    discount = coupon.discountAmount;
  }
  
  // Calculate taxes (configurable)
  const taxRate = 0.05; // 5% tax
  const taxAmount = (subtotal - discount) * taxRate;
  
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
      update: { $inc: { stock: -item.quantity } }
    }
  }));
  
  await Product.bulkWrite(bulkOps, { session });
}

async function restoreProductStock(orderItems, session) {
  const bulkOps = orderItems.map(item => ({
    updateOne: {
      filter: { _id: item.product },
      update: { $inc: { stock: item.quantity } }
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
  
  // Calculate based on distance and current time
  const estimatedMinutes = estimateDeliveryTime(deliveryAddress);
  const deliveryTime = new Date();
  deliveryTime.setMinutes(deliveryTime.getMinutes() + estimatedMinutes);
  
  return deliveryTime;
}

function calculateDeliveryProgress(status) {
  const progressMap = {
    [OrderStatus.PENDING]: 10,
    [OrderStatus.CONFIRMED]: 25,
    [OrderStatus.PREPARING]: 50,
    [OrderStatus.OUT_FOR_DELIVERY]: 80,
    [OrderStatus.DELIVERED]: 100,
    [OrderStatus.CANCELLED]: 0
  };
  
  return progressMap[status] || 0;
}

function calculateTimeRemaining(estimatedDeliveryTime) {
  if (!estimatedDeliveryTime) return null;
  
  const now = new Date();
  const estimated = new Date(estimatedDeliveryTime);
  const diffMs = estimated - now;
  
  if (diffMs <= 0) return 'Delivery time passed';
  
  const minutes = Math.floor(diffMs / 60000);
  
  if (minutes < 60) {
    return `${minutes} minutes`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
}

function canCancelOrder(status) {
  return [OrderStatus.PENDING, OrderStatus.CONFIRMED].includes(status);
}

function isValidStatusTransition(currentStatus, newStatus) {
  const validTransitions = {
    [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
    [OrderStatus.PREPARING]: [OrderStatus.OUT_FOR_DELIVERY],
    [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: []
  };
  
  return validTransitions[currentStatus]?.includes(newStatus) || false;
}

function getStatusDescription(status) {
  const descriptions = {
    [OrderStatus.PENDING]: 'Order received and awaiting confirmation',
    [OrderStatus.CONFIRMED]: 'Order confirmed by seller',
    [OrderStatus.PREPARING]: 'Order is being prepared',
    [OrderStatus.OUT_FOR_DELIVERY]: 'Order is out for delivery',
    [OrderStatus.DELIVERED]: 'Order delivered successfully',
    [OrderStatus.CANCELLED]: 'Order has been cancelled'
  };
  
  return descriptions[status] || 'Status updated';
}

async function sendOrderNotifications(order, type, previousStatus = null) {
  try {
    const customer = await User.findById(order.customer);
    
    switch (type) {
      case 'created':
        await sendEmail({
          to: customer.email,
          subject: 'Order Confirmation - QuickLocal',
          template: 'order-confirmation',
          data: {
            customerName: customer.name,
            orderNumber: order.orderNumber,
            items: order.items,
            total: order.pricing.total,
            estimatedDelivery: order.estimatedDeliveryTime
          }
        });
        
        if (customer.phone) {
          await sendSMS({
            to: customer.phone,
            message: `Order ${order.orderNumber} confirmed! Track: ${process.env.CLIENT_URL}/orders/${order._id}`
          });
        }
        break;
        
      case 'status_updated':
        await sendEmail({
          to: customer.email,
          subject: `Order Update - ${order.orderNumber}`,
          template: 'order-status-update',
          data: {
            customerName: customer.name,
            orderNumber: order.orderNumber,
            status: order.status,
            estimatedDelivery: order.estimatedDeliveryTime
          }
        });
        break;
        
      case 'cancelled':
        await sendEmail({
          to: customer.email,
          subject: `Order Cancelled - ${order.orderNumber}`,
          template: 'order-cancelled',
          data: {
            customerName: customer.name,
            orderNumber: order.orderNumber,
            refundInfo: order.paymentStatus === PaymentStatus.REFUNDED
          }
        });
        break;
    }
  } catch (error) {
    logger.error('Send order notifications error:', error);
  }
}

async function getDeliveryTrackingInfo(orderId) {
  try {
    // Get from Redis cache if available
    const cached = await redis.get(`delivery:${orderId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Return mock data for demo
    return {
      currentLocation: {
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
    'SAVE10': { type: 'percentage', value: 10, minOrder: 100 },
    'FLAT50': { type: 'fixed', value: 50, minOrder: 200 },
    'FIRST20': { type: 'percentage', value: 20, minOrder: 0 }
  };
  
  const coupon = mockCoupons[couponCode.toUpperCase()];
  if (!coupon) {
    throw new Error('Invalid coupon code');
  }
  
  if (subtotal < coupon.minOrder) {
    throw new Error(`Minimum order amount ₹${coupon.minOrder} required`);
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

module.exports = router;