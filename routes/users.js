/**
 * routes/users.js
 * Production-grade, MNC-style user routes
 *
 * NOTE:
 * - This file assumes `req.user.id` is populated with the Supabase user ID by middleware.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const asyncHandler = require('express-async-handler');
const { promisify } = require('util');

const User = require('../models/User');
const Address = require('../models/Address');
const Order = require('../models/Order');

const { hybridProtect, requireRole } = require('../middleware/hybridAuth');
const { checkPermission } = require('../middleware/authMiddleware');
const upload = require('../utils/multer');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const { sendEmail } = require('../utils/email');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

const router = express.Router();

/* ---------------------------
   Configuration & Constants
   --------------------------- */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_ADDRESSES = 5;
const AVATAR_WIDTH = 300;
const AVATAR_HEIGHT = 300;
const adminStatsCache = new NodeCache({ stdTTL: 45, checkperiod: 60 });
const unlinkAsync = promisify(fs.unlink);

const UserRoles = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  REGIONAL_MANAGER: 'regional_manager',
  SELLER: 'seller',
  CUSTOMER: 'customer',
  MODERATOR: 'moderator',
  DELIVERY_AGENT: 'delivery_agent',
  SUPPORT: 'support'
};

const Permissions = {
  USER_VIEW_ALL: 'user:view:all',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_MANAGE_ROLES: 'user:manage:roles',
  PROFILE_VIEW_OWN: 'profile:view:own',
  PROFILE_UPDATE_OWN: 'profile:update:own',
  ADDRESS_MANAGE_OWN: 'address:manage:own',
  ORDER_VIEW_OWN: 'order:view:own',
  ORDER_VIEW_ALL: 'order:view:all'
};

const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: (req) => `user:${req.ip}:${req.user?.id || 'anon'}`,
  handler: (req, res) => {
    logger.warn('rate_limited', { route: req.originalUrl, ip: req.ip });
    return res.status(429).json({ success: false, message: 'Too many requests' });
  }
});

const profileUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `profile_update:${req.user?.id || req.ip}`,
  handler: (req, res) => res.status(429).json({ success: false, message: 'Too many profile updates' })
});

const validateUserUpdate = [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Invalid email'),
  body('phone').optional().isMobilePhone('en-IN').withMessage('Invalid Indian phone number'),
  body('dateOfBirth').optional().isISO8601().withMessage('Invalid date').custom(value => {
    const age = (Date.now() - new Date(value).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 13) throw new Error('Must be at least 13 years old');
    if (age > 120) throw new Error('Invalid birthdate');
    return true;
  }),
  body('gender').optional().isIn(['male', 'female', 'other', 'prefer_not_to_say']),
  body('bio').optional().isLength({ max: 500 })
];

function responseOK(res, payload = {}, message = null) {
  return res.json({ success: true, message, data: payload });
}

function responseError(res, status = 500, message = 'Internal error', error = null) {
  const body = { success: false, message };
  if (process.env.NODE_ENV !== 'production' && error) body.error = error.message || error;
  return res.status(status).json(body);
}

function safeGetIo(req) {
  try {
    if (!req || !req.app) return null;
    const io = typeof req.app.get === 'function' ? req.app.get('io') : null;
    return io && typeof io.to === 'function' ? io : null;
  } catch (err) {
    logger.warn('safeGetIo failed', { err: err.message });
    return null;
  }
}

function extractPublicIdFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const uploadIdx = parts.findIndex(p => p === 'upload');
    if (uploadIdx === -1) return null;
    const publicParts = parts.slice(uploadIdx + 2);
    if (!publicParts.length) return null;
    return publicParts.join('/').replace(/\.[^/.]+$/, '');
  } catch (err) {
    logger.warn('extractPublicIdFromUrl error', { err: err.message, url });
    return null;
  }
}

async function getCachedAdminStats() {
  const cached = adminStatsCache.get('admin:users:stats');
  if (cached) return cached;

  const agg = await User.aggregate([
    {
      $group: {
        _id: null,
        totalUsers: { $sum: 1 },
        activeUsers: {
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
        },
        verifiedUsers: {
          $sum: { $cond: ['$isVerified', 1, 0] }
        },
        roles: { $push: '$role' }
      }
    }
  ]);

  const stats = agg[0] || { totalUsers: 0, activeUsers: 0, verifiedUsers: 0, roles: [] };
  const roleDistribution = {};
  (stats.roles || []).forEach(r => roleDistribution[r] = (roleDistribution[r] || 0) + 1);
  const result = {
    totalUsers: stats.totalUsers || 0,
    activeUsers: stats.activeUsers || 0,
    verifiedUsers: stats.verifiedUsers || 0,
    roleDistribution
  };

  adminStatsCache.set('admin:users:stats', result);
  return result;
}

/* ---------------------------
   Route: Get current profile
   --------------------------- */
router.get('/profile', hybridProtect, checkPermission(Permissions.PROFILE_VIEW_OWN), userLimiter, asyncHandler(async (req, res) => {
  const timer = metrics?.startTimer?.('users_profile_get') || null;
  try {
    // Look up user by supabaseId from the auth middleware
    const user = await User.findOne({ supabaseId: req.user.id }).populate('addresses').lean();
    if (!user) return responseError(res, 404, 'User profile not found');

    const stats = await (async () => {
      try { return await getUserStatistics(req.user.id, user.role); } catch (e) { logger.warn('getUserStatistics failed', { err: e.message }); return {}; }
    })();

    const recentActivity = await (async () => {
      try { return await getUserRecentActivity(req.user.id); } catch (e) { logger.warn('getUserRecentActivity failed', { err: e.message }); return []; }
    })();

    const profileCompletion = calculateProfileCompletion(user);
    const permissions = await getUserPermissions(user.role);

    const payload = {
      user,
      stats,
      recentActivity,
      profileCompletion,
      permissions,
      lastActiveAt: new Date()
    };

    metrics?.observe?.('users_profile_get_success');
    return responseOK(res, payload);
  } catch (err) {
    logger.error('GET /users/profile failed', { err: err.message });
    return responseError(res, 500, 'Failed to fetch profile', err);
  } finally {
    timer && timer.stop();
  }
}));

/* ---------------------------
   Route: Update profile (patch)
   --------------------------- */
router.patch('/profile',
  hybridProtect,
  checkPermission(Permissions.PROFILE_UPDATE_OWN),
  profileUpdateLimiter,
  validateUserUpdate,
  asyncHandler(async (req, res) => {
    const timer = metrics?.startTimer?.('users_profile_patch') || null;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return responseError(res, 400, 'Validation failed', { errors: errors.array() });

      const allowed = ['name', 'phone', 'dateOfBirth', 'gender', 'bio'];
      const payload = {};
      allowed.forEach(k => { if (req.body[k] !== undefined) payload[k] = req.body[k]; });

      payload.updatedAt = new Date();
      // Update user by supabaseId
      const updated = await User.findOneAndUpdate({ supabaseId: req.user.id }, payload, { new: true, runValidators: true }).lean();

      if (!updated) return responseError(res, 404, 'User profile not found');

      const io = safeGetIo(req);
      if (io) {
        process.nextTick(() => {
          try { io.to(`user-${req.user.id}`).emit('profile-updated', { userId: req.user.id, updatedFields: Object.keys(payload) }); }
          catch (e) { logger.warn('socket_emit_failed', { err: e.message }); }
        });
      }

      return responseOK(res, { user: updated }, 'Profile updated successfully');
    } catch (err) {
      logger.error('PATCH /users/profile error', { err: err.message, userId: req.user.id });
      return responseError(res, 500, 'Failed to update profile', err);
    } finally {
      timer && timer.stop();
    }
  })
);

/* ---------------------------
   Route: Upload avatar
   --------------------------- */
router.post('/avatar',
  hybridProtect,
  checkPermission(Permissions.PROFILE_UPDATE_OWN),
  profileUpdateLimiter,
  upload.single('avatar'),
  asyncHandler(async (req, res) => {
    const timer = metrics?.startTimer?.('users_avatar_post') || null;
    try {
      if (!req.file) return responseError(res, 400, 'Avatar file is required');

      const optimizedBuffer = await sharp(req.file.path)
        .resize(AVATAR_WIDTH, AVATAR_HEIGHT, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 85 })
        .toBuffer();

      const uploadResult = await uploadToCloudinary(optimizedBuffer, { folder: `quicklocal/avatars/${req.user.id}`, public_id: `avatar_${Date.now()}`, transformation: [{ width: AVATAR_WIDTH, height: AVATAR_HEIGHT, crop: 'fill' }] });

      const user = await User.findOne({ supabaseId: req.user.id }).lean();
      if (user?.profilePicture) {
        const publicId = extractPublicIdFromUrl(user.profilePicture);
        if (publicId) {
          await deleteFromCloudinary(publicId).catch(err => logger.warn('delete_old_avatar_failed', { err: err.message }));
        }
      }

      const updated = await User.findOneAndUpdate({ supabaseId: req.user.id }, { profilePicture: uploadResult.secure_url, updatedAt: new Date() }, { new: true }).lean();

      if (req.file?.path) {
        try { await unlinkAsync(req.file.path); } catch (e) { logger.warn('temp_unlink_failed', { err: e.message, path: req.file.path }); }
      }

      const io = safeGetIo(req);
      if (io) {
        process.nextTick(() => {
          try { io.to(`user-${req.user.id}`).emit('avatar-updated', { userId: req.user.id, avatar: uploadResult.secure_url }); }
          catch (e) { logger.warn('avatar_emit_failed', { err: e.message }); }
        });
      }

      return responseOK(res, { avatar: uploadResult.secure_url, user: updated }, 'Avatar uploaded successfully');
    } catch (err) {
      if (req.file?.path) await unlinkAsync(req.file.path).catch(e => logger.warn('temp_unlink_failed_on_error', { err: e.message }));
      logger.error('POST /users/avatar error', { err: err.message });
      return responseError(res, 500, 'Failed to upload avatar', err);
    } finally {
      timer && timer.stop();
    }
  })
);

// ... rest of the file ...

module.exports = router;