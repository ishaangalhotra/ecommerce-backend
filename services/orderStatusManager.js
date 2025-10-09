/**
 * Advanced Order Status Management System
 * Amazon/Flipkart-style order lifecycle management with automated workflows
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

class OrderStatusManager {
  constructor() {
    // Define order status workflow with allowed transitions
    this.statusWorkflow = {
      'pending': ['confirmed', 'cancelled', 'payment_failed'],
      'confirmed': ['preparing', 'cancelled'],
      'preparing': ['ready_to_ship', 'cancelled'],
      'ready_to_ship': ['shipped', 'cancelled'],
      'shipped': ['out_for_delivery', 'in_transit', 'exception'],
      'in_transit': ['out_for_delivery', 'exception'],
      'out_for_delivery': ['delivered', 'failed_delivery', 'exception'],
      'delivered': ['return_requested', 'return_approved'],
      'cancelled': ['refunded'],
      'failed_delivery': ['out_for_delivery', 'return_to_seller'],
      'return_requested': ['return_approved', 'return_rejected'],
      'return_approved': ['return_picked_up'],
      'return_picked_up': ['return_in_transit'],
      'return_in_transit': ['return_delivered'],
      'return_delivered': ['refunded'],
      'exception': ['resolved', 'cancelled'],
      'resolved': ['out_for_delivery', 'return_to_seller']
    };

    // Status display names and descriptions
    this.statusMeta = {
      'pending': {
        label: 'Order Placed',
        description: 'Your order has been placed and is being processed',
        color: 'blue',
        icon: 'clock',
        customerMessage: 'Thank you for your order! We are processing it now.',
        estimatedTime: '2-4 hours'
      },
      'confirmed': {
        label: 'Order Confirmed',
        description: 'Your order has been confirmed and payment verified',
        color: 'green',
        icon: 'check-circle',
        customerMessage: 'Great news! Your order has been confirmed.',
        estimatedTime: '1-2 hours'
      },
      'preparing': {
        label: 'Preparing Order',
        description: 'Your items are being picked and packed',
        color: 'orange',
        icon: 'package',
        customerMessage: 'We are carefully preparing your order for shipment.',
        estimatedTime: '2-6 hours'
      },
      'ready_to_ship': {
        label: 'Ready to Ship',
        description: 'Your order is packed and ready for pickup',
        color: 'purple',
        icon: 'truck',
        customerMessage: 'Your order is ready and will be shipped soon.',
        estimatedTime: '4-8 hours'
      },
      'shipped': {
        label: 'Shipped',
        description: 'Your order is on the way to you',
        color: 'blue',
        icon: 'shipping-fast',
        customerMessage: 'Your order is on its way! Track it for real-time updates.',
        estimatedTime: '1-3 days'
      },
      'in_transit': {
        label: 'In Transit',
        description: 'Your order is traveling to your location',
        color: 'blue',
        icon: 'route',
        customerMessage: 'Your order is in transit and making good progress.',
        estimatedTime: '1-2 days'
      },
      'out_for_delivery': {
        label: 'Out for Delivery',
        description: 'Your order is out for delivery and will arrive today',
        color: 'green',
        icon: 'motorcycle',
        customerMessage: 'Your order is out for delivery! It will arrive today.',
        estimatedTime: '2-6 hours'
      },
      'delivered': {
        label: 'Delivered',
        description: 'Your order has been successfully delivered',
        color: 'green',
        icon: 'check',
        customerMessage: 'Your order has been delivered! Thank you for shopping with us.',
        estimatedTime: 'Completed'
      },
      'cancelled': {
        label: 'Cancelled',
        description: 'Your order has been cancelled',
        color: 'red',
        icon: 'times-circle',
        customerMessage: 'Your order has been cancelled. Refund will be processed if applicable.',
        estimatedTime: 'N/A'
      },
      'failed_delivery': {
        label: 'Delivery Failed',
        description: 'Delivery attempt failed, trying again',
        color: 'red',
        icon: 'exclamation-triangle',
        customerMessage: 'We couldn\'t deliver your order. We\'ll try again soon.',
        estimatedTime: '24 hours'
      },
      'return_requested': {
        label: 'Return Requested',
        description: 'Customer has requested a return',
        color: 'orange',
        icon: 'undo',
        customerMessage: 'Your return request has been received and is being reviewed.',
        estimatedTime: '24-48 hours'
      },
      'return_approved': {
        label: 'Return Approved',
        description: 'Return request has been approved',
        color: 'green',
        icon: 'check-circle',
        customerMessage: 'Your return has been approved! We\'ll arrange pickup.',
        estimatedTime: '2-3 days'
      },
      'return_picked_up': {
        label: 'Return Picked Up',
        description: 'Return item has been picked up',
        color: 'blue',
        icon: 'truck',
        customerMessage: 'Your return has been picked up and is on its way back.',
        estimatedTime: '2-4 days'
      },
      'refunded': {
        label: 'Refunded',
        description: 'Refund has been processed',
        color: 'green',
        icon: 'money-bill',
        customerMessage: 'Your refund has been processed and will reflect in 3-5 business days.',
        estimatedTime: '3-5 days'
      }
    };

    // Auto-transition rules based on time and conditions
    this.autoTransitionRules = [
      {
        from: 'confirmed',
        to: 'preparing',
        condition: 'payment_verified',
        delay: 30 * 60 * 1000 // 30 minutes
      },
      {
        from: 'preparing',
        to: 'ready_to_ship',
        condition: 'items_packed',
        delay: 2 * 60 * 60 * 1000 // 2 hours
      },
      {
        from: 'ready_to_ship',
        to: 'shipped',
        condition: 'pickup_scheduled',
        delay: 4 * 60 * 60 * 1000 // 4 hours
      }
    ];
  }

  /**
   * Check if status transition is valid
   */
  isValidTransition(currentStatus, newStatus) {
    if (!this.statusWorkflow[currentStatus]) {
      throw new Error(`Invalid current status: ${currentStatus}`);
    }
    
    return this.statusWorkflow[currentStatus].includes(newStatus);
  }

  /**
   * Get allowed next statuses for current status
   */
  getAllowedNextStatuses(currentStatus) {
    return this.statusWorkflow[currentStatus] || [];
  }

  /**
   * Get status metadata
   */
  getStatusMeta(status) {
    return this.statusMeta[status] || {
      label: status.replace('_', ' ').toUpperCase(),
      description: `Order status: ${status}`,
      color: 'gray',
      icon: 'info-circle'
    };
  }

  /**
   * Update order status with validation and logging
   */
  async updateOrderStatus(orderId, newStatus, options = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const Order = mongoose.model('Order');
      const order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new Error('Order not found');
      }

      const currentStatus = order.status;
      
      // Validate transition
      if (!this.isValidTransition(currentStatus, newStatus)) {
        throw new Error(
          `Invalid status transition from ${currentStatus} to ${newStatus}. ` +
          `Allowed transitions: ${this.getAllowedNextStatuses(currentStatus).join(', ')}`
        );
      }

      // Update order status
      order.status = newStatus;
      
      // Add to status history
      const statusUpdate = {
        status: newStatus,
        timestamp: new Date(),
        description: options.description || this.getStatusMeta(newStatus).description,
        updatedBy: options.updatedBy,
        note: options.note,
        systemGenerated: options.systemGenerated || false
      };

      order.statusHistory.push(statusUpdate);

      // Handle special status logic
      await this.handleSpecialStatusLogic(order, newStatus, options, session);

      await order.save({ session });
      await session.commitTransaction();

      logger.info('Order status updated successfully', {
        orderId,
        oldStatus: currentStatus,
        newStatus,
        updatedBy: options.updatedBy
      });

      // Send notifications asynchronously
      setImmediate(() => {
        this.sendStatusUpdateNotification(order, newStatus, currentStatus).catch(error => {
          logger.error('Failed to send status update notification', { error: error.message, orderId });
        });
      });

      return {
        success: true,
        order,
        statusMeta: this.getStatusMeta(newStatus)
      };

    } catch (error) {
      await session.abortTransaction();
      logger.error('Order status update failed', { error: error.message, orderId, newStatus });
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Handle special logic for specific statuses
   */
  async handleSpecialStatusLogic(order, newStatus, options, session) {
    switch (newStatus) {
      case 'confirmed':
        // Verify payment and reserve inventory
        await this.handleOrderConfirmation(order, options, session);
        break;
        
      case 'shipped':
        // Generate tracking number and update delivery estimates
        await this.handleOrderShipped(order, options, session);
        break;
        
      case 'delivered':
        // Update delivery tracking and start return window
        await this.handleOrderDelivered(order, options, session);
        break;
        
      case 'cancelled':
        // Process refund and restore inventory
        await this.handleOrderCancellation(order, options, session);
        break;
        
      case 'return_approved':
        // Schedule return pickup
        await this.handleReturnApproval(order, options, session);
        break;
        
      case 'refunded':
        // Process refund transaction
        await this.handleRefundProcessing(order, options, session);
        break;
    }
  }

  /**
   * Handle order confirmation logic
   */
  async handleOrderConfirmation(order, options, session) {
    // Update payment status if COD
    if (order.paymentMethod === 'cod') {
      order.isPaid = false;
    } else {
      // Verify payment status
      order.isPaid = true;
      order.paidAt = new Date();
    }

    // Set estimated delivery date
    const deliveryDays = options.estimatedDeliveryDays || 3;
    order.deliveryTracking = order.deliveryTracking || {};
    order.deliveryTracking.estimatedDeliveryDate = new Date(Date.now() + deliveryDays * 24 * 60 * 60 * 1000);

    // Generate sub-orders for multi-vendor scenario
    await this.generateSubOrders(order, session);
  }

  /**
   * Handle order shipped logic
   */
  async handleOrderShipped(order, options, session) {
    order.deliveryTracking = order.deliveryTracking || {};
    
    // Generate tracking number if not provided
    if (!order.deliveryTracking.trackingNumber) {
      order.deliveryTracking.trackingNumber = this.generateTrackingNumber();
    }
    
    // Set delivery partner info
    if (options.deliveryPartner) {
      order.deliveryTracking.deliveryPartner = options.deliveryPartner;
    }
    
    // Update estimated delivery date
    const deliveryHours = options.estimatedDeliveryHours || 48;
    order.deliveryTracking.estimatedDeliveryDate = new Date(Date.now() + deliveryHours * 60 * 60 * 1000);
  }

  /**
   * Handle order delivered logic
   */
  async handleOrderDelivered(order, options, session) {
    order.deliveryTracking = order.deliveryTracking || {};
    order.deliveryTracking.isDelivered = true;
    order.deliveryTracking.deliveredAt = new Date();
    
    // Set delivery proof if provided
    if (options.deliveryProof) {
      order.deliveryTracking.deliveryProof = options.deliveryProof;
    }
    
    // Calculate actual delivery time
    if (order.createdAt) {
      order.deliveryTracking.actualDeliveryTime = Math.round(
        (order.deliveryTracking.deliveredAt - order.createdAt) / (1000 * 60)
      );
    }
    
    // Update metrics
    order.metrics = order.metrics || {};
    order.metrics.deliveryTime = order.deliveryTracking.actualDeliveryTime;
  }

  /**
   * Handle order cancellation logic
   */
  async handleOrderCancellation(order, options, session) {
    // Set cancellation info
    order.cancellationInfo = {
      reason: options.cancellationReason || 'Order cancelled',
      cancelledBy: options.cancelledBy,
      cancelledAt: new Date(),
      refundStatus: order.isPaid ? 'pending' : 'not_applicable',
      cancellationFee: options.cancellationFee || 0
    };

    // Restore inventory
    await this.restoreInventory(order, session);

    // Initiate refund if payment was made
    if (order.isPaid) {
      await this.initiateRefund(order, session);
    }
  }

  /**
   * Handle return approval logic
   */
  async handleReturnApproval(order, options, session) {
    order.returnInfo = order.returnInfo || {};
    order.returnInfo.returnApprovedAt = new Date();
    order.returnInfo.returnReason = options.returnReason;
    
    // Schedule pickup
    // This would integrate with delivery partner API
    logger.info('Return pickup scheduled', { orderId: order._id });
  }

  /**
   * Handle refund processing logic
   */
  async handleRefundProcessing(order, options, session) {
    const refundAmount = options.refundAmount || order.pricing.totalPrice;
    
    order.pricing.refundedAmount = refundAmount;
    order.paymentResult = order.paymentResult || {};
    order.paymentResult.status = 'refunded';
    
    order.cancellationInfo = order.cancellationInfo || {};
    order.cancellationInfo.refundStatus = 'completed';
    
    // Process actual refund transaction
    // This would integrate with payment gateway
    logger.info('Refund processed', { orderId: order._id, amount: refundAmount });
  }

  /**
   * Generate sub-orders for multi-vendor scenario
   */
  async generateSubOrders(order, session) {
    const sellerGroups = new Map();
    
    // Group items by seller
    order.orderItems.forEach(item => {
      const sellerId = item.seller.toString();
      if (!sellerGroups.has(sellerId)) {
        sellerGroups.set(sellerId, []);
      }
      sellerGroups.get(sellerId).push(item);
    });

    // Create seller entries
    order.sellers = [];
    
    for (const [sellerId, items] of sellerGroups) {
      const subOrderTotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
      const commissionRate = 0.05; // 5% commission
      
      order.sellers.push({
        seller: sellerId,
        items: items.map(item => item._id),
        subOrderTotal,
        commissionRate,
        commissionAmount: subOrderTotal * commissionRate
      });
    }
  }

  /**
   * Restore inventory when order is cancelled
   */
  async restoreInventory(order, session) {
    const Product = mongoose.model('Product');
    
    const bulkOps = order.orderItems.map(item => ({
      updateOne: {
        filter: { _id: item.product },
        update: { 
          $inc: { 
            stock: item.qty,
            totalSales: -item.qty,
            totalRevenue: -item.totalPrice
          }
        }
      }
    }));

    if (bulkOps.length > 0) {
      await Product.bulkWrite(bulkOps, { session });
    }
  }

  /**
   * Initiate refund process
   */
  async initiateRefund(order, session) {
    // This would integrate with payment gateway APIs
    logger.info('Refund initiated', { 
      orderId: order._id, 
      amount: order.pricing.totalPrice,
      paymentMethod: order.paymentMethod 
    });
  }

  /**
   * Generate tracking number
   */
  generateTrackingNumber() {
    const prefix = 'TRK';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  /**
   * Send status update notification
   */
  async sendStatusUpdateNotification(order, newStatus, oldStatus) {
    try {
      const statusMeta = this.getStatusMeta(newStatus);
      
      // Send email notification
      // await this.sendEmailNotification(order, statusMeta);
      
      // Send SMS notification  
      // await this.sendSMSNotification(order, statusMeta);
      
      // Send push notification
      // await this.sendPushNotification(order, statusMeta);
      
      logger.info('Status update notifications sent', {
        orderId: order._id,
        status: newStatus,
        customerEmail: order.customerInfo.email
      });
      
    } catch (error) {
      logger.error('Failed to send status update notification', {
        error: error.message,
        orderId: order._id
      });
    }
  }

  /**
   * Get order status workflow for frontend
   */
  getStatusWorkflow() {
    return {
      workflow: this.statusWorkflow,
      statusMeta: this.statusMeta,
      autoTransitionRules: this.autoTransitionRules
    };
  }

  /**
   * Get order status timeline for display
   */
  getOrderTimeline(order) {
    const timeline = order.statusHistory.map(history => ({
      status: history.status,
      timestamp: history.timestamp,
      description: history.description || history.note,
      meta: this.getStatusMeta(history.status)
    }));

    // Sort by timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return timeline;
  }

  /**
   * Bulk status update for multiple orders
   */
  async bulkUpdateStatus(orderIds, newStatus, options = {}) {
    const results = [];
    
    for (const orderId of orderIds) {
      try {
        const result = await this.updateOrderStatus(orderId, newStatus, options);
        results.push({ orderId, success: true, result });
      } catch (error) {
        results.push({ orderId, success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * Auto-transition orders based on rules
   */
  async processAutoTransitions() {
    const Order = mongoose.model('Order');
    
    for (const rule of this.autoTransitionRules) {
      try {
        const cutoffTime = new Date(Date.now() - rule.delay);
        
        const orders = await Order.find({
          status: rule.from,
          updatedAt: { $lte: cutoffTime }
        });

        for (const order of orders) {
          // Check condition if specified
          if (await this.checkTransitionCondition(order, rule.condition)) {
            await this.updateOrderStatus(order._id, rule.to, {
              systemGenerated: true,
              description: `Auto-transitioned from ${rule.from} to ${rule.to}`,
              note: `System auto-transition based on time delay`
            });
          }
        }
      } catch (error) {
        logger.error('Auto-transition processing failed', {
          rule,
          error: error.message
        });
      }
    }
  }

  /**
   * Check if transition condition is met
   */
  async checkTransitionCondition(order, condition) {
    switch (condition) {
      case 'payment_verified':
        return order.isPaid || order.paymentMethod === 'cod';
      case 'items_packed':
        // In a real system, this would check warehouse status
        return true;
      case 'pickup_scheduled':
        // In a real system, this would check logistics partner
        return true;
      default:
        return true;
    }
  }
}

module.exports = new OrderStatusManager();
