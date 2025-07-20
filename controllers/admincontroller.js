const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const asyncHandler = require('../middleware/asyncHandler');
const ErrorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const { createAuditLog } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');
const { validationResult } = require('express-validator');

// Constants
const ORDER_STATUSES = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];
const USER_ROLES = ['user', 'seller', 'admin', 'moderator'];
const PRODUCT_STATUSES = ['active', 'inactive', 'pending', 'rejected'];
const DASHBOARD_TIME_RANGES = ['24h', '7d', '30d', '90d', 'custom'];

/**
 * @desc    Get comprehensive dashboard statistics with caching
 * @route   GET /api/v1/admin/dashboard
 * @access  Private/Admin
 */
exports.getDashboardStats = asyncHandler(async (req, res) => {
  try {
    const { timeRange = '30d', startDate: customStart, endDate: customEnd } = req.query;
    
    // Validate time range
    if (!DASHBOARD_TIME_RANGES.includes(timeRange) {
      throw new ErrorResponse('Invalid time range specified', 400);
    }

    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();
    
    if (timeRange === 'custom' && customStart) {
      startDate = new Date(customStart);
      if (customEnd) endDate = new Date(customEnd);
    } else {
      switch (timeRange) {
        case '24h':
          startDate.setHours(now.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(now.getDate() - 90);
          break;
      }
    }

    // Parallel data fetching
    const [
      totalOrders,
      pendingOrders,
      totalUsers,
      newUsers,
      totalProducts,
      activeProducts,
      recentOrders,
      userGrowth,
      orderTrends,
      revenueTrends,
      topProducts,
      topCategories
    ] = await Promise.all([
      // Count queries
      Order.countDocuments(),
      Order.countDocuments({ status: 'Processing' }),
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: startDate } }),
      Product.countDocuments(),
      Product.countDocuments({ status: 'active' }),
      
      // Recent orders with detailed population
      Order.find()
        .sort('-createdAt')
        .limit(5)
        .populate({
          path: 'user',
          select: 'name email avatar'
        })
        .populate({
          path: 'items.product',
          select: 'name price images'
        }),
      
      // User growth analytics
      User.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Order trends
      Order.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Revenue trends
      Order.aggregate([
        { 
          $match: { 
            status: 'Delivered',
            createdAt: { $gte: startDate, $lte: endDate } 
          } 
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$totalPrice' }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Top selling products
      Product.find({ status: 'active' })
        .sort('-salesCount -rating')
        .limit(5)
        .populate('seller', 'name')
        .select('name price images salesCount rating'),
      
      // Top categories
      Product.aggregate([
        { $match: { status: 'active' } },
        { $unwind: '$categories' },
        {
          $group: {
            _id: '$categories',
            count: { $sum: 1 },
            revenue: { 
              $sum: { 
                $multiply: ['$price', '$salesCount'] 
              } 
            }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 }
      ])
    ]);

    // Calculate financial metrics
    const [revenueData, conversionData] = await Promise.all([
      Order.aggregate([
        { $match: { status: 'Delivered' } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } }
      ]),
      Order.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const totalRevenue = revenueData[0]?.total || 0;
    const conversionRate = totalOrders > 0 ? 
      ((conversionData.find(d => d._id === 'Delivered')?.count || 0) / totalOrders * 100).toFixed(2) : 0;

    // Calculate average order value
    const avgOrderValue = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : 0;

    // Log dashboard access
    logger.info('Dashboard stats accessed', {
      adminId: req.user.id,
      timeRange,
      timestamp: new Date().toISOString()
    });

    // Response structure
    res.status(200).json({
      success: true,
      data: {
        overview: {
          orders: {
            total: totalOrders,
            pending: pendingOrders,
            conversionRate: parseFloat(conversionRate),
            avgOrderValue: parseFloat(avgOrderValue)
          },
          users: {
            total: totalUsers,
            new: newUsers
          },
          products: {
            total: totalProducts,
            active: activeProducts
          },
          revenue: {
            total: totalRevenue,
            currency: 'USD' // Could be dynamic based on store settings
          }
        },
        trends: {
          userGrowth,
          orderTrends,
          revenueTrends
        },
        topPerformers: {
          products: topProducts,
          categories: topCategories
        },
        recentActivity: {
          orders: recentOrders
        },
        metadata: {
          timeRange,
          startDate,
          endDate,
          generatedAt: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    logger.error('Dashboard stats error', {
      error: error.message,
      adminId: req.user.id,
      stack: error.stack
    });
    throw error;
  }
});

/**
 * @desc    Get all orders with advanced filtering, searching and pagination
 * @route   GET /api/v1/admin/orders
 * @access  Private/Admin
 */
exports.getAllOrders = asyncHandler(async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      minAmount,
      maxAmount,
      startDate,
      endDate
    } = req.query;

    // Validate status if provided
    if (status && !ORDER_STATUSES.includes(status)) {
      return next(new ErrorResponse(`Invalid order status: ${status}`, 400));
    }

    // Build query
    const query = {};
    
    if (status) query.status = status;
    
    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    // Amount range filter
    if (minAmount || maxAmount) {
      query.totalPrice = {};
      if (minAmount) query.totalPrice.$gte = parseFloat(minAmount);
      if (maxAmount) query.totalPrice.$lte = parseFloat(maxAmount);
    }
    
    // Search across multiple fields
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'user.name': { $regex: search, $options: 'i' } },
        { 'user.email': { $regex: search, $options: 'i' } },
        { 'shippingAddress.text': { $regex: search, $options: 'i' } }
      ];
    }

    // Sort configuration
    const sortOptions = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    
    // Pagination calculation
    const pageInt = parseInt(page);
    const limitInt = parseInt(limit);
    const skip = (pageInt - 1) * limitInt;

    // Execute queries in parallel
    const [orders, totalOrders] = await Promise.all([
      Order.find(query)
        .populate({
          path: 'user',
          select: 'name email phone avatar'
        })
        .populate({
          path: 'items.product',
          select: 'name price images sku'
        })
        .sort(sortOptions)
        .skip(skip)
        .limit(limitInt)
        .lean(), // Using lean() for better performance
      Order.countDocuments(query)
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalOrders / limitInt);

    // Log successful query
    logger.info('Admin order query executed', {
      adminId: req.user.id,
      queryParams: req.query,
      resultCount: orders.length
    });

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
      pagination: {
        currentPage: pageInt,
        totalPages,
        totalOrders,
        itemsPerPage: limitInt,
        hasNext: pageInt < totalPages,
        hasPrevious: pageInt > 1
      }
    });
  } catch (error) {
    logger.error('Order query error', {
      error: error.message,
      adminId: req.user.id,
      query: req.query,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Get order analytics with filters
 * @route   GET /api/v1/admin/orders/analytics
 * @access  Private/Admin
 */
exports.getOrderAnalytics = asyncHandler(async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    
    // Validate groupBy
    const validGroupBy = ['hour', 'day', 'week', 'month', 'year'];
    if (!validGroupBy.includes(groupBy)) {
      throw new ErrorResponse(`Invalid grouping: ${groupBy}`, 400);
    }

    // Date formatting based on groupBy
    let dateFormat;
    switch (groupBy) {
      case 'hour': dateFormat = '%Y-%m-%d %H:00'; break;
      case 'day': dateFormat = '%Y-%m-%d'; break;
      case 'week': dateFormat = '%Y-%U'; break;
      case 'month': dateFormat = '%Y-%m'; break;
      case 'year': dateFormat = '%Y'; break;
    }

    // Match conditions
    const match = {};
    if (startDate) match.createdAt = { $gte: new Date(startDate) };
    if (endDate) {
      match.createdAt = match.createdAt || {};
      match.createdAt.$lte = new Date(endDate);
    }

    const analytics = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: dateFormat, date: '$createdAt' } },
            status: '$status'
          },
          count: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          },
          totalOrders: { $sum: '$count' },
          totalRevenue: { $sum: '$totalRevenue' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Calculate summary stats
    const summary = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' },
          avgOrderValue: { $avg: '$totalPrice' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        analytics,
        summary: summary[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          avgOrderValue: 0
        }
      }
    });
  } catch (error) {
    logger.error('Order analytics error', {
      error: error.message,
      adminId: req.user.id,
      stack: error.stack
    });
    throw error;
  }
});

/**
 * @desc    Update order status with comprehensive validation
 * @route   PUT /api/v1/admin/orders/:id/status
 * @access  Private/Admin
 */
exports.updateOrderStatus = asyncHandler(async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ErrorResponse(errors.array()[0].msg, 400));
    }

    const { status, notes, notifyUser = true } = req.body;
    const orderId = req.params.id;

    // Validate status
    if (!ORDER_STATUSES.includes(status)) {
      return next(new ErrorResponse(`Invalid status: ${status}`, 400));
    }

    const order = await Order.findById(orderId)
      .populate('user', 'name email notificationSettings');
    
    if (!order) {
      return next(new ErrorResponse(`Order not found with id ${orderId}`, 404));
    }

    // Check for valid status transitions
    const validTransitions = {
      'Processing': ['Shipped', 'Cancelled'],
      'Shipped': ['Delivered', 'Cancelled'],
      'Delivered': [],
      'Cancelled': []
    };

    if (!validTransitions[order.status].includes(status)) {
      return next(new ErrorResponse(
        `Invalid status transition from ${order.status} to ${status}`,
        400
      ));
    }

    const previousStatus = order.status;
    
    // Update order
    order.status = status;
    order.statusHistory.push({
      status,
      changedBy: req.user.id,
      changedAt: new Date(),
      notes
    });
    
    if (notes) order.adminNotes = notes;
    
    await order.save();

    // Notification logic
    if (notifyUser && order.user) {
      const userPrefersNotifications = order.user.notificationSettings?.orderUpdates !== false;
      
      if (userPrefersNotifications) {
        await sendNotification({
          userId: order.user._id,
          title: 'Order Status Updated',
          message: `Your order #${order.orderNumber} is now ${status}`,
          type: 'order_update',
          metadata: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            newStatus: status
          }
        });
      }
    }

    // Audit logging
    await createAuditLog({
      action: 'order_status_update',
      performedBy: req.user.id,
      targetType: 'Order',
      targetId: order._id,
      changes: {
        previousStatus,
        newStatus: status
      },
      metadata: {
        orderNumber: order.orderNumber,
        customerId: order.user?._id,
        notes
      }
    });

    logger.info('Order status updated', {
      orderId: order._id,
      previousStatus,
      newStatus: status,
      adminId: req.user.id,
      notifiedUser: notifyUser
    });

    res.status(200).json({
      success: true,
      data: order,
      message: `Order status updated to ${status}`
    });
  } catch (error) {
    logger.error('Order status update failed', {
      error: error.message,
      orderId: req.params.id,
      adminId: req.user.id,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Get all users with advanced filtering and role-based access
 * @route   GET /api/v1/admin/users
 * @access  Private/Admin
 */
exports.getAllUsers = asyncHandler(async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      role,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      hasOrders,
      isVerified
    } = req.query;

    // Build query
    const query = {};
    
    if (role) {
      if (!USER_ROLES.includes(role)) {
        return next(new ErrorResponse(`Invalid role: ${role}`, 400));
      }
      query.role = role;
    }
    
    if (status) query.status = status;
    if (isVerified !== undefined) query.isVerified = isVerified === 'true';
    
    // Search across multiple fields
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Users with/without orders
    if (hasOrders === 'true') {
      query.hasOrders = true;
    } else if (hasOrders === 'false') {
      query.hasOrders = { $ne: true };
    }

    // Sort configuration
    const sortOptions = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    
    // Pagination calculation
    const pageInt = parseInt(page);
    const limitInt = parseInt(limit);
    const skip = (pageInt - 1) * limitInt;

    // Base query without sensitive fields
    const baseQuery = User.find(query)
      .select('-password -resetToken -refreshToken -twoFactorSecret')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitInt);

    // Count total users
    const countQuery = User.countDocuments(query);

    const [users, totalUsers] = await Promise.all([baseQuery, countQuery]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalUsers / limitInt);

    // Get additional statistics
    const stats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
      statistics: stats,
      pagination: {
        currentPage: pageInt,
        totalPages,
        totalUsers,
        itemsPerPage: limitInt
      }
    });
  } catch (error) {
    logger.error('User query failed', {
      error: error.message,
      adminId: req.user.id,
      query: req.query,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Update user with comprehensive validation and logging
 * @route   PUT /api/v1/admin/users/:id
 * @access  Private/Admin
 */
exports.updateUser = asyncHandler(async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ErrorResponse(errors.array()[0].msg, 400));
    }

    const { role, status, isVerified, notes } = req.body;
    const userId = req.params.id;

    // Validate role if provided
    if (role && !USER_ROLES.includes(role)) {
      return next(new ErrorResponse(`Invalid role: ${role}`, 400));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new ErrorResponse(`User not found with id ${userId}`, 404));
    }

    // Store previous values for audit
    const previousValues = {
      role: user.role,
      status: user.status,
      isVerified: user.isVerified
    };

    // Apply updates
    if (role) user.role = role;
    if (status) user.status = status;
    if (isVerified !== undefined) user.isVerified = isVerified;
    if (notes) user.adminNotes = notes;
    
    user.updatedBy = req.user.id;
    user.updatedAt = new Date();

    await user.save();

    // Audit logging
    await createAuditLog({
      action: 'user_update',
      performedBy: req.user.id,
      targetType: 'User',
      targetId: user._id,
      changes: {
        role: role ? { from: previousValues.role, to: role } : undefined,
        status: status ? { from: previousValues.status, to: status } : undefined,
        isVerified: isVerified !== undefined ? 
          { from: previousValues.isVerified, to: isVerified } : undefined
      },
      metadata: {
        email: user.email,
        notes
      }
    });

    // Prepare response data without sensitive fields
    const responseUser = user.toObject();
    delete responseUser.password;
    delete responseUser.resetToken;
    delete responseUser.refreshToken;
    delete responseUser.twoFactorSecret;

    logger.info('User updated by admin', {
      adminId: req.user.id,
      userId: user._id,
      changes: req.body
    });

    res.status(200).json({
      success: true,
      data: responseUser,
      message: 'User updated successfully'
    });
  } catch (error) {
    logger.error('User update failed', {
      error: error.message,
      adminId: req.user.id,
      userId: req.params.id,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Get all products with advanced filtering and analytics
 * @route   GET /api/v1/admin/products
 * @access  Private/Admin
 */
exports.getAllProducts = asyncHandler(async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      category,
      seller,
      search,
      minPrice,
      maxPrice,
      minStock,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Validate status if provided
    if (status && !PRODUCT_STATUSES.includes(status)) {
      return next(new ErrorResponse(`Invalid product status: ${status}`, 400));
    }

    // Build query
    const query = {};
    
    if (status) query.status = status;
    if (category) query.category = category;
    if (seller) query.seller = seller;
    
    // Price range
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }
    
    // Stock level
    if (minStock) query.stockQuantity = { $gte: parseInt(minStock) };
    
    // Search across multiple fields
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } }
      ];
    }

    // Sort configuration
    const sortOptions = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    
    // Pagination calculation
    const pageInt = parseInt(page);
    const limitInt = parseInt(limit);
    const skip = (pageInt - 1) * limitInt;

    // Base query with population
    const baseQuery = Product.find(query)
      .populate('seller', 'name email')
      .populate('category', 'name')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitInt);

    // Count total products
    const countQuery = Product.countDocuments(query);

    const [products, totalProducts] = await Promise.all([baseQuery, countQuery]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalProducts / limitInt);

    // Get product statistics
    const stats = await Product.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgPrice: { $avg: '$price' },
          totalStock: { $sum: '$stockQuantity' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      count: products.length,
      data: products,
      statistics: stats,
      pagination: {
        currentPage: pageInt,
        totalPages,
        totalProducts,
        itemsPerPage: limitInt
      }
    });
  } catch (error) {
    logger.error('Product query failed', {
      error: error.message,
      adminId: req.user.id,
      query: req.query,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Update product status with validation and notifications
 * @route   PUT /api/v1/admin/products/:id/status
 * @access  Private/Admin
 */
exports.updateProductStatus = asyncHandler(async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ErrorResponse(errors.array()[0].msg, 400));
    }

    const { status, notes, notifySeller = true } = req.body;
    const productId = req.params.id;

    // Validate status
    if (!PRODUCT_STATUSES.includes(status)) {
      return next(new ErrorResponse(`Invalid status: ${status}`, 400));
    }

    const product = await Product.findById(productId)
      .populate('seller', 'name email notificationSettings');
    
    if (!product) {
      return next(new ErrorResponse(`Product not found with id ${productId}`, 404));
    }

    const previousStatus = product.status;
    
    // Update product
    product.status = status;
    product.statusHistory.push({
      status,
      changedBy: req.user.id,
      changedAt: new Date(),
      notes
    });
    
    if (notes) product.adminNotes = notes;
    
    await product.save();

    // Notification logic
    if (notifySeller && product.seller) {
      const sellerPrefersNotifications = 
        product.seller.notificationSettings?.productUpdates !== false;
      
      if (sellerPrefersNotifications) {
        await sendNotification({
          userId: product.seller._id,
          title: 'Product Status Updated',
          message: `Your product "${product.name}" is now ${status}`,
          type: 'product_update',
          metadata: {
            productId: product._id,
            productName: product.name,
            newStatus: status
          }
        });
      }
    }

    // Audit logging
    await createAuditLog({
      action: 'product_status_update',
      performedBy: req.user.id,
      targetType: 'Product',
      targetId: product._id,
      changes: {
        previousStatus,
        newStatus: status
      },
      metadata: {
        productName: product.name,
        sellerId: product.seller?._id,
        notes
      }
    });

    logger.info('Product status updated', {
      productId: product._id,
      previousStatus,
      newStatus: status,
      adminId: req.user.id,
      notifiedSeller: notifySeller
    });

    res.status(200).json({
      success: true,
      data: product,
      message: `Product status updated to ${status}`
    });
  } catch (error) {
    logger.error('Product status update failed', {
      error: error.message,
      productId: req.params.id,
      adminId: req.user.id,
      stack: error.stack
    });
    next(error);
  }
});

module.exports = {
  getDashboardStats,
  getAllOrders,
  getOrderAnalytics,
  updateOrderStatus,
  getAllUsers,
  updateUser,
  getAllProducts,
  updateProductStatus
};