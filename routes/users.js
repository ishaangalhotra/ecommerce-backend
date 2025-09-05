/**
 * routes/users.js
 * Production-grade, MNC-style user routes
 *
 * Key features:
 *  - Defensive socket usage (req.app.get('io'))
 *  - Caching for heavy aggregations (in-memory with optional Redis)
 *  - Structured JSON responses and consistent error handling
 *  - Rate-limiting, validation, RBAC checks
 *  - Safe file cleanup for avatar uploads
 *
 * NOTE:
 *  - Ensure server bootstrap sets `app.set('io', ioInstance)` if using socket.io.
 *  - Ensure generateToken sets 'sub' (subject) OR auth middleware handles fallbacks.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache'); // lightweight in-memory cache
const asyncHandler = require('express-async-handler'); // for concise async routes
const { promisify } = require('util');

const User = require('../models/User');
const Address = require('../models/Address');
const Order = require('../models/Order');

const { protect, authorize, checkPermission } = require('../middleware/authMiddleware');
const upload = require('../utils/multer'); // disk storage multer instance expected
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const { sendEmail } = require('../utils/email');
const { generateToken } = require('../utils/auth'); // ensure this sets 'sub' claim
const logger = require('../utils/logger'); // structured logger (pino/winston-like)
const metrics = require('../utils/metrics'); // optional metrics collector (timings)

// Optional Redis client (uncomment if available and configured)
// const redisClient = require('../config/redis'); // must expose get/set/expire

const router = express.Router();

/* ---------------------------
   Configuration & Constants
   --------------------------- */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_ADDRESSES = 5;
const AVATAR_WIDTH = 300;
const AVATAR_HEIGHT = 300;

// in-memory cache for admin aggregations (TTL seconds)
const adminStatsCache = new NodeCache({ stdTTL: 45, checkperiod: 60 }); // short TTL

// helper promisified functions
const unlinkAsync = promisify(fs.unlink);

/* ---------------------------
   Roles & Permissions
   --------------------------- */
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

/* ---------------------------
   Rate limiters
   --------------------------- */
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

/* ---------------------------
   Validation helpers
   --------------------------- */
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

const validateAddress = [
  body('type').isIn(['home', 'work', 'other']).withMessage('Invalid address type'),
  body('street').trim().isLength({ min: 5, max: 200 }),
  body('city').trim().isLength({ min: 2, max: 100 }),
  body('state').trim().isLength({ min: 2, max: 100 }),
  body('pincode').matches(/^[1-9][0-9]{5}$/).withMessage('Invalid pincode'),
  body('coordinates').optional().isArray({ min: 2, max: 2 })
];

/* ---------------------------
   Utility helpers
   --------------------------- */

function responseOK(res, payload = {}, message = null) {
  return res.json({ success: true, message, data: payload });
}

function responseError(res, status = 500, message = 'Internal error', error = null) {
  const body = { success: false, message };
  if (process.env.NODE_ENV !== 'production' && error) body.error = error.message || error;
  return res.status(status).json(body);
}

/**
 * Safely get socket.io instance from app
 * - Using req.app.get('io') is the recommended pattern
 * - If not available, we simply skip emits (non-fatal)
 */
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

/**
 * Extract Cloudinary public id robustly
 */
function extractPublicIdFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const uploadIdx = parts.findIndex(p => p === 'upload');
    if (uploadIdx === -1) return null;
    const publicParts = parts.slice(uploadIdx + 2);
    if (!publicParts.length) return null;
    // Join remainder (folder/.../public_id.ext) and strip extension
    return publicParts.join('/').replace(/\.[^/.]+$/, '');
  } catch (err) {
    logger.warn('extractPublicIdFromUrl error', { err: err.message, url });
    return null;
  }
}

/**
 * Fallback userId detection from JWT payload - tolerant approach
 * (Helper for any middleware that calls into user-aware code)
 */
function extractUserIdFromPayload(payload = {}) {
  return payload.sub || payload.userId || payload.id || null;
}

/* ---------------------------
   Lightweight admin stats caching
   - Prefer Redis in real MNC infra; fallback to in-memory cache
   --------------------------- */
async function getCachedAdminStats() {
  // Try Redis if available (uncomment if you have Redis)
  // try {
  //   if (redisClient && redisClient.get) {
  //     const raw = await redisClient.get('admin:users:stats');
  //     if (raw) return JSON.parse(raw);
  //   }
  // } catch (err) {
  //   logger.debug('redis get failed, falling back to memory cache', { err: err.message });
  // }

  const cached = adminStatsCache.get('admin:users:stats');
  if (cached) return cached;

  // compute fresh
  const agg = await User.aggregate([
    {
      $group: {
        _id: null,
        totalUsers: { $sum: 1 },
        activeUsers: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        verifiedUsers: {
          $sum: { $cond: ['$isVerified', 1, 0] }
        },
        roles: { $push: '$role' }
      }
    }
  ]);

  const stats = agg[0] || { totalUsers: 0, activeUsers: 0, verifiedUsers: 0, roles: [] };
  // roll-up role counts
  const roleDistribution = {};
  (stats.roles || []).forEach(r => roleDistribution[r] = (roleDistribution[r] || 0) + 1);
  const result = {
    totalUsers: stats.totalUsers || 0,
    activeUsers: stats.activeUsers || 0,
    verifiedUsers: stats.verifiedUsers || 0,
    roleDistribution
  };

  adminStatsCache.set('admin:users:stats', result);
  // Optionally push to Redis with short TTL
  // if (redisClient && redisClient.setex) {
  //   await redisClient.setex('admin:users:stats', 45, JSON.stringify(result));
  // }

  return result;
}

/* ---------------------------
   Route: Get current profile
   --------------------------- */
router.get('/profile', protect, checkPermission(Permissions.PROFILE_VIEW_OWN), userLimiter, asyncHandler(async (req, res) => {
  const timer = metrics?.startTimer?.('users_profile_get') || null;
  try {
    // Load user with addresses (lean for performance)
    const user = await User.findById(req.user.id).select('-password -refreshToken').populate('addresses').lean();
    if (!user) return responseError(res, 404, 'User not found');

    // basic stats and recent activity
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

    metrics?.observe?.('users_profile_get_success') ;
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
   - Email change triggers verify email flow
   --------------------------- */
router.patch('/profile',
  protect,
  checkPermission(Permissions.PROFILE_UPDATE_OWN),
  profileUpdateLimiter,
  validateUserUpdate,
  asyncHandler(async (req, res) => {
    const timer = metrics?.startTimer?.('users_profile_patch') || null;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return responseError(res, 400, 'Validation failed', { errors: errors.array() });

      const allowed = ['name', 'phone', 'dateOfBirth', 'gender', 'bio', 'preferences'];
      const payload = {};
      allowed.forEach(k => { if (req.body[k] !== undefined) payload[k] = req.body[k]; });

      // If email change requested — set pendingEmail and send verification
      let emailChanged = false;
      if (req.body.email && req.body.email !== req.user.email) {
        payload.pendingEmail = req.body.email;
        payload.isEmailVerified = false;
        emailChanged = true;
      }

      payload.updatedAt = new Date();
      const updated = await User.findByIdAndUpdate(req.user.id, payload, { new: true, runValidators: true }).select('-password -refreshToken');

      // Emit event safely (non-blocking)
      const io = safeGetIo(req);
      if (io) {
        process.nextTick(() => {
          try { io.to(`user-${req.user.id}`).emit('profile-updated', { userId: req.user.id, updatedFields: Object.keys(payload) }); }
          catch (e) { logger.warn('socket_emit_failed', { err: e.message }); }
        });
      }

      // Send verification email if needed (non-blocking)
      if (emailChanged) {
        try {
          // generateToken ideally sets `sub`; if not, this token may not be accepted by verify route until you unify tokens
          const token = generateToken(req.user.id);
          await sendEmail({
            to: req.body.email,
            subject: 'Verify your new email address',
            template: 'email-change-verification',
            data: { name: updated.name, verificationUrl: `${process.env.CLIENT_URL}/verify-email/${token}` }
          });
        } catch (e) {
          logger.warn('email_send_failed', { err: e.message, userId: req.user.id });
          // Do not fail request if email fails; inform client
          return responseOK(res, { user: updated, emailVerificationRequired: true }, 'Profile updated — verification email could not be delivered, retry later');
        }
      }

      return responseOK(res, { user: updated, emailVerificationRequired: emailChanged }, 'Profile updated successfully');
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
   - Uses multer disk storage; we optimize image with sharp and upload to cloudinary
   - Safe temp file removal on success & error
   --------------------------- */
router.post('/avatar',
  protect,
  checkPermission(Permissions.PROFILE_UPDATE_OWN),
  profileUpdateLimiter,
  upload.single('avatar'),
  asyncHandler(async (req, res) => {
    const timer = metrics?.startTimer?.('users_avatar_post') || null;
    try {
      if (!req.file) return responseError(res, 400, 'Avatar file is required');

      // optimize
      const optimizedBuffer = await sharp(req.file.path)
        .resize(AVATAR_WIDTH, AVATAR_HEIGHT, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 85 })
        .toBuffer();

      // upload
      const uploadResult = await uploadToCloudinary(optimizedBuffer, {
        folder: `quicklocal/avatars/${req.user.id}`,
        public_id: `avatar_${Date.now()}`,
        transformation: [{ width: AVATAR_WIDTH, height: AVATAR_HEIGHT, crop: 'fill' }]
      });

      // delete old avatar if present
      try {
        const user = await User.findById(req.user.id).select('avatar');
        if (user?.avatar) {
          const publicId = extractPublicIdFromUrl(user.avatar);
          if (publicId) {
            // fire & forget, but await to capture any provider errors if desired
            await deleteFromCloudinary(publicId).catch(err => logger.warn('delete_old_avatar_failed', { err: err.message }));
          }
        }
      } catch (err) {
        logger.warn('old_avatar_deletion_error', { err: err.message, userId: req.user.id });
      }

      // update DB
      const updated = await User.findByIdAndUpdate(req.user.id, { avatar: uploadResult.secure_url, updatedAt: new Date() }, { new: true }).select('-password -refreshToken');

      // cleanup temp file
      if (req.file?.path) {
        try { await unlinkAsync(req.file.path); } catch (e) { logger.warn('temp_unlink_failed', { err: e.message, path: req.file.path }); }
      }

      // emit event non-blocking
      const io = safeGetIo(req);
      if (io) {
        process.nextTick(() => {
          try { io.to(`user-${req.user.id}`).emit('avatar-updated', { userId: req.user.id, avatar: uploadResult.secure_url }); }
          catch (e) { logger.warn('avatar_emit_failed', { err: e.message }); }
        });
      }

      return responseOK(res, { avatar: uploadResult.secure_url, user: updated }, 'Avatar uploaded successfully');
    } catch (err) {
      // ensure temp file removal on error
      try { if (req.file?.path) await unlinkAsync(req.file.path); } catch (e) { logger.warn('temp_unlink_on_error_failed', { err: e.message }); }
      logger.error('POST /users/avatar failed', { err: err.message, userId: req.user?.id });
      return responseError(res, 500, 'Failed to upload avatar', err);
    } finally {
      timer && timer.stop();
    }
  })
);

/* ---------------------------
   Addresses CRUD (user-scoped)
   --------------------------- */

router.get('/addresses',
  protect,
  checkPermission(Permissions.ADDRESS_MANAGE_OWN),
  userLimiter,
  asyncHandler(async (req, res) => {
    try {
      const addresses = await Address.find({ user: req.user.id, isDeleted: false }).sort({ isDefault: -1, createdAt: -1 }).lean();
      return responseOK(res, { addresses, count: addresses.length });
    } catch (err) {
      logger.error('GET /users/addresses failed', { err: err.message, userId: req.user.id });
      return responseError(res, 500, 'Failed to get addresses', err);
    }
  })
);

router.post('/addresses',
  protect,
  checkPermission(Permissions.ADDRESS_MANAGE_OWN),
  profileUpdateLimiter,
  validateAddress,
  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return responseError(res, 400, 'Validation failed', { errors: errors.array() });

      const count = await Address.countDocuments({ user: req.user.id, isDeleted: false });
      if (count >= MAX_ADDRESSES) return responseError(res, 400, `Maximum ${MAX_ADDRESSES} addresses allowed`);

      const data = { ...req.body, user: req.user.id };

      if (count === 0 || req.body.isDefault) {
        if (req.body.isDefault) await Address.updateMany({ user: req.user.id }, { isDefault: false });
        data.isDefault = true;
      }

      const address = await Address.create(data);
      return responseOK(res, { address }, 'Address added');
    } catch (err) {
      logger.error('POST /users/addresses failed', { err: err.message, userId: req.user.id });
      return responseError(res, 500, 'Failed to add address', err);
    }
  })
);

router.patch('/addresses/:id',
  protect,
  checkPermission(Permissions.ADDRESS_MANAGE_OWN),
  profileUpdateLimiter,
  validateAddress,
  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return responseError(res, 400, 'Validation failed', { errors: errors.array() });

      const address = await Address.findOne({ _id: req.params.id, user: req.user.id, isDeleted: false });
      if (!address) return responseError(res, 404, 'Address not found');

      if (req.body.isDefault && !address.isDefault) {
        await Address.updateMany({ user: req.user.id }, { isDefault: false });
      }

      const updated = await Address.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }, { new: true, runValidators: true });
      return responseOK(res, { address: updated }, 'Address updated');
    } catch (err) {
      logger.error('PATCH /users/addresses/:id failed', { err: err.message, userId: req.user.id });
      return responseError(res, 500, 'Failed to update address', err);
    }
  })
);

router.delete('/addresses/:id',
  protect,
  checkPermission(Permissions.ADDRESS_MANAGE_OWN),
  userLimiter,
  asyncHandler(async (req, res) => {
    try {
      const address = await Address.findOne({ _id: req.params.id, user: req.user.id, isDeleted: false });
      if (!address) return responseError(res, 404, 'Address not found');

      address.isDeleted = true;
      address.deletedAt = new Date();
      await address.save();

      if (address.isDefault) {
        const next = await Address.findOne({ user: req.user.id, isDeleted: false, _id: { $ne: address._id } });
        if (next) { next.isDefault = true; await next.save(); }
      }

      return responseOK(res, {}, 'Address removed');
    } catch (err) {
      logger.error('DELETE /users/addresses/:id failed', { err: err.message, userId: req.user.id });
      return responseError(res, 500, 'Failed to delete address', err);
    }
  })
);

/* ---------------------------
   Admin: list users (with cached aggregation)
   - admin only, supports pagination, search, filters
   --------------------------- */
router.get('/',
  protect,
  authorize(UserRoles.ADMIN, UserRoles.SUPER_ADMIN),
  checkPermission(Permissions.USER_VIEW_ALL),
  userLimiter,
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    query('role').optional().isIn(Object.values(UserRoles)),
    query('status').optional().isIn(['active', 'inactive', 'suspended'])
  ],
  asyncHandler(async (req, res) => {
    const timer = metrics?.startTimer?.('admin_users_list') || null;
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return responseError(res, 400, 'Validation failed', { errors: errors.array() });

      const page = req.query.page || DEFAULT_PAGE;
      const limit = req.query.limit || DEFAULT_LIMIT;
      const role = req.query.role;
      const status = req.query.status;
      const search = req.query.search || '';
      const sortBy = req.query.sortBy || 'createdAt';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

      const mongoQuery = {};
      if (role) mongoQuery.role = role;
      if (status) mongoQuery.status = status;
      if (search) {
        mongoQuery.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ];
      }

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder };

      // Parallel queries
      const [users, totalUsers, stats] = await Promise.all([
        User.find(mongoQuery).select('-password -refreshToken').sort(sort).skip(skip).limit(limit).lean(),
        User.countDocuments(mongoQuery),
        getCachedAdminStats()
      ]);

      const payload = {
        users,
        pagination: {
          page,
          limit,
          totalPages: Math.ceil(totalUsers / limit),
          totalUsers
        },
        stats
      };

      return responseOK(res, payload);
    } catch (err) {
      logger.error('GET /users (admin) failed', { err: err.message, userId: req.user.id });
      return responseError(res, 500, 'Failed to fetch users', err);
    } finally {
      timer && timer.stop();
    }
  })
);

/* ---------------------------
   Admin: change user role
   --------------------------- */
router.patch('/:id/role',
  protect,
  authorize(UserRoles.ADMIN, UserRoles.SUPER_ADMIN),
  checkPermission(Permissions.USER_MANAGE_ROLES),
  body('role').isIn(Object.values(UserRoles)),
  asyncHandler(async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return responseError(res, 400, 'Validation failed', { errors: errors.array() });

      const targetId = req.params.id;
      if (targetId === req.user.id) return responseError(res, 400, 'Cannot change your own role');

      const target = await User.findById(targetId);
      if (!target) return responseError(res, 404, 'User not found');

      const newRole = req.body.role;

      // simple role assignment protection (example: admin cannot make someone super_admin)
      if (!canAssignRole(req.user.role, newRole)) return responseError(res, 403, 'Insufficient permission to assign this role');

      const previousRole = target.role;
      target.role = newRole;
      target.roleChangedAt = new Date();
      target.roleChangedBy = req.user.id;
      await target.save();

      // send email notification (best-effort)
      process.nextTick(async () => {
        try {
          await sendEmail({
            to: target.email,
            subject: 'Your role has changed',
            template: 'role-updated',
            data: { name: target.name, previousRole, newRole, updatedBy: req.user.name || req.user.email }
          });
        } catch (e) {
          logger.warn('role_update_email_failed', { err: e.message, userId: targetId });
        }
      });

      return responseOK(res, { id: target._id, name: target.name, email: target.email, role: target.role, previousRole }, 'Role updated');
    } catch (err) {
      logger.error('PATCH /users/:id/role failed', { err: err.message, userId: req.user.id });
      return responseError(res, 500, 'Failed to change role', err);
    }
  })
);

/* ---------------------------
   Helper functions used earlier
   --------------------------- */
async function getUserStatistics(userId, role) {
  try {
    const base = { totalOrders: 0, totalSpent: 0, avgOrderValue: 0 };
    if (role === 'customer') {
      const agg = await Order.aggregate([
        { $match: { customer: userId } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalSpent: { $sum: '$total' },
            avgOrderValue: { $avg: '$total' }
          }
        }
      ]);
      if (agg[0]) return { totalOrders: agg[0].totalOrders || 0, totalSpent: agg[0].totalSpent || 0, avgOrderValue: agg[0].avgOrderValue || 0 };
    }
    return base;
  } catch (err) {
    logger.warn('getUserStatistics error', { err: err.message, userId });
    return { totalOrders: 0, totalSpent: 0, avgOrderValue: 0 };
  }
}

async function getUserRecentActivity(userId) {
  try {
    const orders = await Order.find({ customer: userId }).sort({ createdAt: -1 }).limit(5).select('orderNumber status total createdAt').lean();
    return orders.map(o => ({ type: 'order', description: `Order ${o.orderNumber} - ${o.status}`, date: o.createdAt, amount: o.total }));
  } catch (err) {
    logger.warn('getUserRecentActivity error', { err: err.message, userId });
    return [];
  }
}

function calculateProfileCompletion(user = {}) {
  const fields = [
    { key: 'name', weight: 20 },
    { key: 'email', weight: 20 },
    { key: 'phone', weight: 15 },
    { key: 'avatar', weight: 10 },
    { key: 'dateOfBirth', weight: 10 },
    { key: 'gender', weight: 5 },
    { key: 'bio', weight: 10 },
    { key: 'addresses', weight: 10, isArray: true }
  ];
  let score = 0;
  fields.forEach(f => {
    const val = user[f.key];
    const present = f.isArray ? Array.isArray(val) && val.length > 0 : (val !== undefined && val !== null && `${val}`.trim() !== '');
    if (present) score += f.weight;
  });
  return Math.min(100, Math.round(score));
}

function getUserPermissions(role) {
  const map = {
    customer: [Permissions.PROFILE_VIEW_OWN, Permissions.PROFILE_UPDATE_OWN, Permissions.ADDRESS_MANAGE_OWN, Permissions.ORDER_VIEW_OWN],
    seller: [Permissions.PROFILE_VIEW_OWN, Permissions.PROFILE_UPDATE_OWN, Permissions.ADDRESS_MANAGE_OWN, Permissions.ORDER_VIEW_OWN],
    admin: Object.values(Permissions),
    super_admin: Object.values(Permissions)
  };
  return map[role] || map.customer;
}

function canAssignRole(current, target) {
  const hierarchy = {
    super_admin: ['admin', 'regional_manager', 'seller', 'customer', 'moderator', 'delivery_agent', 'support'],
    admin: ['regional_manager', 'seller', 'customer', 'moderator', 'delivery_agent', 'support'],
    regional_manager: ['seller', 'customer', 'delivery_agent']
  };
  return hierarchy[current]?.includes(target) || false;
}

/* ---------------------------
   Export router
   --------------------------- */
module.exports = router;
