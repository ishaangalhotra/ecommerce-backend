/**
 * Advanced Returns & Cancellation Management System
 * Amazon/Flipkart-style returns processing with automated RMA workflows
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const orderStatusManager = require('./orderStatusManager');

class ReturnsManager {
  constructor() {
    this.returnReasons = {
      'defective_product': {
        label: 'Defective/Damaged Product',
        refundEligible: true,
        replacementEligible: true,
        returnWindow: 7, // days
        priority: 'high',
        autoApprove: false
      },
      'wrong_item': {
        label: 'Wrong Item Delivered',
        refundEligible: true,
        replacementEligible: true,
        returnWindow: 7,
        priority: 'high',
        autoApprove: true
      },
      'not_as_described': {
        label: 'Product Not as Described',
        refundEligible: true,
        replacementEligible: true,
        returnWindow: 7,
        priority: 'medium',
        autoApprove: false
      },
      'changed_mind': {
        label: 'Changed Mind/No Longer Need',
        refundEligible: true,
        replacementEligible: false,
        returnWindow: 3,
        priority: 'low',
        autoApprove: false,
        returnFee: 50
      },
      'size_fit_issue': {
        label: 'Size/Fit Issue',
        refundEligible: true,
        replacementEligible: true,
        returnWindow: 7,
        priority: 'medium',
        autoApprove: true
      },
      'quality_issue': {
        label: 'Poor Quality',
        refundEligible: true,
        replacementEligible: true,
        returnWindow: 7,
        priority: 'medium',
        autoApprove: false
      },
      'delivery_issue': {
        label: 'Delivery Related Issue',
        refundEligible: true,
        replacementEligible: true,
        returnWindow: 2,
        priority: 'high',
        autoApprove: true
      }
    };

    this.cancellationReasons = {
      'duplicate_order': {
        label: 'Accidentally Placed Duplicate Order',
        refundEligible: true,
        cancellationFee: 0,
        autoApprove: true
      },
      'changed_mind': {
        label: 'Changed Mind',
        refundEligible: true,
        cancellationFee: 25,
        autoApprove: false
      },
      'delivery_delay': {
        label: 'Delivery Taking Too Long',
        refundEligible: true,
        cancellationFee: 0,
        autoApprove: true
      },
      'found_better_price': {
        label: 'Found Better Price Elsewhere',
        refundEligible: true,
        cancellationFee: 50,
        autoApprove: false
      },
      'technical_issue': {
        label: 'Technical Issue During Order',
        refundEligible: true,
        cancellationFee: 0,
        autoApprove: true
      }
    };
  }

  /**
   * Request order cancellation
   */
  async requestCancellation(orderId, userId, cancellationData) {
    try {
      const Order = mongoose.model('Order');
      const order = await Order.findOne({ _id: orderId, user: userId });

      if (!order) {
        throw new Error('Order not found');
      }

      // Check if order can be cancelled
      const canCancel = this.canOrderBeCancelled(order);
      if (!canCancel.allowed) {
        throw new Error(canCancel.reason);
      }

      const reason = this.cancellationReasons[cancellationData.reason];
      if (!reason) {
        throw new Error('Invalid cancellation reason');
      }

      // Create cancellation request
      const cancellationRequest = {
        requestId: `CANC_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        reason: cancellationData.reason,
        reasonLabel: reason.label,
        customerComment: cancellationData.comment,
        requestedAt: new Date(),
        status: reason.autoApprove ? 'approved' : 'pending',
        cancellationFee: reason.cancellationFee || 0,
        refundAmount: order.pricing.totalPrice - (reason.cancellationFee || 0),
        autoApproved: reason.autoApprove
      };

      // Update order with cancellation info
      order.cancellationInfo = cancellationRequest;

      if (reason.autoApprove) {
        // Auto-approve and process cancellation
        await this.processCancellation(order, cancellationRequest);
      }

      await order.save();

      logger.info('Cancellation request created', {
        orderId,
        requestId: cancellationRequest.requestId,
        autoApproved: reason.autoApprove
      });

      return {
        success: true,
        cancellationRequest,
        message: reason.autoApprove ? 
          'Your cancellation has been approved and processed' :
          'Your cancellation request has been submitted for review'
      };

    } catch (error) {
      logger.error('Cancellation request failed', { orderId, userId, error: error.message });
      throw error;
    }
  }

  /**
   * Process approved cancellation
   */
  async processCancellation(order, cancellationRequest) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Update order status to cancelled
      await orderStatusManager.updateOrderStatus(order._id, 'cancelled', {
        systemGenerated: true,
        description: `Order cancelled - ${cancellationRequest.reasonLabel}`,
        note: cancellationRequest.customerComment,
        cancellationReason: cancellationRequest.reason,
        cancellationFee: cancellationRequest.cancellationFee
      });

      // Process refund if applicable
      if (order.isPaid && cancellationRequest.refundAmount > 0) {
        await this.initiateRefund(order, cancellationRequest.refundAmount, 'cancellation');
      }

      // Update cancellation status
      order.cancellationInfo.status = 'approved';
      order.cancellationInfo.processedAt = new Date();
      
      await order.save({ session });
      await session.commitTransaction();

      // Send notification
      await this.sendCancellationNotification(order, 'approved');

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Request return for delivered order
   */
  async requestReturn(orderId, userId, returnData) {
    try {
      const Order = mongoose.model('Order');
      const order = await Order.findOne({ _id: orderId, user: userId });

      if (!order) {
        throw new Error('Order not found');
      }

      // Check if order can be returned
      const canReturn = this.canOrderBeReturned(order);
      if (!canReturn.allowed) {
        throw new Error(canReturn.reason);
      }

      const reason = this.returnReasons[returnData.reason];
      if (!reason) {
        throw new Error('Invalid return reason');
      }

      // Check if return window is still valid
      const daysSinceDelivery = Math.floor(
        (Date.now() - order.deliveryTracking.deliveredAt) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceDelivery > reason.returnWindow) {
        throw new Error(`Return window of ${reason.returnWindow} days has expired`);
      }

      // Create return request
      const returnRequest = {
        requestId: `RET_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        reason: returnData.reason,
        reasonLabel: reason.label,
        customerComment: returnData.comment,
        requestedItems: returnData.items || order.orderItems.map(item => ({
          itemId: item._id,
          productId: item.product,
          name: item.name,
          quantity: item.qty,
          returnQuantity: item.qty,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice
        })),
        returnType: returnData.returnType || 'refund', // 'refund' or 'replacement'
        requestedAt: new Date(),
        status: reason.autoApprove ? 'approved' : 'pending',
        priority: reason.priority,
        returnWindow: reason.returnWindow,
        returnFee: reason.returnFee || 0,
        autoApproved: reason.autoApprove,
        images: returnData.images || [],
        customerAddress: order.shippingAddress
      };

      // Calculate return amount
      const totalReturnValue = returnRequest.requestedItems.reduce(
        (sum, item) => sum + (item.totalPrice * (item.returnQuantity / item.quantity)), 0
      );

      returnRequest.refundAmount = totalReturnValue - (reason.returnFee || 0);

      // Update order with return info
      order.returnInfo = {
        ...order.returnInfo,
        isReturned: false,
        returnRequests: [returnRequest]
      };

      if (reason.autoApprove) {
        // Auto-approve return
        await this.approveReturn(order, returnRequest.requestId);
      }

      await order.save();

      logger.info('Return request created', {
        orderId,
        requestId: returnRequest.requestId,
        returnValue: totalReturnValue,
        autoApproved: reason.autoApprove
      });

      return {
        success: true,
        returnRequest,
        message: reason.autoApprove ?
          'Your return has been approved. We will arrange pickup shortly.' :
          'Your return request has been submitted for review'
      };

    } catch (error) {
      logger.error('Return request failed', { orderId, userId, error: error.message });
      throw error;
    }
  }

  /**
   * Approve return request
   */
  async approveReturn(order, requestId, approverData = {}) {
    try {
      const returnRequest = order.returnInfo?.returnRequests?.find(
        req => req.requestId === requestId
      );

      if (!returnRequest) {
        throw new Error('Return request not found');
      }

      if (returnRequest.status === 'approved') {
        throw new Error('Return request already approved');
      }

      // Update return request status
      returnRequest.status = 'approved';
      returnRequest.approvedAt = new Date();
      returnRequest.approvedBy = approverData.approvedBy;
      returnRequest.approverComment = approverData.comment;

      // Schedule pickup
      const pickupDetails = await this.scheduleReturnPickup(order, returnRequest);
      returnRequest.pickupScheduled = pickupDetails;

      // Update order status
      await orderStatusManager.updateOrderStatus(order._id, 'return_approved', {
        systemGenerated: !approverData.approvedBy,
        description: 'Return request approved',
        note: approverData.comment,
        returnReason: returnRequest.reason
      });

      await order.save();

      // Send notifications
      await this.sendReturnNotification(order, returnRequest, 'approved');

      logger.info('Return request approved', {
        orderId: order._id,
        requestId,
        pickupDate: pickupDetails.scheduledDate
      });

      return {
        success: true,
        returnRequest,
        pickupDetails
      };

    } catch (error) {
      logger.error('Return approval failed', { orderId: order._id, requestId, error: error.message });
      throw error;
    }
  }

  /**
   * Process return pickup
   */
  async processReturnPickup(orderId, requestId, pickupData) {
    try {
      const Order = mongoose.model('Order');
      const order = await Order.findById(orderId);

      if (!order) {
        throw new Error('Order not found');
      }

      const returnRequest = order.returnInfo?.returnRequests?.find(
        req => req.requestId === requestId
      );

      if (!returnRequest) {
        throw new Error('Return request not found');
      }

      // Update return request with pickup info
      returnRequest.pickupCompleted = true;
      returnRequest.pickedUpAt = new Date();
      returnRequest.pickupAgent = pickupData.agentInfo;
      returnRequest.pickupProof = pickupData.proof; // images, signature, etc.

      // Update order status
      await orderStatusManager.updateOrderStatus(order._id, 'return_picked_up', {
        systemGenerated: true,
        description: 'Return item picked up from customer',
        note: `Picked up by ${pickupData.agentInfo?.name}`
      });

      // Generate return tracking number
      const trackingNumber = this.generateReturnTrackingNumber();
      returnRequest.trackingNumber = trackingNumber;

      await order.save();

      // Send tracking notification
      await this.sendReturnTrackingNotification(order, returnRequest);

      logger.info('Return pickup processed', {
        orderId,
        requestId,
        trackingNumber
      });

      return {
        success: true,
        trackingNumber,
        returnRequest
      };

    } catch (error) {
      logger.error('Return pickup processing failed', { orderId, requestId, error: error.message });
      throw error;
    }
  }

  /**
   * Process return received at warehouse
   */
  async processReturnReceived(orderId, requestId, inspectionData) {
    try {
      const Order = mongoose.model('Order');
      const order = await Order.findById(orderId);

      if (!order) {
        throw new Error('Order not found');
      }

      const returnRequest = order.returnInfo?.returnRequests?.find(
        req => req.requestId === requestId
      );

      if (!returnRequest) {
        throw new Error('Return request not found');
      }

      // Update return request with inspection results
      returnRequest.received = true;
      returnRequest.receivedAt = new Date();
      returnRequest.inspectionResults = {
        inspector: inspectionData.inspector,
        condition: inspectionData.condition, // 'good', 'damaged', 'defective'
        notes: inspectionData.notes,
        images: inspectionData.images || [],
        approvedForRefund: inspectionData.approvedForRefund !== false
      };

      // Process based on inspection results
      if (inspectionData.approvedForRefund) {
        await this.processReturnRefund(order, returnRequest);
      } else {
        // Reject return and send back to customer
        returnRequest.status = 'rejected';
        returnRequest.rejectionReason = inspectionData.rejectionReason;
        
        await this.sendReturnRejectionNotification(order, returnRequest);
      }

      await order.save();

      logger.info('Return received and inspected', {
        orderId,
        requestId,
        condition: inspectionData.condition,
        approved: inspectionData.approvedForRefund
      });

      return {
        success: true,
        returnRequest,
        refundProcessed: inspectionData.approvedForRefund
      };

    } catch (error) {
      logger.error('Return processing failed', { orderId, requestId, error: error.message });
      throw error;
    }
  }

  /**
   * Process return refund
   */
  async processReturnRefund(order, returnRequest) {
    try {
      const refundAmount = returnRequest.refundAmount;
      
      // Initiate refund
      await this.initiateRefund(order, refundAmount, 'return');

      // Update order status
      await orderStatusManager.updateOrderStatus(order._id, 'refunded', {
        systemGenerated: true,
        description: 'Return refund processed',
        refundAmount
      });

      // Update return request
      returnRequest.refundProcessed = true;
      returnRequest.refundAmount = refundAmount;
      returnRequest.refundedAt = new Date();

      // Send refund notification
      await this.sendRefundNotification(order, returnRequest);

      logger.info('Return refund processed', {
        orderId: order._id,
        requestId: returnRequest.requestId,
        refundAmount
      });

    } catch (error) {
      logger.error('Return refund processing failed', { 
        orderId: order._id, 
        requestId: returnRequest.requestId,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Check if order can be cancelled
   */
  canOrderBeCancelled(order) {
    const nonCancellableStatuses = ['delivered', 'cancelled', 'refunded', 'return_approved'];
    
    if (nonCancellableStatuses.includes(order.status)) {
      return {
        allowed: false,
        reason: 'Order cannot be cancelled in current status'
      };
    }

    // Check time limits for user cancellation
    const hoursFromOrder = (Date.now() - order.createdAt) / (1000 * 60 * 60);
    if (hoursFromOrder > 24) {
      return {
        allowed: false,
        reason: 'Order can only be cancelled within 24 hours of placement'
      };
    }

    return { allowed: true };
  }

  /**
   * Check if order can be returned
   */
  canOrderBeReturned(order) {
    if (order.status !== 'delivered') {
      return {
        allowed: false,
        reason: 'Only delivered orders can be returned'
      };
    }

    if (!order.deliveryTracking?.deliveredAt) {
      return {
        allowed: false,
        reason: 'Delivery date not found'
      };
    }

    const daysSinceDelivery = Math.floor(
      (Date.now() - order.deliveryTracking.deliveredAt) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceDelivery > 7) { // Maximum return window
      return {
        allowed: false,
        reason: 'Return window has expired'
      };
    }

    return { allowed: true };
  }

  /**
   * Schedule return pickup
   */
  async scheduleReturnPickup(order, returnRequest) {
    // This would integrate with logistics partner API
    const pickupDate = new Date();
    pickupDate.setDate(pickupDate.getDate() + 1); // Schedule for next day

    const pickupDetails = {
      scheduledDate: pickupDate,
      timeSlot: '10:00 AM - 6:00 PM',
      address: order.shippingAddress,
      contactNumber: order.customerInfo.phone,
      pickupInstructions: 'Please keep the items ready for pickup',
      estimatedPickupTime: '2-3 hours'
    };

    logger.info('Return pickup scheduled', {
      orderId: order._id,
      requestId: returnRequest.requestId,
      scheduledDate: pickupDate
    });

    return pickupDetails;
  }

  /**
   * Generate return tracking number
   */
  generateReturnTrackingNumber() {
    const prefix = 'RTN';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  /**
   * Initiate refund process
   */
  async initiateRefund(order, amount, reason) {
    try {
      // This would integrate with payment gateway APIs
      const refundId = `REF_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      // Update payment result
      order.paymentResult = order.paymentResult || {};
      order.paymentResult.refunds = order.paymentResult.refunds || [];
      order.paymentResult.refunds.push({
        refundId,
        amount,
        reason,
        status: 'processing',
        initiatedAt: new Date(),
        expectedProcessingTime: '3-5 business days'
      });

      // Update pricing
      order.pricing.refundedAmount = (order.pricing.refundedAmount || 0) + amount;

      logger.info('Refund initiated', {
        orderId: order._id,
        refundId,
        amount,
        reason
      });

      return refundId;
    } catch (error) {
      logger.error('Refund initiation failed', {
        orderId: order._id,
        amount,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send notifications
   */
  async sendCancellationNotification(order, status) {
    // Implementation for sending cancellation notifications
    logger.info('Cancellation notification sent', {
      orderId: order._id,
      status,
      customerEmail: order.customerInfo.email
    });
  }

  async sendReturnNotification(order, returnRequest, status) {
    // Implementation for sending return notifications
    logger.info('Return notification sent', {
      orderId: order._id,
      requestId: returnRequest.requestId,
      status,
      customerEmail: order.customerInfo.email
    });
  }

  async sendReturnTrackingNotification(order, returnRequest) {
    // Implementation for sending tracking notifications
    logger.info('Return tracking notification sent', {
      orderId: order._id,
      trackingNumber: returnRequest.trackingNumber,
      customerEmail: order.customerInfo.email
    });
  }

  async sendReturnRejectionNotification(order, returnRequest) {
    // Implementation for sending rejection notifications
    logger.info('Return rejection notification sent', {
      orderId: order._id,
      requestId: returnRequest.requestId,
      customerEmail: order.customerInfo.email
    });
  }

  async sendRefundNotification(order, returnRequest) {
    // Implementation for sending refund notifications
    logger.info('Refund notification sent', {
      orderId: order._id,
      refundAmount: returnRequest.refundAmount,
      customerEmail: order.customerInfo.email
    });
  }

  /**
   * Get return/cancellation reasons for frontend
   */
  getReturnReasons() {
    return this.returnReasons;
  }

  getCancellationReasons() {
    return this.cancellationReasons;
  }

  /**
   * Get return status for order
   */
  getReturnStatus(order) {
    if (!order.returnInfo?.returnRequests?.length) {
      return null;
    }

    const latestRequest = order.returnInfo.returnRequests[
      order.returnInfo.returnRequests.length - 1
    ];

    return {
      requestId: latestRequest.requestId,
      status: latestRequest.status,
      reason: latestRequest.reasonLabel,
      requestedAt: latestRequest.requestedAt,
      trackingNumber: latestRequest.trackingNumber,
      refundAmount: latestRequest.refundAmount
    };
  }
}

module.exports = new ReturnsManager();
