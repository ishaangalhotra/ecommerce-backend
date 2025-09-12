const { supabase, SupabaseHelpers } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Supabase Real-time Service
 * Replaces Socket.IO for memory-efficient real-time features
 * Handles order updates, chat messages, and delivery tracking
 */

class SupabaseRealtimeService {
  constructor() {
    this.channels = new Map();
    this.subscribers = new Map();
  }

  /**
   * Initialize real-time service
   */
  async initialize() {
    try {
      logger.info('Initializing Supabase Real-time service');
      
      // Setup default channels for different features
      await this.setupOrderUpdatesChannel();
      await this.setupChatChannel();
      await this.setupDeliveryTrackingChannel();
      await this.setupNotificationsChannel();

      logger.info('Supabase Real-time service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Supabase Real-time service', error);
      throw error;
    }
  }

  /**
   * Setup order updates channel (replaces Socket.IO order events)
   */
  async setupOrderUpdatesChannel() {
    const channel = supabase
      .channel('order_updates')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'order_updates' 
        },
        (payload) => {
          this.handleOrderUpdate(payload);
        }
      )
      .subscribe();

    this.channels.set('order_updates', channel);
  }

  /**
   * Setup chat channel (replaces Socket.IO chat)
   */
  async setupChatChannel() {
    const channel = supabase
      .channel('chat_messages')
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages'
        },
        (payload) => {
          this.handleChatMessage(payload);
        }
      )
      .subscribe();

    this.channels.set('chat_messages', channel);
  }

  /**
   * Setup delivery tracking channel
   */
  async setupDeliveryTrackingChannel() {
    const channel = supabase
      .channel('delivery_updates')
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'delivery_tracking'
        },
        (payload) => {
          this.handleDeliveryUpdate(payload);
        }
      )
      .subscribe();

    this.channels.set('delivery_updates', channel);
  }

  /**
   * Setup notifications channel
   */
  async setupNotificationsChannel() {
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications'
        },
        (payload) => {
          this.handleNotification(payload);
        }
      )
      .subscribe();

    this.channels.set('notifications', channel);
  }

  /**
   * Handle order update events
   */
  handleOrderUpdate(payload) {
    try {
      const { new: orderUpdate, eventType } = payload;
      
      logger.info('Order update received', {
        orderId: orderUpdate.order_id,
        status: orderUpdate.status,
        eventType
      });

      // Log analytics
      SupabaseHelpers.logAnalyticsEvent('order_status_update', {
        order_id: orderUpdate.order_id,
        status: orderUpdate.status,
        previous_status: payload.old?.status
      }, orderUpdate.user_id);

    } catch (error) {
      logger.error('Error handling order update', error);
    }
  }

  /**
   * Handle chat message events
   */
  handleChatMessage(payload) {
    try {
      const { new: message } = payload;
      
      logger.info('Chat message received', {
        messageId: message.id,
        fromUser: message.from_user_id,
        toUser: message.to_user_id
      });

      // Log analytics
      SupabaseHelpers.logAnalyticsEvent('chat_message_sent', {
        message_id: message.id,
        chat_type: message.chat_type || 'direct'
      }, message.from_user_id);

    } catch (error) {
      logger.error('Error handling chat message', error);
    }
  }

  /**
   * Handle delivery tracking updates
   */
  handleDeliveryUpdate(payload) {
    try {
      const { new: delivery, eventType } = payload;
      
      logger.info('Delivery update received', {
        deliveryId: delivery.id,
        status: delivery.status,
        location: delivery.current_location
      });

      // Log analytics
      SupabaseHelpers.logAnalyticsEvent('delivery_status_update', {
        delivery_id: delivery.id,
        status: delivery.status,
        location: delivery.current_location
      }, delivery.customer_id);

    } catch (error) {
      logger.error('Error handling delivery update', error);
    }
  }

  /**
   * Handle notification events
   */
  handleNotification(payload) {
    try {
      const { new: notification } = payload;
      
      logger.info('Notification received', {
        notificationId: notification.id,
        userId: notification.user_id,
        type: notification.type
      });

      // Log analytics
      SupabaseHelpers.logAnalyticsEvent('notification_sent', {
        notification_id: notification.id,
        type: notification.type
      }, notification.user_id);

    } catch (error) {
      logger.error('Error handling notification', error);
    }
  }

  /**
   * Send order update via Supabase
   */
  async sendOrderUpdate(orderId, status, userId, metadata = {}) {
    try {
      const { error } = await supabase
        .from('order_updates')
        .insert({
          order_id: orderId,
          status,
          user_id: userId,
          metadata,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      logger.info('Order update sent', { orderId, status, userId });
      return true;
    } catch (error) {
      logger.error('Failed to send order update', error);
      return false;
    }
  }

  /**
   * Send chat message via Supabase
   */
  async sendChatMessage(fromUserId, toUserId, message, chatType = 'direct') {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          from_user_id: fromUserId,
          to_user_id: toUserId,
          message,
          chat_type: chatType,
          created_at: new Date().toISOString()
        })
        .select();

      if (error) throw error;

      logger.info('Chat message sent', { 
        messageId: data[0].id,
        fromUserId, 
        toUserId 
      });
      
      return data[0];
    } catch (error) {
      logger.error('Failed to send chat message', error);
      throw error;
    }
  }

  /**
   * Send delivery update via Supabase
   */
  async sendDeliveryUpdate(deliveryId, status, location, customerId, metadata = {}) {
    try {
      const { error } = await supabase
        .from('delivery_tracking')
        .upsert({
          id: deliveryId,
          status,
          current_location: location,
          customer_id: customerId,
          metadata,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      logger.info('Delivery update sent', { deliveryId, status, location });
      return true;
    } catch (error) {
      logger.error('Failed to send delivery update', error);
      return false;
    }
  }

  /**
   * Send notification via Supabase
   */
  async sendNotification(userId, type, title, message, metadata = {}) {
    try {
      const { data, error } = await supabase
        .from('user_notifications')
        .insert({
          user_id: userId,
          type,
          title,
          message,
          metadata,
          created_at: new Date().toISOString(),
          read: false
        })
        .select();

      if (error) throw error;

      logger.info('Notification sent', {
        notificationId: data[0].id,
        userId,
        type
      });

      return data[0];
    } catch (error) {
      logger.error('Failed to send notification', error);
      throw error;
    }
  }

  /**
   * Subscribe to user-specific events (for frontend)
   */
  async subscribeToUserEvents(userId, callbacks = {}) {
    try {
      const userChannel = supabase
        .channel(`user_${userId}`)
        .on('postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'order_updates',
            filter: `user_id=eq.${userId}`
          },
          callbacks.onOrderUpdate || (() => {})
        )
        .on('postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'user_notifications',
            filter: `user_id=eq.${userId}`
          },
          callbacks.onNotification || (() => {})
        )
        .on('postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_messages',
            filter: `to_user_id=eq.${userId}`
          },
          callbacks.onChatMessage || (() => {})
        )
        .subscribe();

      this.subscribers.set(userId, userChannel);
      
      logger.info('User subscribed to real-time events', { userId });
      return userChannel;
    } catch (error) {
      logger.error('Failed to subscribe user to events', error);
      throw error;
    }
  }

  /**
   * Unsubscribe user from events
   */
  async unsubscribeUser(userId) {
    try {
      const channel = this.subscribers.get(userId);
      if (channel) {
        await supabase.removeChannel(channel);
        this.subscribers.delete(userId);
        logger.info('User unsubscribed from real-time events', { userId });
      }
    } catch (error) {
      logger.error('Failed to unsubscribe user', error);
    }
  }

  /**
   * Get memory usage stats (much lower than Socket.IO)
   */
  getMemoryStats() {
    return {
      activeChannels: this.channels.size,
      activeSubscribers: this.subscribers.size,
      estimatedMemoryUsage: `~${(this.channels.size + this.subscribers.size) * 0.1}KB` // Very low
    };
  }

  /**
   * Cleanup all channels and subscribers
   */
  async cleanup() {
    try {
      // Remove all channels
      for (const [name, channel] of this.channels) {
        await supabase.removeChannel(channel);
        logger.info(`Removed channel: ${name}`);
      }

      // Remove all user subscriptions
      for (const [userId, channel] of this.subscribers) {
        await supabase.removeChannel(channel);
        logger.info(`Removed user subscription: ${userId}`);
      }

      this.channels.clear();
      this.subscribers.clear();

      logger.info('Supabase Real-time service cleaned up');
    } catch (error) {
      logger.error('Error during cleanup', error);
    }
  }
}

// Export singleton instance
const realtimeService = new SupabaseRealtimeService();

module.exports = {
  SupabaseRealtimeService,
  realtimeService
};
