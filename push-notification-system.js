const mongoose = require('mongoose');
const webpush = require('web-push');
const admin = require('firebase-admin');
const cron = require('node-cron');

// Initialize Firebase Admin (optional, for mobile notifications)
let firebaseApp = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized for push notifications');
  }
} catch (error) {
  console.log('Firebase Admin not initialized:', error.message);
}

// Configure Web Push
webpush.setVapidDetails(
  `mailto:${process.env.CONTACT_EMAIL || 'admin@quicklocal.com'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Push Subscription Schema
const pushSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  endpoint: {
    type: String,
    required: true
  },
  keys: {
    p256dh: {
      type: String,
      required: true
    },
    auth: {
      type: String,
      required: true
    }
  },
  deviceType: {
    type: String,
    enum: ['web', 'android', 'ios'],
    default: 'web'
  },
  userAgent: String,
  isActive: {
    type: Boolean,
    default: true
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

pushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ isActive: 1, lastUsed: -1 });

const PushSubscription = mongoose.model('PushSubscription', pushSubscriptionSchema);

// Push Notification Schema (for logging and analytics)
const pushNotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  type: {
    type: String,
    enum: [
      'order_placed', 'order_shipped', 'order_delivered', 'order_cancelled',
      'product_stock', 'price_drop', 'wishlist_available',
      'cart_abandonment', 'promotional', 'system_alert'
    ],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  icon: String,
  image: String,
  badge: String,
  data: {
    type: mongoose.Schema.Types.Mixed
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'clicked', 'failed'],
    default: 'pending'
  },
  sentAt: Date,
  deliveredAt: Date,
  clickedAt: Date,
  errorMessage: String,
  subscriptionsTargeted: Number,
  subscriptionsSuccessful: Number
}, {
  timestamps: true
});

pushNotificationSchema.index({ userId: 1, createdAt: -1 });
pushNotificationSchema.index({ type: 1, status: 1 });
pushNotificationSchema.index({ createdAt: -1 });

const PushNotification = mongoose.model('PushNotification', pushNotificationSchema);

// User Notification Preferences Schema
const notificationPreferencesSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  pushEnabled: {
    type: Boolean,
    default: true
  },
  emailEnabled: {
    type: Boolean,
    default: true
  },
  categories: {
    orders: {
      type: Boolean,
      default: true
    },
    promotions: {
      type: Boolean,
      default: true
    },
    priceDrops: {
      type: Boolean,
      default: true
    },
    stockAlerts: {
      type: Boolean,
      default: true
    },
    cartAbandonment: {
      type: Boolean,
      default: true
    },
    systemAlerts: {
      type: Boolean,
      default: false
    }
  },
  quietHours: {
    enabled: {
      type: Boolean,
      default: false
    },
    startTime: {
      type: String,
      default: '22:00'
    },
    endTime: {
      type: String,
      default: '08:00'
    },
    timezone: {
      type: String,
      default: 'UTC'
    }
  }
}, {
  timestamps: true
});

const NotificationPreferences = mongoose.model('NotificationPreferences', notificationPreferencesSchema);

// Push Notification Service
class PushNotificationService {
  
  // Subscribe user to push notifications
  static async subscribe(userId, subscription, deviceType = 'web', userAgent = null) {
    try {
      // Check if subscription already exists
      const existing = await PushSubscription.findOne({
        userId,
        endpoint: subscription.endpoint
      });

      if (existing) {
        // Update existing subscription
        existing.keys = subscription.keys;
        existing.deviceType = deviceType;
        existing.userAgent = userAgent;
        existing.isActive = true;
        existing.lastUsed = new Date();
        await existing.save();
        return existing;
      }

      // Create new subscription
      const pushSub = new PushSubscription({
        userId,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        deviceType,
        userAgent,
        isActive: true
      });

      await pushSub.save();
      console.log('Push subscription created for user:', userId);
      return pushSub;

    } catch (error) {
      console.error('Error subscribing to push notifications:', error);
      throw error;
    }
  }

  // Unsubscribe user from push notifications
  static async unsubscribe(userId, endpoint = null) {
    try {
      const query = { userId };
      if (endpoint) {
        query.endpoint = endpoint;
      }

      await PushSubscription.updateMany(query, { isActive: false });
      console.log('Push subscription deactivated for user:', userId);
      return true;

    } catch (error) {
      console.error('Error unsubscribing from push notifications:', error);
      throw error;
    }
  }

  // Send push notification to specific user
  static async sendToUser(userId, notification) {
    try {
      // Check user preferences
      const preferences = await NotificationPreferences.findOne({ userId });
      if (preferences && !preferences.pushEnabled) {
        console.log('Push notifications disabled for user:', userId);
        return { success: false, reason: 'disabled' };
      }

      // Check category preferences
      if (preferences && notification.category) {
        const categoryEnabled = preferences.categories[notification.category];
        if (categoryEnabled === false) {
          console.log('Category disabled for user:', userId, notification.category);
          return { success: false, reason: 'category_disabled' };
        }
      }

      // Check quiet hours
      if (preferences && preferences.quietHours.enabled) {
        const now = new Date();
        const userTime = new Intl.DateTimeFormat('en-US', {
          timeZone: preferences.quietHours.timezone,
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }).format(now);

        const currentTime = userTime;
        const startTime = preferences.quietHours.startTime;
        const endTime = preferences.quietHours.endTime;

        if (this.isInQuietHours(currentTime, startTime, endTime)) {
          console.log('User in quiet hours, delaying notification:', userId);
          return { success: false, reason: 'quiet_hours' };
        }
      }

      // Get user's subscriptions
      const subscriptions = await PushSubscription.find({ 
        userId, 
        isActive: true 
      });

      if (subscriptions.length === 0) {
        console.log('No active subscriptions for user:', userId);
        return { success: false, reason: 'no_subscriptions' };
      }

      // Create notification record
      const notificationRecord = new PushNotification({
        userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        icon: notification.icon || '/icon-192x192.png',
        image: notification.image,
        badge: notification.badge || '/badge-72x72.png',
        data: notification.data || {},
        subscriptionsTargeted: subscriptions.length
      });

      let successfulSends = 0;
      const failedSubscriptions = [];

      // Send to each subscription
      for (const subscription of subscriptions) {
        try {
          const payload = JSON.stringify({
            title: notification.title,
            body: notification.body,
            icon: notification.icon || '/icon-192x192.png',
            image: notification.image,
            badge: notification.badge || '/badge-72x72.png',
            data: {
              ...notification.data,
              url: notification.url,
              timestamp: Date.now()
            },
            actions: notification.actions || []
          });

          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: subscription.keys
          }, payload);

          successfulSends++;
          subscription.lastUsed = new Date();
          await subscription.save();

        } catch (error) {
          console.error('Push send error:', error);
          
          // Check if subscription is invalid
          if (error.statusCode === 410) {
            subscription.isActive = false;
            await subscription.save();
            failedSubscriptions.push(subscription.endpoint);
          }
        }
      }

      // Update notification record
      notificationRecord.subscriptionsSuccessful = successfulSends;
      notificationRecord.status = successfulSends > 0 ? 'sent' : 'failed';
      notificationRecord.sentAt = new Date();
      
      if (failedSubscriptions.length > 0) {
        notificationRecord.errorMessage = `Failed endpoints: ${failedSubscriptions.join(', ')}`;
      }

      await notificationRecord.save();

      return {
        success: successfulSends > 0,
        targeted: subscriptions.length,
        successful: successfulSends,
        failed: subscriptions.length - successfulSends,
        notificationId: notificationRecord._id
      };

    } catch (error) {
      console.error('Error sending push notification:', error);
      throw error;
    }
  }

  // Send bulk push notifications
  static async sendBulk(userIds, notification) {
    const results = [];
    
    for (const userId of userIds) {
      try {
        const result = await this.sendToUser(userId, notification);
        results.push({ userId, ...result });
      } catch (error) {
        results.push({ 
          userId, 
          success: false, 
          error: error.message 
        });
      }
    }

    return results;
  }

  // Send to all users (admin only)
  static async broadcast(notification, criteria = {}) {
    try {
      // Get users matching criteria
      const User = mongoose.model('User');
      const users = await User.find(criteria, '_id');
      const userIds = users.map(u => u._id);

      console.log(`Broadcasting notification to ${userIds.length} users`);
      
      return await this.sendBulk(userIds, notification);

    } catch (error) {
      console.error('Error broadcasting notification:', error);
      throw error;
    }
  }

  // Notification templates
  static getNotificationTemplates() {
    return {
      order_placed: {
        title: 'Order Confirmed! 🎉',
        body: 'Your order #{orderNumber} has been confirmed',
        icon: '/icons/order-confirmed.png',
        actions: [
          { action: 'view', title: 'View Order' },
          { action: 'track', title: 'Track Package' }
        ]
      },
      
      order_shipped: {
        title: 'Package Shipped! 📦',
        body: 'Your order #{orderNumber} is on its way',
        icon: '/icons/package-shipped.png',
        actions: [
          { action: 'track', title: 'Track Package' }
        ]
      },
      
      order_delivered: {
        title: 'Delivered! 🎊',
        body: 'Your order #{orderNumber} has been delivered',
        icon: '/icons/package-delivered.png',
        actions: [
          { action: 'review', title: 'Leave Review' }
        ]
      },
      
      price_drop: {
        title: 'Price Drop Alert! 💰',
        body: '{productName} is now ${newPrice} (was ${oldPrice})',
        icon: '/icons/price-drop.png',
        actions: [
          { action: 'buy', title: 'Buy Now' },
          { action: 'view', title: 'View Product' }
        ]
      },
      
      cart_abandonment: {
        title: 'Don\'t forget your cart! 🛒',
        body: 'You have {itemCount} items waiting for you',
        icon: '/icons/cart-reminder.png',
        actions: [
          { action: 'cart', title: 'Complete Purchase' }
        ]
      },
      
      promotional: {
        title: '{title}',
        body: '{message}',
        icon: '/icons/promotion.png',
        image: '{imageUrl}',
        actions: [
          { action: 'shop', title: 'Shop Now' }
        ]
      }
    };
  }

  // Helper to check quiet hours
  static isInQuietHours(currentTime, startTime, endTime) {
    const current = this.timeToMinutes(currentTime);
    const start = this.timeToMinutes(startTime);
    const end = this.timeToMinutes(endTime);

    if (start < end) {
      return current >= start && current <= end;
    } else {
      return current >= start || current <= end;
    }
  }

  static timeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Get notification analytics
  static async getAnalytics(startDate = null, endDate = null) {
    try {
      const dateFilter = {};
      if (startDate && endDate) {
        dateFilter.createdAt = { 
          $gte: new Date(startDate), 
          $lte: new Date(endDate) 
        };
      }

      const [
        totalSent,
        byType,
        byStatus,
        subscriptionStats
      ] = await Promise.all([
        PushNotification.countDocuments(dateFilter),
        PushNotification.aggregate([
          { $match: dateFilter },
          { $group: { _id: '$type', count: { $sum: 1 } } }
        ]),
        PushNotification.aggregate([
          { $match: dateFilter },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]),
        PushSubscription.aggregate([
          { $group: {
            _id: '$deviceType',
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            total: { $sum: 1 }
          }}
        ])
      ]);

      return {
        totalSent,
        byType: byType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        byStatus: byStatus.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        subscriptionStats: subscriptionStats.reduce((acc, item) => {
          acc[item._id] = {
            active: item.active,
            total: item.total
          };
          return acc;
        }, {})
      };

    } catch (error) {
      console.error('Error getting push notification analytics:', error);
      return null;
    }
  }
}

// Routes for push notifications
const pushNotificationRoutes = (router) => {
  
  // Subscribe to push notifications
  router.post('/push/subscribe', async (req, res) => {
    try {
      const { subscription, deviceType } = req.body;
      const userId = req.user?.id || req.body.userId;
      const userAgent = req.get('User-Agent');

      if (!userId || !subscription) {
        return res.status(400).json({
          success: false,
          message: 'User ID and subscription required'
        });
      }

      await PushNotificationService.subscribe(
        userId, 
        subscription, 
        deviceType, 
        userAgent
      );

      res.json({
        success: true,
        message: 'Successfully subscribed to push notifications'
      });

    } catch (error) {
      console.error('Push subscribe error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to subscribe to push notifications'
      });
    }
  });

  // Unsubscribe from push notifications
  router.post('/push/unsubscribe', async (req, res) => {
    try {
      const { endpoint } = req.body;
      const userId = req.user?.id || req.body.userId;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID required'
        });
      }

      await PushNotificationService.unsubscribe(userId, endpoint);

      res.json({
        success: true,
        message: 'Successfully unsubscribed from push notifications'
      });

    } catch (error) {
      console.error('Push unsubscribe error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to unsubscribe from push notifications'
      });
    }
  });

  // Update notification preferences
  router.put('/user/notification-preferences', async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const preferences = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID required'
        });
      }

      await NotificationPreferences.findOneAndUpdate(
        { userId },
        preferences,
        { upsert: true, new: true }
      );

      res.json({
        success: true,
        message: 'Notification preferences updated'
      });

    } catch (error) {
      console.error('Update preferences error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update notification preferences'
      });
    }
  });

  // Get notification preferences
  router.get('/user/notification-preferences', async (req, res) => {
    try {
      const userId = req.user?.id || req.query.userId;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID required'
        });
      }

      const preferences = await NotificationPreferences.findOne({ userId });

      res.json({
        success: true,
        preferences: preferences || {
          pushEnabled: true,
          emailEnabled: true,
          categories: {
            orders: true,
            promotions: true,
            priceDrops: true,
            stockAlerts: true,
            cartAbandonment: true,
            systemAlerts: false
          },
          quietHours: {
            enabled: false,
            startTime: '22:00',
            endTime: '08:00',
            timezone: 'UTC'
          }
        }
      });

    } catch (error) {
      console.error('Get preferences error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get notification preferences'
      });
    }
  });

  // Send test notification (admin only)
  router.post('/admin/push/test', async (req, res) => {
    try {
      const { userId, notification } = req.body;

      const result = await PushNotificationService.sendToUser(userId, notification);

      res.json({
        success: true,
        result
      });

    } catch (error) {
      console.error('Test push error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send test notification'
      });
    }
  });

  // Broadcast notification (admin only)
  router.post('/admin/push/broadcast', async (req, res) => {
    try {
      const { notification, criteria } = req.body;

      const results = await PushNotificationService.broadcast(notification, criteria);

      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;

      res.json({
        success: true,
        message: `Notification sent to ${successful} users`,
        totalUsers: results.length,
        successful,
        failed,
        results
      });

    } catch (error) {
      console.error('Broadcast push error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to broadcast notification'
      });
    }
  });

  // Get push notification analytics (admin only)
  router.get('/admin/push/analytics', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const analytics = await PushNotificationService.getAnalytics(startDate, endDate);

      res.json({
        success: true,
        analytics
      });

    } catch (error) {
      console.error('Push analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get analytics'
      });
    }
  });

  return router;
};

// Scheduled notifications (cron jobs)
const setupPushCronJobs = () => {
  
  // Daily promotional notifications
  cron.schedule('0 10 * * *', async () => {
    try {
      const promotions = await mongoose.model('Promotion').find({
        isActive: true,
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() }
      });

      for (const promo of promotions) {
        await PushNotificationService.broadcast({
          type: 'promotional',
          title: promo.title,
          body: promo.description,
          image: promo.image,
          url: `/promotions/${promo._id}`,
          category: 'promotions'
        });
      }

    } catch (error) {
      console.error('Error sending promotional notifications:', error);
    }
  });

  // Price drop alerts
  cron.schedule('0 */2 * * * *', async () => { // Every 2 hours
    try {
      // This would integrate with your product monitoring system
      // For now, it's a placeholder
      console.log('Checking for price drops...');
    } catch (error) {
      console.error('Error checking price drops:', error);
    }
  });

  console.log('Push notification cron jobs initialized');
};

module.exports = {
  PushSubscription,
  PushNotification,
  NotificationPreferences,
  PushNotificationService,
  pushNotificationRoutes,
  setupPushCronJobs
};
