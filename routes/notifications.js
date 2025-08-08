const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const router = express.Router();

// ==================== GET USER NOTIFICATIONS ====================
router.get('/', protect, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      read = 'all',
      type,
      priority 
    } = req.query;

    const filters = { user: req.user.id };

    if (read === 'unread') {
      filters.isRead = false;
    } else if (read === 'read') {
      filters.isRead = true;
    }

    if (type) {
      filters.type = type;
    }

    if (priority) {
      filters.priority = priority;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, totalNotifications, unreadCount] = await Promise.all([
      Notification.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Notification.countDocuments(filters),
      Notification.countDocuments({ user: req.user.id, isRead: false })
    ]);

    res.json({
      success: true,
      message: 'Notifications retrieved successfully',
      data: {
        notifications: notifications.map(notification => ({
          id: notification._id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          priority: notification.priority,
          isRead: notification.isRead,
          actionUrl: notification.actionUrl,
          actionText: notification.actionText,
          createdAt: notification.createdAt,
          readAt: notification.readAt
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalNotifications,
          pages: Math.ceil(totalNotifications / parseInt(limit))
        },
        unreadCount
      }
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications',
      message: error.message
    });
  }
});

// ==================== MARK NOTIFICATION AS READ ====================
router.patch('/:id/read', protect, async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, user: req.user.id },
      { 
        isRead: true, 
        readAt: new Date() 
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: {
        id: notification._id,
        isRead: notification.isRead,
        readAt: notification.readAt
      }
    });

  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read',
      message: error.message
    });
  }
});

// ==================== MARK ALL NOTIFICATIONS AS READ ====================
router.patch('/read-all', protect, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user.id, isRead: false },
      { 
        isRead: true, 
        readAt: new Date() 
      }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: {
        updatedCount: result.modifiedCount
      }
    });

  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark all notifications as read',
      message: error.message
    });
  }
});

// ==================== DELETE NOTIFICATION ====================
router.delete('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findOneAndDelete({
      _id: id,
      user: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete notification',
      message: error.message
    });
  }
});

// ==================== DELETE ALL NOTIFICATIONS ====================
router.delete('/clear-all', protect, async (req, res) => {
  try {
    const { read = 'all' } = req.query;

    const filters = { user: req.user.id };

    if (read === 'read') {
      filters.isRead = true;
    } else if (read === 'unread') {
      filters.isRead = false;
    }

    const result = await Notification.deleteMany(filters);

    res.json({
      success: true,
      message: 'Notifications cleared successfully',
      data: {
        deletedCount: result.deletedCount
      }
    });

  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear notifications',
      message: error.message
    });
  }
});

// ==================== GET NOTIFICATION SETTINGS ====================
router.get('/settings', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('notificationSettings');

    res.json({
      success: true,
      message: 'Notification settings retrieved successfully',
      data: {
        settings: user.notificationSettings || {
          email: {
            orders: true,
            promotions: true,
            updates: true,
            security: true
          },
          push: {
            orders: true,
            promotions: false,
            updates: true,
            security: true
          },
          sms: {
            orders: true,
            promotions: false,
            updates: false,
            security: true
          }
        }
      }
    });

  } catch (error) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification settings',
      message: error.message
    });
  }
});

// ==================== UPDATE NOTIFICATION SETTINGS ====================
router.put('/settings', [
  protect,
  body('email.orders').optional().isBoolean(),
  body('email.promotions').optional().isBoolean(),
  body('email.updates').optional().isBoolean(),
  body('email.security').optional().isBoolean(),
  body('push.orders').optional().isBoolean(),
  body('push.promotions').optional().isBoolean(),
  body('push.updates').optional().isBoolean(),
  body('push.security').optional().isBoolean(),
  body('sms.orders').optional().isBoolean(),
  body('sms.promotions').optional().isBoolean(),
  body('sms.updates').optional().isBoolean(),
  body('sms.security').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, push, sms } = req.body;

    const updateData = {};
    if (email) updateData['notificationSettings.email'] = email;
    if (push) updateData['notificationSettings.push'] = push;
    if (sms) updateData['notificationSettings.sms'] = sms;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true }
    ).select('notificationSettings');

    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      data: {
        settings: user.notificationSettings
      }
    });

  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update notification settings',
      message: error.message
    });
  }
});

// ==================== CREATE NOTIFICATION (ADMIN/SYSTEM) ====================
router.post('/', [
  protect,
  authorize('admin'),
  body('user').isMongoId().withMessage('Valid user ID is required'),
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required (1-200 chars)'),
  body('message').trim().isLength({ min: 1, max: 1000 }).withMessage('Message is required (1-1000 chars)'),
  body('type').isIn(['order', 'promotion', 'update', 'security', 'system']).withMessage('Invalid notification type'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority level'),
  body('actionUrl').optional().isURL().withMessage('Invalid action URL'),
  body('actionText').optional().trim().isLength({ max: 50 }).withMessage('Action text too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      user,
      title,
      message,
      type,
      priority = 'medium',
      actionUrl,
      actionText
    } = req.body;

    // Verify user exists
    const userExists = await User.findById(user);
    if (!userExists) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const notification = new Notification({
      user,
      title,
      message,
      type,
      priority,
      actionUrl,
      actionText,
      isRead: false
    });

    await notification.save();

    // Emit real-time notification if Socket.IO is available
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`user_${user}`).emit('notification', {
          id: notification._id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          priority: notification.priority,
          actionUrl: notification.actionUrl,
          actionText: notification.actionText,
          createdAt: notification.createdAt
        });
      }
    } catch (socketError) {
      console.warn('Socket.IO not available for real-time notification');
    }

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      data: {
        id: notification._id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        priority: notification.priority,
        actionUrl: notification.actionUrl,
        actionText: notification.actionText,
        isRead: notification.isRead,
        createdAt: notification.createdAt
      }
    });

  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create notification',
      message: error.message
    });
  }
});

// ==================== CREATE BULK NOTIFICATIONS ====================
router.post('/bulk', [
  protect,
  authorize('admin'),
  body('users').isArray({ min: 1 }).withMessage('At least one user ID is required'),
  body('users.*').isMongoId().withMessage('Invalid user ID in array'),
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required (1-200 chars)'),
  body('message').trim().isLength({ min: 1, max: 1000 }).withMessage('Message is required (1-1000 chars)'),
  body('type').isIn(['order', 'promotion', 'update', 'security', 'system']).withMessage('Invalid notification type'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority level'),
  body('actionUrl').optional().isURL().withMessage('Invalid action URL'),
  body('actionText').optional().trim().isLength({ max: 50 }).withMessage('Action text too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      users,
      title,
      message,
      type,
      priority = 'medium',
      actionUrl,
      actionText
    } = req.body;

    // Verify all users exist
    const existingUsers = await User.find({ _id: { $in: users } }).select('_id');
    const existingUserIds = existingUsers.map(user => user._id.toString());
    const invalidUsers = users.filter(userId => !existingUserIds.includes(userId));

    if (invalidUsers.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Some users not found',
        invalidUsers
      });
    }

    // Create notifications for all users
    const notifications = users.map(userId => ({
      user: userId,
      title,
      message,
      type,
      priority,
      actionUrl,
      actionText,
      isRead: false,
      createdAt: new Date()
    }));

    const createdNotifications = await Notification.insertMany(notifications);

    // Emit real-time notifications
    try {
      const io = req.app.get('io');
      if (io) {
        createdNotifications.forEach(notification => {
          io.to(`user_${notification.user}`).emit('notification', {
            id: notification._id,
            title: notification.title,
            message: notification.message,
            type: notification.type,
            priority: notification.priority,
            actionUrl: notification.actionUrl,
            actionText: notification.actionText,
            createdAt: notification.createdAt
          });
        });
      }
    } catch (socketError) {
      console.warn('Socket.IO not available for real-time notifications');
    }

    res.status(201).json({
      success: true,
      message: 'Bulk notifications created successfully',
      data: {
        createdCount: createdNotifications.length,
        notifications: createdNotifications.map(notification => ({
          id: notification._id,
          user: notification.user,
          title: notification.title,
          type: notification.type,
          priority: notification.priority,
          createdAt: notification.createdAt
        }))
      }
    });

  } catch (error) {
    console.error('Error creating bulk notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create bulk notifications',
      message: error.message
    });
  }
});

// ==================== GET NOTIFICATION STATISTICS ====================
router.get('/stats', [protect, authorize('admin')], async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    // Determine date range
    const now = new Date();
    let startDate;
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const filters = { createdAt: { $gte: startDate, $lte: now } };

    // Get notification statistics
    const stats = await Notification.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          totalNotifications: { $sum: 1 },
          readNotifications: { $sum: { $cond: ['$isRead', 1, 0] } },
          unreadNotifications: { $sum: { $cond: ['$isRead', 0, 1] } }
        }
      }
    ]);

    // Get notifications by type
    const notificationsByType = await Notification.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          readCount: { $sum: { $cond: ['$isRead', 1, 0] } }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get notifications by priority
    const notificationsByPriority = await Notification.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 },
          readCount: { $sum: { $cond: ['$isRead', 1, 0] } }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get daily notification trend
    const dailyNotifications = await Notification.aggregate([
      { $match: filters },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 },
          readCount: { $sum: { $cond: ['$isRead', 1, 0] } }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.json({
      success: true,
      message: 'Notification statistics retrieved successfully',
      data: {
        period,
        summary: stats[0] || {
          totalNotifications: 0,
          readNotifications: 0,
          unreadNotifications: 0
        },
        notificationsByType,
        notificationsByPriority,
        dailyNotifications
      }
    });

  } catch (error) {
    console.error('Error fetching notification statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification statistics',
      message: error.message
    });
  }
});

module.exports = router;
