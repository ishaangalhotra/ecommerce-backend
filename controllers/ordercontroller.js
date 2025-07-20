const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const asyncHandler = require('../middleware/asyncHandler');
const ErrorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');
const { validationResult } = require('express-validator');
const { createAuditLog } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');
const { processPayment, createRefund } = require('../services/paymentService');
const { calculateShipping, estimateDelivery } = require('../services/shippingService');
const { generateInvoice } = require('../services/invoiceService');
const { io } = require('../server');

// Constants
const ORDER_STATUSES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded'
};

const PAYMENT_STATUSES = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded'
};

const DELIVERY_TYPES = {
  STANDARD: 'standard',
  EXPRESS: 'express',
  SCHEDULED: 'scheduled'
};

const DELIVERY_PROGRESS = {
  [ORDER_STATUSES.PENDING]: 10,
  [ORDER_STATUSES.CONFIRMED]: 25,
  [ORDER_STATUSES.PROCESSING]: 50,
  [ORDER_STATUSES.SHIPPED]: 75,
  [ORDER_STATUSES.DELIVERED]: 100,
  [ORDER_STATUSES.CANCELLED]: 0
};

/**
 * @class OrderController
 * @description Handles all order-related operations
 */
class OrderController {
  /**
   * @desc    Get user's orders with filtering and pagination
   * @route   GET /api/v1/orders
   * @access  Private
   * @param   {Object} req - Express request object
   * @param   {Object} res - Express response object
   * @param   {Function} next - Express next middleware function
   * @returns {Object} Paginated list of orders with summary statistics
   */
  static async getOrders(req, res, next) {
    try {
      const {
        page = 1,
        limit = 10,
        status,
        startDate,
        endDate,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // Build query
      const query = OrderController.buildOrderQuery(req.user.id, status, startDate, endDate);
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [orders, totalOrders, summary] = await Promise.all([
        Order.find(query)
          .populate('items.product', 'name images price')
          .populate('deliveryAgent', 'name phone')
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Order.countDocuments(query),
        OrderController.getOrderSummary(req.user.id)
      ]);

      const totalPages = Math.ceil(totalOrders / parseInt(limit));

      res.status(200).json({
        success: true,
        count: orders.length,
        data: orders,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalOrders,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        },
        summary: summary || { totalOrders: 0, totalSpent: 0, avgOrderValue: 0 }
      });
    } catch (error) {
      logger.error('Get orders error', {
        error: error.message,
        userId: req.user.id,
        stack: error.stack
      });
      next(error);
    }
  }

  /**
   * @desc    Get single order with detailed information
   * @route   GET /api/v1/orders/:id
   * @access  Private
   */
  static async getOrder(req, res, next) {
    try {
      const order = await Order.findOne({
        _id: req.params.id,
        user: req.user.id
      })
      .populate('items.product', 'name images price seller')
      .populate('deliveryAgent', 'name phone rating')
      .populate('user', 'name email phone');

      if (!order) {
        return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
      }

      const enhancedOrder = await OrderController.enhanceOrderData(order);

      res.status(200).json({
        success: true,
        data: enhancedOrder
      });
    } catch (error) {
      logger.error('Get order error', {
        error: error.message,
        orderId: req.params.id,
        userId: req.user.id,
        stack: error.stack
      });
      next(error);
    }
  }

  /**
   * @desc    Create order from cart with payment processing
   * @route   POST /api/v1/orders
   * @access  Private
   */
  static async createOrder(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const {
        shippingAddress,
        paymentMethod,
        deliveryType = DELIVERY_TYPES.STANDARD,
        specialInstructions,
        scheduledDelivery,
        couponCode
      } = req.body;

      // Process order creation
      const order = await OrderController.processOrderCreation({
        user: req.user,
        shippingAddress,
        paymentMethod,
        deliveryType,
        specialInstructions,
        scheduledDelivery,
        couponCode
      });

      res.status(201).json({
        success: true,
        data: order,
        message: 'Order created successfully'
      });
    } catch (error) {
      logger.error('Create order error', {
        error: error.message,
        userId: req.user.id,
        stack: error.stack
      });
      next(error);
    }
  }

  /**
   * @desc    Cancel order with refund processing
   * @route   PATCH /api/v1/orders/:id/cancel
   * @access  Private
   */
  static async cancelOrder(req, res, next) {
    try {
      const { reason } = req.body;

      const order = await Order.findOne({
        _id: req.params.id,
        user: req.user.id
      });

      if (!order) {
        return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
      }

      if (!OrderController.isOrderCancellable(order.status)) {
        return next(new ErrorResponse('Order cannot be cancelled at this stage', 400));
      }

      const cancelledOrder = await OrderController.processOrderCancellation(order, reason, req.user.id);

      res.status(200).json({
        success: true,
        data: cancelledOrder,
        message: 'Order cancelled successfully'
      });
    } catch (error) {
      logger.error('Cancel order error', {
        error: error.message,
        orderId: req.params.id,
        userId: req.user.id,
        stack: error.stack
      });
      next(error);
    }
  }

  /**
   * @desc    Update order status (Admin only)
   * @route   PUT /api/v1/orders/:id
   * @access  Private/Admin
   */
  static async updateOrder(req, res, next) {
    try {
      const { status, trackingNumber, deliveryAgent, estimatedDeliveryDate } = req.body;

      const order = await Order.findById(req.params.id)
        .populate('user', 'name email phone');

      if (!order) {
        return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
      }

      if (req.user.role !== 'admin') {
        return next(new ErrorResponse(`User ${req.user.id} is not authorized to update this order`, 403));
      }

      if (status && !OrderController.isValidStatusTransition(order.status, status)) {
        return next(new ErrorResponse(`Cannot change status from ${order.status} to ${status}`, 400));
      }

      const updatedOrder = await OrderController.processOrderUpdate(
        order, 
        { status, trackingNumber, deliveryAgent, estimatedDeliveryDate },
        req.user.id
      );

      res.status(200).json({
        success: true,
        data: updatedOrder,
        message: 'Order updated successfully'
      });
    } catch (error) {
      logger.error('Update order error', {
        error: error.message,
        orderId: req.params.id,
        adminId: req.user.id,
        stack: error.stack
      });
      next(error);
    }
  }

  /**
   * @desc    Generate and download invoice
   * @route   GET /api/v1/orders/:id/invoice
   * @access  Private
   */
  static async downloadInvoice(req, res, next) {
    try {
      const order = await Order.findOne({
        _id: req.params.id,
        user: req.user.id
      })
      .populate('items.product', 'name')
      .populate('user', 'name email phone');

      if (!order) {
        return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
      }

      if (order.status === ORDER_STATUSES.PENDING) {
        return next(new ErrorResponse('Invoice not available for pending orders', 400));
      }

      const invoice = await generateInvoice(order);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.orderNumber}.pdf`);
      
      res.status(200).send(invoice);
    } catch (error) {
      logger.error('Download invoice error', {
        error: error.message,
        orderId: req.params.id,
        userId: req.user.id,
        stack: error.stack
      });
      next(error);
    }
  }

  /**
   * @desc    Track order in real-time
   * @route   GET /api/v1/orders/:id/track
   * @access  Private
   */
  static async trackOrder(req, res, next) {
    try {
      const order = await Order.findOne({
        _id: req.params.id,
        user: req.user.id
      })
      .populate('deliveryAgent', 'name phone location')
      .select('status trackingNumber estimatedDeliveryDate deliveryAgent');

      if (!order) {
        return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
      }

      const trackingData = await OrderController.getTrackingData(order);

      res.status(200).json({
        success: true,
        data: trackingData
      });
    } catch (error) {
      logger.error('Track order error', {
        error: error.message,
        orderId: req.params.id,
        userId: req.user.id,
        stack: error.stack
      });
      next(error);
    }
  }

  // Helper Methods

  static buildOrderQuery(userId, status, startDate, endDate) {
    const query = { user: userId };
    
    if (status) {
      query.status = status;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    return query;
  }

  static async getOrderSummary(userId) {
    const result = await Order.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$pricing.total' },
          avgOrderValue: { $avg: '$pricing.total' }
        }
      }
    ]);

    return result[0] || { totalOrders: 0, totalSpent: 0, avgOrderValue: 0 };
  }

  static async enhanceOrderData(order) {
    const canCancel = OrderController.isOrderCancellable(order.status);
    const deliveryProgress = DELIVERY_PROGRESS[order.status] || 0;
    
    let trackingInfo = null;
    if (order.status === ORDER_STATUSES.SHIPPED && order.trackingNumber) {
      trackingInfo = await OrderController.getTrackingInfo(order.trackingNumber);
    }

    return {
      ...order.toObject(),
      canCancel,
      deliveryProgress,
      trackingInfo,
      estimatedDelivery: order.estimatedDeliveryDate
    };
  }

  static async processOrderCreation({
    user,
    shippingAddress,
    paymentMethod,
    deliveryType,
    specialInstructions,
    scheduledDelivery,
    couponCode
  }) {
    const cart = await Cart.findOne({ user: user.id })
      .populate('items.product', 'name price stock seller');

    if (!cart || cart.items.length === 0) {
      throw new ErrorResponse('No items in cart', 400);
    }

    OrderController.validateCartItems(cart.items);

    const pricing = await OrderController.calculateOrderPricing(
      cart.items,
      shippingAddress,
      deliveryType,
      couponCode,
      user.id
    );

    const orderNumber = await OrderController.generateOrderNumber();

    const order = await Order.create({
      orderNumber,
      user: user.id,
      items: cart.items.map(item => ({
        product: item.product._id,
        name: item.product.name,
        quantity: item.quantity,
        price: item.price,
        seller: item.product.seller
      })),
      pricing,
      shippingAddress,
      paymentMethod,
      deliveryType,
      specialInstructions,
      scheduledDelivery: scheduledDelivery ? new Date(scheduledDelivery) : null,
      estimatedDeliveryDate: await estimateDelivery(shippingAddress, deliveryType),
      status: ORDER_STATUSES.PENDING,
      paymentStatus: PAYMENT_STATUSES.PENDING
    });

    // Process payment if not COD
    if (paymentMethod !== 'cod') {
      await OrderController.processOrderPayment(order, user.email);
    }

    // Update product stock and clear cart
    await OrderController.updateProductStock(cart.items);
    await Cart.findOneAndDelete({ user: user.id });

    // Send notifications and create audit log
    await OrderController.sendOrderNotifications(order, user.id);
    await createAuditLog({
      action: 'order_created',
      userId: user.id,
      targetId: order._id,
      details: { total: pricing.total, itemCount: cart.items.length }
    });

    // Real-time update
    io.to(`user_${user.id}`).emit('orderCreated', {
      orderId: order._id,
      orderNumber,
      total: pricing.total
    });

    logger.info('Order created successfully', {
      orderId: order._id,
      orderNumber,
      userId: user.id,
      total: pricing.total
    });

    return order;
  }

  static validateCartItems(items) {
    for (const item of items) {
      if (!item.product) {
        throw new ErrorResponse('Product not found in cart', 400);
      }
      
      if (item.product.stock < item.quantity) {
        throw new ErrorResponse(
          `Insufficient stock for ${item.product.name}. Available: ${item.product.stock}`,
          400
        );
      }
    }
  }

  static async calculateOrderPricing(items, shippingAddress, deliveryType, couponCode, userId) {
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shippingCost = await calculateShipping(shippingAddress, deliveryType, items);
    const taxAmount = subtotal * 0.18; // 18% GST
    
    let discount = 0;
    if (couponCode) {
      discount = await OrderController.applyCoupon(couponCode, subtotal, userId);
    }

    const total = subtotal + shippingCost + taxAmount - discount;

    return {
      subtotal,
      shipping: shippingCost,
      tax: taxAmount,
      discount,
      total
    };
  }

  static async processOrderPayment(order, userEmail) {
    const paymentResult = await processPayment({
      orderId: order._id,
      amount: order.pricing.total,
      paymentMethod: order.paymentMethod,
      userEmail
    });

    if (!paymentResult.success) {
      await Order.findByIdAndDelete(order._id);
      throw new ErrorResponse('Payment processing failed', 400);
    }

    order.paymentStatus = PAYMENT_STATUSES.COMPLETED;
    order.paymentDetails = paymentResult;
    await order.save();
  }

  static async updateProductStock(items) {
    const bulkOps = items.map(item => ({
      updateOne: {
        filter: { _id: item.product._id },
        update: { $inc: { stock: -item.quantity } }
      }
    }));

    await Product.bulkWrite(bulkOps);
  }

  static async sendOrderNotifications(order, userId) {
    await sendNotification({
      userId,
      title: 'Order Confirmed',
      message: `Your order #${order.orderNumber} has been confirmed`,
      type: 'order_confirmation',
      metadata: { orderId: order._id }
    });
  }

  static isOrderCancellable(status) {
    return [ORDER_STATUSES.PENDING, ORDER_STATUSES.CONFIRMED].includes(status);
  }

  static async processOrderCancellation(order, reason, userId) {
    order.status = ORDER_STATUSES.CANCELLED;
    order.cancellationReason = reason;
    order.cancelledAt = new Date();
    
    // Process refund if payment was made
    if (order.paymentStatus === PAYMENT_STATUSES.COMPLETED) {
      await OrderController.processOrderRefund(order, reason);
    }

    await order.save();

    // Restore product stock
    await OrderController.restoreProductStock(order.items);

    // Send notifications and create audit log
    await OrderController.sendCancellationNotification(order, userId);
    await createAuditLog({
      action: 'order_cancelled',
      userId,
      targetId: order._id,
      details: { reason }
    });

    // Real-time update
    io.to(`user_${userId}`).emit('orderCancelled', {
      orderId: order._id,
      orderNumber: order.orderNumber
    });

    logger.info('Order cancelled', {
      orderId: order._id,
      userId,
      reason
    });

    return order;
  }

  static async processOrderRefund(order, reason) {
    const refundResult = await createRefund({
      orderId: order._id,
      amount: order.pricing.total,
      reason: `Order cancelled: ${reason}`
    });

    if (refundResult.success) {
      order.paymentStatus = PAYMENT_STATUSES.REFUNDED;
      order.refundDetails = refundResult;
    }
  }

  static async restoreProductStock(items) {
    const bulkOps = items.map(item => ({
      updateOne: {
        filter: { _id: item.product },
        update: { $inc: { stock: item.quantity } }
      }
    }));

    await Product.bulkWrite(bulkOps);
  }

  static async sendCancellationNotification(order, userId) {
    await sendNotification({
      userId,
      title: 'Order Cancelled',
      message: `Your order #${order.orderNumber} has been cancelled`,
      type: 'order_cancellation',
      metadata: { orderId: order._id }
    });
  }

  static isValidStatusTransition(currentStatus, newStatus) {
    const validTransitions = {
      [ORDER_STATUSES.PENDING]: [ORDER_STATUSES.CONFIRMED, ORDER_STATUSES.CANCELLED],
      [ORDER_STATUSES.CONFIRMED]: [ORDER_STATUSES.PROCESSING, ORDER_STATUSES.CANCELLED],
      [ORDER_STATUSES.PROCESSING]: [ORDER_STATUSES.SHIPPED, ORDER_STATUSES.CANCELLED],
      [ORDER_STATUSES.SHIPPED]: [ORDER_STATUSES.DELIVERED],
      [ORDER_STATUSES.DELIVERED]: [],
      [ORDER_STATUSES.CANCELLED]: []
    };
    
    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  static async processOrderUpdate(order, updateData, adminId) {
    const previousStatus = order.status;

    Object.assign(order, {
      ...updateData,
      updatedAt: new Date(),
      ...(updateData.estimatedDeliveryDate && {
        estimatedDeliveryDate: new Date(updateData.estimatedDeliveryDate)
      })
    });

    await order.save();

    // Send notification to customer
    await OrderController.sendStatusUpdateNotification(order, previousStatus);

    // Real-time update
    io.to(`user_${order.user._id}`).emit('orderStatusUpdated', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status: order.status
    });

    // Create audit log
    await createAuditLog({
      action: 'order_status_updated',
      userId: adminId,
      targetId: order._id,
      details: { previousStatus, newStatus: order.status }
    });

    logger.info('Order updated by admin', {
      orderId: order._id,
      adminId,
      previousStatus,
      newStatus: order.status
    });

    return order;
  }

  static async sendStatusUpdateNotification(order, previousStatus) {
    if (order.status !== previousStatus) {
      await sendNotification({
        userId: order.user._id,
        title: 'Order Status Updated',
        message: `Your order #${order.orderNumber} status updated to ${order.status}`,
        type: 'order_update',
        metadata: { orderId: order._id, newStatus: order.status }
      });
    }
  }

  static async generateOrderNumber() {
    const today = new Date();
    const datePrefix = today.getFullYear().toString().slice(-2) +
      (today.getMonth() + 1).toString().padStart(2, '0') +
      today.getDate().toString().padStart(2, '0');
    
    const count = await Order.countDocuments({
      createdAt: {
        $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        $lt: new Date(today.getYear(), today.getMonth(), today.getDate() + 1)
      }
    });
    
    return `ORD${datePrefix}${(count + 1).toString().padStart(4, '0')}`;
  }

  static async applyCoupon(couponCode, subtotal, userId) {
    // Implement actual coupon logic here
    return 0; // Placeholder
  }

  static async getTrackingInfo(trackingNumber) {
    // Implement external tracking API integration
    return { status: 'In Transit', lastUpdate: new Date() };
  }

  static async getTrackingData(order) {
    const trackingData = {
      status: order.status,
      estimatedDelivery: order.estimatedDeliveryDate
    };

    if (order.trackingNumber) {
      trackingData.externalTracking = await OrderController.getTrackingInfo(order.trackingNumber);
    }

    if (order.status === ORDER_STATUSES.SHIPPED && order.deliveryAgent?.location) {
      trackingData.agentLocation = order.deliveryAgent.location;
      trackingData.agent = {
        name: order.deliveryAgent.name,
        phone: order.deliveryAgent.phone
      };
    }

    return trackingData;
  }
}

module.exports = OrderController;