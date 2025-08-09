const Order = require('../models/Order');
const User = require('../models/User');

class RealtimeOrderTrackingService {
  constructor(socketService, notificationService) {
    this.socketService = socketService;
    this.notificationService = notificationService;
    this.trackingUpdates = new Map(); // orderId -> tracking updates
    this.deliveryPartners = new Map(); // partnerId -> location data
  }

  async updateOrderStatus(orderId, newStatus, updateData = {}) {
    try {
      const order = await Order.findById(orderId)
        .populate('user', 'name email')
        .populate('deliveryPartner', 'name phone');

      if (!order) {
        throw new Error('Order not found');
      }

      const oldStatus = order.status;
      order.status = newStatus;

      // Update tracking information
      if (updateData.tracking) {
        order.tracking = {
          ...order.tracking,
          ...updateData.tracking
        };
      }

      // Update delivery partner if provided
      if (updateData.deliveryPartner) {
        order.deliveryPartner = updateData.deliveryPartner;
      }

      // Update estimated delivery time
      if (updateData.estimatedDelivery) {
        order.estimatedDelivery = updateData.estimatedDelivery;
      }

      // Add status update to tracking history
      if (!order.tracking.history) {
        order.tracking.history = [];
      }

      order.tracking.history.push({
        status: newStatus,
        timestamp: new Date(),
        location: updateData.location || null,
        notes: updateData.notes || null,
        updatedBy: updateData.updatedBy || 'system'
      });

      await order.save();

      // Send real-time update
      await this.socketService.sendOrderUpdate(orderId, {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: newStatus,
        oldStatus,
        tracking: order.tracking,
        estimatedDelivery: order.estimatedDelivery,
        deliveryPartner: order.deliveryPartner,
        timestamp: new Date()
      });

      // Send notification based on status change
      await this.sendStatusNotification(order, newStatus, oldStatus);

      console.log(`📦 Order ${order.orderNumber} status updated: ${oldStatus} → ${newStatus}`);
      return order;
    } catch (error) {
      console.error('Error updating order status:', error);
      throw error;
    }
  }

  async sendStatusNotification(order, newStatus, oldStatus) {
    const statusNotifications = {
      'confirmed': this.notificationService.notificationTypes.ORDER_CONFIRMED,
      'preparing': this.notificationService.notificationTypes.ORDER_PREPARING,
      'ready': this.notificationService.notificationTypes.ORDER_READY,
      'dispatched': this.notificationService.notificationTypes.ORDER_DISPATCHED,
      'delivered': this.notificationService.notificationTypes.ORDER_DELIVERED,
      'cancelled': this.notificationService.notificationTypes.ORDER_CANCELLED
    };

    const notificationType = statusNotifications[newStatus];
    if (notificationType) {
      await this.notificationService.sendOrderNotification(
        order._id,
        notificationType,
        { oldStatus, newStatus }
      );
    }
  }

  async updateDeliveryLocation(orderId, locationData) {
    try {
      const order = await Order.findById(orderId)
        .populate('deliveryPartner', 'name phone');

      if (!order) {
        throw new Error('Order not found');
      }

      // Update tracking with new location
      if (!order.tracking) {
        order.tracking = {};
      }

      order.tracking.currentLocation = {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        timestamp: new Date(),
        accuracy: locationData.accuracy || null
      };

      // Add to location history
      if (!order.tracking.locationHistory) {
        order.tracking.locationHistory = [];
      }

      order.tracking.locationHistory.push({
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        timestamp: new Date(),
        accuracy: locationData.accuracy || null
      });

      // Keep only last 50 location updates
      if (order.tracking.locationHistory.length > 50) {
        order.tracking.locationHistory = order.tracking.locationHistory.slice(-50);
      }

      await order.save();

      // Send real-time location update
      await this.socketService.sendDeliveryUpdate(orderId, {
        orderId: order._id,
        location: order.tracking.currentLocation,
        deliveryPartner: order.deliveryPartner,
        timestamp: new Date()
      });

      console.log(`📍 Delivery location updated for order ${order.orderNumber}`);
      return order;
    } catch (error) {
      console.error('Error updating delivery location:', error);
      throw error;
    }
  }

  async assignDeliveryPartner(orderId, partnerId) {
    try {
      const order = await Order.findById(orderId);
      const partner = await User.findById(partnerId);

      if (!order) {
        throw new Error('Order not found');
      }

      if (!partner || partner.role !== 'delivery') {
        throw new Error('Invalid delivery partner');
      }

      order.deliveryPartner = partnerId;
      order.status = 'assigned';
      
      // Update tracking
      if (!order.tracking) {
        order.tracking = {};
      }

      order.tracking.assignedAt = new Date();
      order.tracking.assignedTo = partnerId;

      await order.save();

      // Send real-time update
      await this.socketService.sendOrderUpdate(orderId, {
        orderId: order._id,
        status: 'assigned',
        deliveryPartner: {
          id: partner._id,
          name: partner.name,
          phone: partner.phone
        },
        timestamp: new Date()
      });

      // Notify delivery partner
      await this.socketService.sendNotification(partnerId, {
        type: 'order_assigned',
        title: 'New Order Assigned',
        message: `You have been assigned order #${order.orderNumber}`,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          pickupAddress: order.pickupAddress,
          deliveryAddress: order.deliveryAddress
        }
      });

      console.log(`🚚 Order ${order.orderNumber} assigned to delivery partner ${partner.name}`);
      return order;
    } catch (error) {
      console.error('Error assigning delivery partner:', error);
      throw error;
    }
  }

  async updateDeliveryPartnerLocation(partnerId, locationData) {
    try {
      // Store partner location
      this.deliveryPartners.set(partnerId, {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        timestamp: new Date(),
        accuracy: locationData.accuracy || null
      });

      // Find active orders for this partner
      const activeOrders = await Order.find({
        deliveryPartner: partnerId,
        status: { $in: ['assigned', 'dispatched', 'out_for_delivery'] }
      });

      // Update location for each active order
      for (const order of activeOrders) {
        await this.updateDeliveryLocation(order._id, locationData);
      }

      console.log(`📍 Delivery partner ${partnerId} location updated`);
      return activeOrders.length;
    } catch (error) {
      console.error('Error updating delivery partner location:', error);
      throw error;
    }
  }

  async calculateEstimatedDelivery(orderId) {
    try {
      const order = await Order.findById(orderId);
      if (!order) return null;

      const now = new Date();
      let estimatedMinutes = 20; // Base 20-minute delivery

      // Adjust based on order status
      switch (order.status) {
        case 'confirmed':
          estimatedMinutes = 25; // 5 minutes for confirmation
          break;
        case 'preparing':
          estimatedMinutes = 20; // 20 minutes for preparation
          break;
        case 'ready':
          estimatedMinutes = 15; // 15 minutes for pickup and delivery
          break;
        case 'dispatched':
          estimatedMinutes = 10; // 10 minutes remaining
          break;
        case 'out_for_delivery':
          estimatedMinutes = 5; // 5 minutes remaining
          break;
        default:
          estimatedMinutes = 20;
      }

      const estimatedDelivery = new Date(now.getTime() + estimatedMinutes * 60000);
      
      order.estimatedDelivery = estimatedDelivery;
      await order.save();

      return estimatedDelivery;
    } catch (error) {
      console.error('Error calculating estimated delivery:', error);
      return null;
    }
  }

  async getOrderTrackingInfo(orderId) {
    try {
      const order = await Order.findById(orderId)
        .populate('user', 'name email phone')
        .populate('deliveryPartner', 'name phone')
        .populate('items.product', 'name image');

      if (!order) {
        throw new Error('Order not found');
      }

      const trackingInfo = {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        tracking: order.tracking,
        estimatedDelivery: order.estimatedDelivery,
        deliveryPartner: order.deliveryPartner,
        pickupAddress: order.pickupAddress,
        deliveryAddress: order.deliveryAddress,
        items: order.items,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      };

      return trackingInfo;
    } catch (error) {
      console.error('Error getting order tracking info:', error);
      throw error;
    }
  }

  async getActiveOrdersForPartner(partnerId) {
    try {
      const orders = await Order.find({
        deliveryPartner: partnerId,
        status: { $in: ['assigned', 'dispatched', 'out_for_delivery'] }
      }).populate('user', 'name phone')
        .populate('items.product', 'name image');

      return orders;
    } catch (error) {
      console.error('Error getting active orders for partner:', error);
      throw error;
    }
  }

  async getDeliveryPartnerLocation(partnerId) {
    return this.deliveryPartners.get(partnerId) || null;
  }

  async getTrackingStats() {
    try {
      const stats = await Order.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const totalOrders = await Order.countDocuments();
      const activeOrders = await Order.countDocuments({
        status: { $in: ['confirmed', 'preparing', 'ready', 'dispatched', 'out_for_delivery'] }
      });

      return {
        totalOrders,
        activeOrders,
        statusBreakdown: stats,
        connectedPartners: this.deliveryPartners.size,
        trackedOrders: this.socketService.orderTracking.size
      };
    } catch (error) {
      console.error('Error getting tracking stats:', error);
      throw error;
    }
  }

  async cleanupTrackingData() {
    try {
      // Clean up old location history (keep only last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const result = await Order.updateMany(
        {
          'tracking.locationHistory.timestamp': { $lt: weekAgo }
        },
        {
          $pull: {
            'tracking.locationHistory': {
              timestamp: { $lt: weekAgo }
            }
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`🧹 Cleaned up old tracking data for ${result.modifiedCount} orders`);
      }

      return result;
    } catch (error) {
      console.error('Error cleaning up tracking data:', error);
      throw error;
    }
  }
}

module.exports = RealtimeOrderTrackingService;
