const Notification = require('../models/Notification');
const Order = require('../models/Order');
const User = require('../models/User');

class RealtimeNotificationService {
  constructor(socketService) {
    this.socketService = socketService;
    this.notificationTypes = {
      ORDER_CREATED: 'order_created',
      ORDER_CONFIRMED: 'order_confirmed',
      ORDER_PREPARING: 'order_preparing',
      ORDER_READY: 'order_ready',
      ORDER_DISPATCHED: 'order_dispatched',
      ORDER_DELIVERED: 'order_delivered',
      ORDER_CANCELLED: 'order_cancelled',
      PAYMENT_SUCCESS: 'payment_success',
      PAYMENT_FAILED: 'payment_failed',
      DELIVERY_UPDATE: 'delivery_update',
      SUPPORT_REQUEST: 'support_request',
      SYSTEM_ALERT: 'system_alert',
      PROMOTION: 'promotion',
      REVIEW_REQUEST: 'review_request'
    };
  }

  async createNotification(data) {
    try {
      const {
        userId,
        type,
        title,
        message,
        data: notificationData,
        priority = 'normal',
        expiresAt
      } = data;

      const notification = new Notification({
        user: userId,
        type,
        title,
        message,
        data: notificationData,
        priority,
        expiresAt
      });

      await notification.save();

      // Send real-time notification
      await this.socketService.sendNotification(userId, {
        id: notification._id,
        type,
        title,
        message,
        data: notificationData,
        priority,
        timestamp: notification.createdAt,
        read: false
      });

      console.log(`📢 Notification sent to user ${userId}: ${title}`);
      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  async sendOrderNotification(orderId, type, additionalData = {}) {
    try {
      const order = await Order.findById(orderId)
        .populate('user', 'name email')
        .populate('items.product', 'name image');

      if (!order) {
        throw new Error('Order not found');
      }

      const notificationConfig = this.getOrderNotificationConfig(type, order);
      
      if (!notificationConfig) {
        console.warn(`No notification config found for type: ${type}`);
        return;
      }

      const notification = await this.createNotification({
        userId: order.user._id,
        type,
        title: notificationConfig.title,
        message: notificationConfig.message,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalAmount: order.totalAmount,
          ...additionalData
        },
        priority: notificationConfig.priority
      });

      // Send order update to all tracking sockets
      await this.socketService.sendOrderUpdate(orderId, {
        orderId: order._id,
        status: order.status,
        tracking: order.tracking,
        estimatedDelivery: order.estimatedDelivery,
        notification: {
          type,
          title: notificationConfig.title,
          message: notificationConfig.message
        }
      });

      return notification;
    } catch (error) {
      console.error('Error sending order notification:', error);
      throw error;
    }
  }

  getOrderNotificationConfig(type, order) {
    const configs = {
      [this.notificationTypes.ORDER_CREATED]: {
        title: 'Order Placed Successfully!',
        message: `Your order #${order.orderNumber} has been placed and is being processed.`,
        priority: 'normal'
      },
      [this.notificationTypes.ORDER_CONFIRMED]: {
        title: 'Order Confirmed!',
        message: `Your order #${order.orderNumber} has been confirmed and will be prepared soon.`,
        priority: 'normal'
      },
      [this.notificationTypes.ORDER_PREPARING]: {
        title: 'Order Being Prepared!',
        message: `Your order #${order.orderNumber} is being prepared and will be ready soon.`,
        priority: 'normal'
      },
      [this.notificationTypes.ORDER_READY]: {
        title: 'Order Ready for Pickup!',
        message: `Your order #${order.orderNumber} is ready and will be dispatched shortly.`,
        priority: 'high'
      },
      [this.notificationTypes.ORDER_DISPATCHED]: {
        title: 'Order Dispatched!',
        message: `Your order #${order.orderNumber} is on its way to you.`,
        priority: 'high'
      },
      [this.notificationTypes.ORDER_DELIVERED]: {
        title: 'Order Delivered!',
        message: `Your order #${order.orderNumber} has been delivered successfully.`,
        priority: 'normal'
      },
      [this.notificationTypes.ORDER_CANCELLED]: {
        title: 'Order Cancelled',
        message: `Your order #${order.orderNumber} has been cancelled.`,
        priority: 'high'
      }
    };

    return configs[type];
  }

  async sendPaymentNotification(userId, type, paymentData) {
    try {
      const configs = {
        [this.notificationTypes.PAYMENT_SUCCESS]: {
          title: 'Payment Successful!',
          message: 'Your payment has been processed successfully.',
          priority: 'normal'
        },
        [this.notificationTypes.PAYMENT_FAILED]: {
          title: 'Payment Failed',
          message: 'There was an issue with your payment. Please try again.',
          priority: 'high'
        }
      };

      const config = configs[type];
      if (!config) return;

      await this.createNotification({
        userId,
        type,
        title: config.title,
        message: config.message,
        data: paymentData,
        priority: config.priority
      });
    } catch (error) {
      console.error('Error sending payment notification:', error);
      throw error;
    }
  }

  async sendDeliveryUpdate(orderId, updateData) {
    try {
      const order = await Order.findById(orderId).populate('user', '_id');
      if (!order) return;

      const notification = await this.createNotification({
        userId: order.user._id,
        type: this.notificationTypes.DELIVERY_UPDATE,
        title: 'Delivery Update',
        message: updateData.message || 'Your delivery status has been updated.',
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          ...updateData
        },
        priority: 'normal'
      });

      // Send real-time delivery update
      await this.socketService.sendDeliveryUpdate(orderId, {
        orderId: order._id,
        update: updateData,
        timestamp: new Date()
      });

      return notification;
    } catch (error) {
      console.error('Error sending delivery update:', error);
      throw error;
    }
  }

  async sendSupportRequest(userId, requestData) {
    try {
      const notification = await this.createNotification({
        userId,
        type: this.notificationTypes.SUPPORT_REQUEST,
        title: 'Support Request Submitted',
        message: 'Your support request has been submitted. We\'ll get back to you soon.',
        data: requestData,
        priority: 'normal'
      });

      // Notify admin team
      await this.socketService.sendSystemAlert(
        `New support request from user ${requestData.userName}`,
        ['admin']
      );

      return notification;
    } catch (error) {
      console.error('Error sending support request notification:', error);
      throw error;
    }
  }

  async sendSystemAlert(message, roles = []) {
    try {
      const alert = {
        id: Date.now().toString(),
        message,
        timestamp: new Date(),
        type: this.notificationTypes.SYSTEM_ALERT
      };

      await this.socketService.sendSystemAlert(message, roles);
      return alert;
    } catch (error) {
      console.error('Error sending system alert:', error);
      throw error;
    }
  }

  async sendPromotionNotification(userIds, promotionData) {
    try {
      const notifications = [];
      
      for (const userId of userIds) {
        const notification = await this.createNotification({
          userId,
          type: this.notificationTypes.PROMOTION,
          title: promotionData.title || 'Special Offer!',
          message: promotionData.message,
          data: promotionData,
          priority: 'normal'
        });
        
        notifications.push(notification);
      }

      console.log(`📢 Promotion notification sent to ${userIds.length} users`);
      return notifications;
    } catch (error) {
      console.error('Error sending promotion notifications:', error);
      throw error;
    }
  }

  async sendReviewRequest(orderId) {
    try {
      const order = await Order.findById(orderId)
        .populate('user', '_id')
        .populate('items.product', 'name');

      if (!order || order.status !== 'delivered') {
        return;
      }

      // Check if review already requested
      const existingNotification = await Notification.findOne({
        user: order.user._id,
        type: this.notificationTypes.REVIEW_REQUEST,
        'data.orderId': orderId
      });

      if (existingNotification) {
        return;
      }

      const notification = await this.createNotification({
        userId: order.user._id,
        type: this.notificationTypes.REVIEW_REQUEST,
        title: 'How was your order?',
        message: `We'd love to hear about your experience with order #${order.orderNumber}. Please leave a review!`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          products: order.items.map(item => ({
            id: item.product._id,
            name: item.product.name
          }))
        },
        priority: 'normal'
      });

      return notification;
    } catch (error) {
      console.error('Error sending review request:', error);
      throw error;
    }
  }

  async markNotificationAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, user: userId },
        { read: true, readAt: new Date() },
        { new: true }
      );

      if (notification) {
        // Send real-time update to mark notification as read
        await this.socketService.sendNotification(userId, {
          id: notification._id,
          read: true,
          readAt: notification.readAt
        });
      }

      return notification;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  async markAllNotificationsAsRead(userId) {
    try {
      const result = await Notification.updateMany(
        { user: userId, read: false },
        { read: true, readAt: new Date() }
      );

      if (result.modifiedCount > 0) {
        // Send real-time update
        await this.socketService.sendNotification(userId, {
          type: 'mark_all_read',
          count: result.modifiedCount
        });
      }

      return result;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  async getUnreadNotificationCount(userId) {
    try {
      const count = await Notification.countDocuments({
        user: userId,
        read: false
      });

      return count;
    } catch (error) {
      console.error('Error getting unread notification count:', error);
      throw error;
    }
  }

  async cleanupExpiredNotifications() {
    try {
      const result = await Notification.deleteMany({
        expiresAt: { $lt: new Date() }
      });

      if (result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} expired notifications`);
      }

      return result;
    } catch (error) {
      console.error('Error cleaning up expired notifications:', error);
      throw error;
    }
  }
}

module.exports = RealtimeNotificationService;
