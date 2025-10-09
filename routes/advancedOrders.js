/**
 * Advanced Order Management Routes
 * Amazon/Flipkart-style comprehensive order management system
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Import controllers and services
const {
  createOrder,
  getUserOrders,
  getOrder,
  updateOrderStatus
} = require('../controllers/ordercontroller');

const orderStatusManager = require('../services/orderStatusManager');
const orderProcessingEngine = require('../services/orderProcessingEngine');
const returnsManager = require('../services/returnsManager');

// Import middleware
const { hybridProtect } = require('../middleware/hybridAuth');
const asyncHandler = require('../middleware/asyncHandler');
const logger = require('../utils/logger');

// ========================
// CUSTOMER ORDER ROUTES
// ========================

/**
 * @route   POST /api/v1/orders
 * @desc    Create new order with advanced processing
 * @access  Private (Customer)
 */
router.post('/', hybridProtect, asyncHandler(async (req, res, next) => {
  try {
    const orderData = {
      userId: req.user.id,
      items: req.body.items,
      shippingAddress: req.body.shippingAddress,
      paymentMethod: req.body.paymentMethod || 'cod',
      paymentDetails: req.body.paymentDetails,
      couponCode: req.body.couponCode,
      customerEmail: req.user.email
    };

    const context = {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      sessionId: req.sessionID
    };

    // Use advanced order processing engine
    const result = await orderProcessingEngine.processOrder(orderData, context);

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order: {
        id: result.order._id,
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        total: result.order.pricing.totalPrice,
        estimatedDelivery: result.order.deliveryTracking.estimatedDeliveryDate,
        fraudScore: result.fraudScore,
        requiresVerification: result.fraudScore > 30
      },
      processingSteps: result.processingSteps
    });

  } catch (error) {
    logger.error('Advanced order creation failed', {
      userId: req.user?.id,
      error: error.message
    });
    
    res.status(400).json({
      success: false,
      message: error.message,
      error: 'order_creation_failed'
    });
  }
}));

/**
 * @route   GET /api/v1/orders
 * @desc    Get user's orders with advanced filtering
 * @access  Private (Customer)
 */
router.get('/', hybridProtect, asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  
  // Build query filters
  const filters = { user: req.user.id };
  
  if (req.query.status) {
    if (Array.isArray(req.query.status)) {
      filters.status = { $in: req.query.status };
    } else {
      filters.status = req.query.status;
    }
  }
  
  if (req.query.dateFrom || req.query.dateTo) {
    filters.createdAt = {};
    if (req.query.dateFrom) {
      filters.createdAt.$gte = new Date(req.query.dateFrom);
    }
    if (req.query.dateTo) {
      filters.createdAt.$lte = new Date(req.query.dateTo);
    }
  }
  
  if (req.query.minAmount || req.query.maxAmount) {
    filters['pricing.totalPrice'] = {};
    if (req.query.minAmount) {
      filters['pricing.totalPrice'].$gte = parseFloat(req.query.minAmount);
    }
    if (req.query.maxAmount) {
      filters['pricing.totalPrice'].$lte = parseFloat(req.query.maxAmount);
    }
  }

  // Search by order number or product name
  if (req.query.search) {
    filters.$or = [
      { orderNumber: { $regex: req.query.search, $options: 'i' } },
      { 'orderItems.name': { $regex: req.query.search, $options: 'i' } }
    ];
  }

  const Order = mongoose.model('Order');
  
  // Get orders with advanced projections
  const orders = await Order.find(filters)
    .select('orderNumber status pricing.totalPrice createdAt deliveryTracking.estimatedDeliveryDate deliveryTracking.isDelivered orderItems.name orderItems.image statusHistory')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Enhance order data
  const enhancedOrders = orders.map(order => ({
    ...order,
    canCancel: returnsManager.canOrderBeCancelled(order).allowed,
    canReturn: returnsManager.canOrderBeReturned(order).allowed,
    statusMeta: orderStatusManager.getStatusMeta(order.status),
    timeline: orderStatusManager.getOrderTimeline(order).slice(-3), // Last 3 status updates
    itemCount: order.orderItems?.length || 0,
    firstItemImage: order.orderItems?.[0]?.image || null
  }));

  const totalOrders = await Order.countDocuments(filters);

  res.json({
    success: true,
    orders: enhancedOrders,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      hasNext: page * limit < totalOrders,
      hasPrev: page > 1,
      limit
    },
    filters: {
      applied: Object.keys(req.query).filter(key => !['page', 'limit'].includes(key)),
      available: {
        statuses: orderStatusManager.getStatusWorkflow().statusMeta,
        dateRange: true,
        amountRange: true,
        search: true
      }
    }
  });
}));

/**
 * @route   GET /api/v1/orders/:id
 * @desc    Get single order with comprehensive details
 * @access  Private (Customer)
 */
router.get('/:id', hybridProtect, asyncHandler(async (req, res, next) => {
  const Order = mongoose.model('Order');
  
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user.id
  })
  .populate('orderItems.product', 'name images category brand')
  .populate('orderItems.seller', 'businessName verified')
  .lean();

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Enhance order with additional data
  const enhancedOrder = {
    ...order,
    statusMeta: orderStatusManager.getStatusMeta(order.status),
    timeline: orderStatusManager.getOrderTimeline(order),
    canCancel: returnsManager.canOrderBeCancelled(order),
    canReturn: returnsManager.canOrderBeReturned(order),
    returnStatus: returnsManager.getReturnStatus(order),
    deliveryTracking: {
      ...order.deliveryTracking,
      estimatedTimeRemaining: order.deliveryTracking?.estimatedDeliveryDate ? 
        Math.max(0, Math.ceil((new Date(order.deliveryTracking.estimatedDeliveryDate) - new Date()) / (1000 * 60 * 60 * 24))) : null
    }
  };

  res.json({
    success: true,
    order: enhancedOrder
  });
}));

// ========================
// ORDER STATUS MANAGEMENT
// ========================

/**
 * @route   GET /api/v1/orders/status/workflow
 * @desc    Get order status workflow configuration
 * @access  Private
 */
router.get('/status/workflow', hybridProtect, (req, res) => {
  const workflow = orderStatusManager.getStatusWorkflow();
  
  res.json({
    success: true,
    workflow
  });
});

/**
 * @route   PUT /api/v1/orders/:id/status
 * @desc    Update order status (Admin/Seller only)
 * @access  Private (Admin/Seller)
 */
router.put('/:id/status', hybridProtect, asyncHandler(async (req, res, next) => {
  const { status, note, deliveryProof } = req.body;
  
  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required'
    });
  }

  try {
    const result = await orderStatusManager.updateOrderStatus(req.params.id, status, {
      updatedBy: req.user.id,
      note,
      description: req.body.description,
      deliveryProof,
      systemGenerated: false
    });

    res.json({
      success: true,
      message: 'Order status updated successfully',
      order: {
        id: result.order._id,
        status: result.order.status,
        orderNumber: result.order.orderNumber,
        statusMeta: result.statusMeta
      }
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
      error: 'status_update_failed'
    });
  }
}));

/**
 * @route   POST /api/v1/orders/:id/track
 * @desc    Add tracking update
 * @access  Private (Admin/Delivery Partner)
 */
router.post('/:id/track', hybridProtect, asyncHandler(async (req, res, next) => {
  const Order = mongoose.model('Order');
  const { location, status, timestamp, note } = req.body;
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  // Add tracking update
  order.deliveryTracking = order.deliveryTracking || {};
  order.deliveryTracking.trackingUpdates = order.deliveryTracking.trackingUpdates || [];
  
  order.deliveryTracking.trackingUpdates.push({
    timestamp: timestamp ? new Date(timestamp) : new Date(),
    location,
    status,
    note,
    updatedBy: req.user.id
  });

  await order.save();

  res.json({
    success: true,
    message: 'Tracking update added successfully',
    trackingUpdate: order.deliveryTracking.trackingUpdates.slice(-1)[0]
  });
}));

// ========================
// CANCELLATION ROUTES
// ========================

/**
 * @route   GET /api/v1/orders/cancellation/reasons
 * @desc    Get cancellation reasons
 * @access  Private
 */
router.get('/cancellation/reasons', hybridProtect, (req, res) => {
  const reasons = returnsManager.getCancellationReasons();
  
  res.json({
    success: true,
    reasons
  });
});

/**
 * @route   POST /api/v1/orders/:id/cancel
 * @desc    Request order cancellation
 * @access  Private (Customer)
 */
router.post('/:id/cancel', hybridProtect, asyncHandler(async (req, res, next) => {
  const { reason, comment } = req.body;
  
  if (!reason) {
    return res.status(400).json({
      success: false,
      message: 'Cancellation reason is required'
    });
  }

  try {
    const result = await returnsManager.requestCancellation(req.params.id, req.user.id, {
      reason,
      comment
    });

    res.json({
      success: true,
      message: result.message,
      cancellationRequest: result.cancellationRequest
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
      error: 'cancellation_request_failed'
    });
  }
}));

// ========================
// RETURNS ROUTES
// ========================

/**
 * @route   GET /api/v1/orders/returns/reasons
 * @desc    Get return reasons
 * @access  Private
 */
router.get('/returns/reasons', hybridProtect, (req, res) => {
  const reasons = returnsManager.getReturnReasons();
  
  res.json({
    success: true,
    reasons
  });
});

/**
 * @route   POST /api/v1/orders/:id/return
 * @desc    Request order return
 * @access  Private (Customer)
 */
router.post('/:id/return', hybridProtect, asyncHandler(async (req, res, next) => {
  const { reason, comment, items, returnType, images } = req.body;
  
  if (!reason) {
    return res.status(400).json({
      success: false,
      message: 'Return reason is required'
    });
  }

  try {
    const result = await returnsManager.requestReturn(req.params.id, req.user.id, {
      reason,
      comment,
      items,
      returnType,
      images
    });

    res.json({
      success: true,
      message: result.message,
      returnRequest: result.returnRequest
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
      error: 'return_request_failed'
    });
  }
}));

/**
 * @route   GET /api/v1/orders/:id/returns/:requestId/status
 * @desc    Get return request status
 * @access  Private (Customer)
 */
router.get('/:id/returns/:requestId/status', hybridProtect, asyncHandler(async (req, res, next) => {
  const Order = mongoose.model('Order');
  
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user.id
  });

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  const returnRequest = order.returnInfo?.returnRequests?.find(
    req => req.requestId === req.params.requestId
  );

  if (!returnRequest) {
    return res.status(404).json({
      success: false,
      message: 'Return request not found'
    });
  }

  res.json({
    success: true,
    returnRequest: {
      requestId: returnRequest.requestId,
      status: returnRequest.status,
      reason: returnRequest.reasonLabel,
      requestedAt: returnRequest.requestedAt,
      approvedAt: returnRequest.approvedAt,
      pickedUpAt: returnRequest.pickedUpAt,
      trackingNumber: returnRequest.trackingNumber,
      refundAmount: returnRequest.refundAmount,
      pickupScheduled: returnRequest.pickupScheduled
    }
  });
}));

// ========================
// ADMIN ROUTES
// ========================

/**
 * @route   GET /api/v1/orders/admin/dashboard
 * @desc    Get admin dashboard data
 * @access  Private (Admin)
 */
router.get('/admin/dashboard', hybridProtect, asyncHandler(async (req, res, next) => {
  // Check if user is admin (you may have different logic)
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  const Order = mongoose.model('Order');
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const startOfWeek = new Date(today.setDate(today.getDate() - 7));
  const startOfMonth = new Date(today.setMonth(today.getMonth() - 1));

  const [
    todayOrders,
    weekOrders,
    monthOrders,
    statusCounts,
    recentOrders,
    highValueOrders,
    pendingReturns
  ] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: startOfDay } }),
    Order.countDocuments({ createdAt: { $gte: startOfWeek } }),
    Order.countDocuments({ createdAt: { $gte: startOfMonth } }),
    Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    Order.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('orderNumber status pricing.totalPrice createdAt customerInfo.name'),
    Order.find({ 'pricing.totalPrice': { $gte: 10000 }, status: { $ne: 'cancelled' } })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('orderNumber pricing.totalPrice createdAt customerInfo.name fraudCheck.riskScore'),
    Order.countDocuments({ 'returnInfo.returnRequests.status': 'pending' })
  ]);

  res.json({
    success: true,
    dashboard: {
      todayOrders,
      weekOrders,
      monthOrders,
      statusCounts: statusCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      recentOrders,
      highValueOrders,
      pendingReturns,
      generatedAt: new Date()
    }
  });
}));

/**
 * @route   PUT /api/v1/orders/:id/admin/fraud-review
 * @desc    Review and approve/reject high-risk orders
 * @access  Private (Admin)
 */
router.put('/:id/admin/fraud-review', hybridProtect, asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  const Order = mongoose.model('Order');
  const { action, note } = req.body; // action: 'approve' or 'reject'
  
  const order = await Order.findById(req.params.id);
  
  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Order not found'
    });
  }

  order.fraudCheck.isVerified = action === 'approve';
  order.fraudCheck.verificationMethod = 'manual_review';
  order.fraudCheck.reviewedBy = req.user.id;
  order.fraudCheck.reviewedAt = new Date();
  order.fraudCheck.reviewNote = note;

  if (action === 'approve') {
    await orderStatusManager.updateOrderStatus(order._id, 'confirmed', {
      updatedBy: req.user.id,
      description: 'Order approved after fraud review',
      note
    });
  } else {
    await orderStatusManager.updateOrderStatus(order._id, 'cancelled', {
      updatedBy: req.user.id,
      description: 'Order cancelled due to fraud concerns',
      note,
      cancellationReason: 'fraud_suspected'
    });
  }

  await order.save();

  res.json({
    success: true,
    message: `Order ${action}ed successfully`,
    order: {
      id: order._id,
      status: order.status,
      fraudCheck: order.fraudCheck
    }
  });
}));

/**
 * @route   POST /api/v1/orders/admin/bulk-status-update
 * @desc    Bulk update order statuses
 * @access  Private (Admin)
 */
router.post('/admin/bulk-status-update', hybridProtect, asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  const { orderIds, status, note } = req.body;
  
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Order IDs array is required'
    });
  }

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Status is required'
    });
  }

  try {
    const results = await orderStatusManager.bulkUpdateStatus(orderIds, status, {
      updatedBy: req.user.id,
      note,
      description: `Bulk update to ${status}`,
      systemGenerated: false
    });

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    res.json({
      success: true,
      message: `Bulk update completed: ${successful.length} successful, ${failed.length} failed`,
      results: {
        successful: successful.length,
        failed: failed.length,
        details: results
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bulk update failed',
      error: error.message
    });
  }
}));

module.exports = router;
