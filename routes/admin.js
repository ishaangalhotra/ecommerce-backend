const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { hybridProtect, requireRole } = require('../middleware/hybridAuthmiddleware');
// Old authMiddleware replaced with hybridAuth
const { cache: cacheMiddleware, invalidateCache: clearCache } = require('../middleware/cache');
const rateLimit = require('express-rate-limit');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { sendNotification } = require('../services/notificationService');

const router = express.Router();

// Constants
const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
const USER_ROLES = ['admin', 'seller', 'customer', 'moderator', 'support', 'delivery_agent'];
const CACHE_TTL = '5 minutes';

// Rate Limiter Configuration - FIXED
const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  legacyHeaders: false,
  standardHeaders: true,
  keyGenerator: (req) => `admin:${req.user?.id || req.ip}`,
  // Removed the problematic RedisStore configuration
  // If you want to use Redis store, you'll need to install and properly configure it
  // store: new RedisStore({
  //   client: redis,
  //   prefix: 'ratelimit:admin'
  // }),
  handler: (req, res) => {
    logger.warn('Admin rate limit exceeded', {
      userId: req.user?.id,
      path: req.path,
      ip: req.ip
    });
    res.status(429).json({ 
      success: false, 
      message: 'Rate limit exceeded. Please wait.',
      retryAfter: Math.ceil(req.rateLimit?.resetTime / 1000) || 60
    });
  }
});

// Validation Middleware
const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.debug('Validation error', { 
        path: req.path, 
        errors: errors.array(),
        userId: req.user?.id 
      });
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }
    next();
  }
];

// Request Logger Middleware
const requestLogger = (action) => (req, res, next) => {
  logger.info('Admin API Request', {
    action,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id,
    params: req.params,
    query: req.query
  });
  next();
};

// 🔐 Secure all admin routes
router.use(hybridProtect);
router.use(requireRole('admin'));
router.use(adminLimiter);

/**
 * 📊 ADMIN DASHBOARD ENDPOINTS
 */

/**
 * Get Dashboard Statistics
 * GET /admin/dashboard
 * 
 * Returns key metrics for admin dashboard including:
 * - User counts by role
 * - Product statistics
 * - Order statistics and revenue
 * - Recent activity
 */
router.get('/dashboard',
  cacheMiddleware(CACHE_TTL),
  requestLogger('dashboard_stats'),
  async (req, res) => {
    try {
      const [
        userCounts,
        productStats,
        orderStats,
        revenueStats,
        recentOrders
      ] = await Promise.all([
        // User statistics by role
        User.aggregate([
          { $group: { _id: '$role', count: { $sum: 1 } } }
        ]),
        
        // Product statistics
        Product.aggregate([
          { 
            $group: { 
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
              outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } }
            } 
          }
        ]),
        
        // Order statistics by status
        Order.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        
        // Revenue statistics
        Order.aggregate([
          { 
            $match: { 
              status: 'delivered',
              createdAt: { $gte: new Date(new Date() - 30 * 24 * 60 * 60 * 1000) }
            } 
          },
          { 
            $group: { 
              _id: null, 
              totalRevenue: { $sum: '$total' },
              avgOrderValue: { $avg: '$total' },
              orderCount: { $sum: 1 }
            } 
          }
        ]),
        
        // Recent 5 orders
        Order.find()
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('user', 'name email')
      ]);
      
      res.json({
        success: true,
        data: {
          users: userCounts,
          products: productStats[0] || {},
          orders: orderStats,
          revenue: revenueStats[0] || { totalRevenue: 0, avgOrderValue: 0, orderCount: 0 },
          recentActivity: recentOrders
        }
      });
    } catch (err) {
      logger.error('Dashboard stats error', {
        error: err.message,
        stack: err.stack,
        userId: req.user.id
      });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to load dashboard statistics',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * 🛒 ORDER MANAGEMENT ENDPOINTS
 */

/**
 * Get All Orders with Pagination
 * GET /admin/orders?page=1&limit=10
 */
router.get('/orders',
  validate([
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('sort').optional().isIn(['newest', 'oldest', 'total_asc', 'total_desc'])
  ]),
  requestLogger('get_orders'),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      
      let sort = { createdAt: -1 }; // Default: newest first
      if (req.query.sort === 'oldest') sort = { createdAt: 1 };
      if (req.query.sort === 'total_asc') sort = { total: 1 };
      if (req.query.sort === 'total_desc') sort = { total: -1 };
      
      const [orders, total] = await Promise.all([
        Order.find()
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .populate('user', 'name email')
          .populate('items.product', 'name price'),
        Order.countDocuments()
      ]);
      
      res.json({
        success: true,
        data: orders,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      logger.error('Get orders error', {
        error: err.message,
        stack: err.stack,
        userId: req.user.id
      });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch orders',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * Filter Orders with Advanced Options
 * GET /admin/orders/filter?status=delivered&from=2023-01-01&to=2023-12-31
 */
router.get('/orders/filter',
  validate([
    query('status')
      .optional()
      .isIn(ORDER_STATUSES)
      .withMessage('Invalid status filter'),
    query('from')
      .optional()
      .isISO8601()
      .withMessage('Invalid from date'),
    query('to')
      .optional()
      .isISO8601()
      .withMessage('Invalid to date'),
    query('minTotal')
      .optional()
      .isFloat({ min: 0 })
      .toFloat()
      .withMessage('Invalid minimum total'),
    query('maxTotal')
      .optional()
      .isFloat({ min: 0 })
      .toFloat()
      .withMessage('Invalid maximum total')
  ]),
  requestLogger('filter_orders'),
  async (req, res) => {
    try {
      const query = {};
      
      // Status filter
      if (req.query.status) query.status = req.query.status;
      
      // Date range filter
      if (req.query.from || req.query.to) {
        query.createdAt = {};
        if (req.query.from) query.createdAt.$gte = new Date(req.query.from);
        if (req.query.to) query.createdAt.$lte = new Date(req.query.to);
      }
      
      // Price range filter
      if (req.query.minTotal || req.query.maxTotal) {
        query.total = {};
        if (req.query.minTotal) query.total.$gte = parseFloat(req.query.minTotal);
        if (req.query.maxTotal) query.total.$lte = parseFloat(req.query.maxTotal);
      }
      
      const orders = await Order.find(query)
        .sort({ createdAt: -1 })
        .populate('user', 'name email');
      
      res.json({ 
        success: true, 
        data: orders,
        count: orders.length
      });
    } catch (err) {
      logger.error('Filter orders error', {
        error: err.message,
        stack: err.stack,
        userId: req.user.id,
        query: req.query
      });
      res.status(500).json({ 
        success: false, 
        message: 'Error filtering orders',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * Get Order Details
 * GET /admin/orders/:id
 */
router.get('/orders/:id',
  validate([
    param('id').isMongoId().withMessage('Invalid order ID')
  ]),
  requestLogger('get_order'),
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id)
        .populate('user', 'name email phone')
        .populate('items.product', 'name price images');
      
      if (!order) {
        return res.status(404).json({ 
          success: false, 
          message: 'Order not found' 
        });
      }
      
      res.json({ 
        success: true, 
        data: order 
      });
    } catch (err) {
      logger.error('Get order error', {
        error: err.message,
        stack: err.stack,
        userId: req.user.id,
        orderId: req.params.id
      });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch order details',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * Update Order Status
 * PUT /admin/orders/:id/status
 */
router.put('/orders/:id/status',
  validate([
    param('id').isMongoId().withMessage('Invalid order ID'),
    body('status')
      .isIn(ORDER_STATUSES)
      .withMessage('Invalid order status'),
    body('notes').optional().isString().trim().escape()
  ]),
  requestLogger('update_order_status'),
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      
      if (!order) {
        return res.status(404).json({ 
          success: false, 
          message: 'Order not found' 
        });
      }
      
      const previousStatus = order.status;
      const newStatus = req.body.status;
      
      // Update order status
      order.status = newStatus;
      order.statusHistory.push({
        status: newStatus,
        changedBy: req.user.id,
        notes: req.body.notes,
        changedAt: new Date()
      });
      
      const updatedOrder = await order.save();
      
      // Send notification to user about status change (with error handling)
      try {
        await sendNotification({
          userId: order.user,
          title: 'Order Status Updated',
          message: `Your order #${order.orderNumber} status changed from ${previousStatus} to ${newStatus}`,
          type: 'order_update',
          metadata: { orderId: order._id }
        });
      } catch (notificationError) {
        logger.warn('Failed to send notification', {
          error: notificationError.message,
          orderId: order._id
        });
      }
      
      res.json({ 
        success: true, 
        data: updatedOrder,
        message: 'Order status updated successfully'
      });
    } catch (err) {
      logger.error('Update order status error', {
        error: err.message,
        stack: err.stack,
        userId: req.user.id,
        orderId: req.params.id
      });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update order status',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * 👥 USER MANAGEMENT ENDPOINTS
 */

/**
 * Get All Users with Pagination
 * GET /admin/users?page=1&limit=10&role=customer
 */
router.get('/users',
  validate([
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('role').optional().isIn(USER_ROLES),
    query('search').optional().isString().trim().escape()
  ]),
  requestLogger('get_users'),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      
      const query = {};
      
      // Role filter
      if (req.query.role) query.role = req.query.role;
      
      // Search filter
      if (req.query.search) {
        query.$or = [
          { name: { $regex: req.query.search, $options: 'i' } },
          { email: { $regex: req.query.search, $options: 'i' } }
        ];
      }
      
      const [users, total] = await Promise.all([
        User.find(query)
          .select('-password -refreshToken')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      logger.error('Get users error', {
        error: err.message,
        stack: err.stack,
        userId: req.user.id
      });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch users',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * Get User Details
 * GET /admin/users/:id
 */
router.get('/users/:id',
  validate([
    param('id').isMongoId().withMessage('Invalid user ID')
  ]),
  requestLogger('get_user'),
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id)
        .select('-password -refreshToken')
        .populate({
          path: 'orders',
          select: 'orderNumber total status createdAt',
          options: { limit: 5, sort: { createdAt: -1 } }
        });
      
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      res.json({ 
        success: true, 
        data: user 
      });
    } catch (err) {
      logger.error('Get user error', {
        error: err.message,
        stack: err.stack,
        userId: req.user.id,
        targetUserId: req.params.id
      });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch user details',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * Update User Role and Status
 * PUT /admin/users/:id
 */
router.put('/users/:id',
  validate([
    param('id').isMongoId().withMessage('Invalid user ID'),
    body('role')
      .optional()
      .isIn(USER_ROLES)
      .withMessage('Invalid role value'),
    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive must be boolean')
  ]),
  requestLogger('update_user'),
  async (req, res) => {
    try {
      const updateFields = {};
      
      if (req.body.role) {
        updateFields.role = req.body.role;
        updateFields.roleChangedAt = new Date();
        updateFields.roleChangedBy = req.user.id;
      }
      
      if (typeof req.body.isActive !== 'undefined') {
        updateFields.isActive = req.body.isActive;
      }
      
      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'No valid fields to update' 
        });
      }
      
      const updated = await User.findByIdAndUpdate(
        req.params.id,
        updateFields,
        { new: true, runValidators: true }
      ).select('-password -refreshToken');
      
      if (!updated) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      // Send notification to user if their role or status changed (with error handling)
      if (req.body.role || typeof req.body.isActive !== 'undefined') {
        try {
          await sendNotification({
            userId: updated._id,
            title: 'Account Updated',
            message: req.body.role 
              ? `Your account role has been updated to ${req.body.role}`
              : `Your account has been ${req.body.isActive ? 'activated' : 'deactivated'}`,
            type: 'account_update'
          });
        } catch (notificationError) {
          logger.warn('Failed to send user update notification', {
            error: notificationError.message,
            userId: updated._id
          });
        }
      }
      
      res.json({ 
        success: true, 
        data: updated,
        message: 'User updated successfully'
      });
    } catch (err) {
      logger.error('Update user error', {
        error: err.message,
        stack: err.stack,
        userId: req.user.id,
        targetUserId: req.params.id
      });
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update user',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

module.exports = router;