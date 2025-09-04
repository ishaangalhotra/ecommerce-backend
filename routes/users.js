const express = require('express');
const bcrypt = require('bcryptjs');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const fs = require('fs'); // ✅ Added fs import
const sharp = require('sharp');
const User = require('../models/User');
const Address = require('../models/Address');
const Order = require('../models/Order');
const { protect, authorize, checkPermission } = require('../middleware/authMiddleware');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const { sendEmail } = require('../utils/email');
const { generateToken } = require('../utils/auth');
const logger = require('../utils/logger');
const redis = require('../config/redis');
// // const { io } = require');

const router = express.Router();

// User role hierarchy as per marketplace best practices
const UserRoles = {
  SUPER_ADMIN: 'super_admin',     // Account Owner
  ADMIN: 'admin',                 // Administrator  
  REGIONAL_MANAGER: 'regional_manager',
  SELLER: 'seller',               // Marketplace Seller
  CUSTOMER: 'customer',           // Buyer/Consumer
  MODERATOR: 'moderator',         // Content Moderator
  DELIVERY_AGENT: 'delivery_agent',
  SUPPORT: 'support'              // Customer Support
};

// Permission levels for RBAC implementation
const Permissions = {
  // User Management
  USER_VIEW_ALL: 'user:view:all',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_MANAGE_ROLES: 'user:manage:roles',
  
  // Profile Management  
  PROFILE_VIEW_OWN: 'profile:view:own',
  PROFILE_UPDATE_OWN: 'profile:update:own',
  PROFILE_VIEW_ALL: 'profile:view:all',
  
  // Address Management
  ADDRESS_MANAGE_OWN: 'address:manage:own',
  ADDRESS_VIEW_ALL: 'address:view:all',
  
  // Order Access
  ORDER_VIEW_OWN: 'order:view:own',
  ORDER_VIEW_ALL: 'order:view:all'
};

// Enhanced rate limiting
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => `user:${req.ip}:${req.user?.id || 'guest'}`,
  handler: (req, res) => {
    logger.warn(`User route rate limit exceeded for ${req.ip}`);
    res.status(429).json({ 
      success: false, 
      error: 'Too many requests, please try again later' 
    });
  }
});

const profileUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 profile updates per hour
  message: { error: 'Too many profile updates, please try again later' }
});

// Avatar upload configuration - ✅ Using disk storage utility
const upload = require('../utils/multer'); // ✅ diskStorage

// Validation middleware
const validateUserUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be 2-50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  
  body('phone')
    .optional()
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format')
    .custom(value => {
      const age = (new Date() - new Date(value)) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 13) throw new Error('Must be at least 13 years old');
      if (age > 120) throw new Error('Invalid birth date');
      return true;
    }),
  
  body('gender')
    .optional()
    .isIn(['male', 'female', 'other', 'prefer_not_to_say'])
    .withMessage('Invalid gender value'),
  
  body('preferences')
    .optional()
    .isObject()
    .withMessage('Preferences must be an object'),
  
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio must be under 500 characters')
];

const validateAddressData = [
  body('type')
    .isIn(['home', 'work', 'other'])
    .withMessage('Address type must be home, work, or other'),
  
  body('street')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Street address must be 5-200 characters'),
  
  body('city')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('City must be 2-50 characters'),
  
  body('state')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('State must be 2-50 characters'),
  
  body('pincode')
    .matches(/^[1-9][0-9]{5}$/)
    .withMessage('Invalid pincode format'),
  
  body('landmark')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Landmark must be under 100 characters'),
  
  body('coordinates')
    .optional()
    .isArray({ min: 2, max: 2 })
    .withMessage('Coordinates must be [longitude, latitude]')
];

// ==================== PROFILE MANAGEMENT ROUTES ====================

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get current user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data
 */
router.get('/profile',
  protect,
  checkPermission(Permissions.PROFILE_VIEW_OWN),
  userLimiter,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id)
        .select('-password -refreshToken')
        .populate('addresses')
        .lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Get user statistics
      const stats = await getUserStatistics(req.user.id, user.role);

      // Get recent activity
      const recentActivity = await getUserRecentActivity(req.user.id);

      // Calculate profile completion
      const profileCompletion = calculateProfileCompletion(user);

      res.json({
        success: true,
        user: {
          ...user,
          stats,
          recentActivity,
          profileCompletion,
          permissions: await getUserPermissions(user.role),
          lastActiveAt: new Date()
        }
      });

    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving profile'
      });
    }
  }
);

/**
 * @swagger
 * /users/profile:
 *   patch:
 *     summary: Update current user's profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *                 enum: [male, female, other, prefer_not_to_say]
 *               bio:
 *                 type: string
 *               preferences:
 *                 type: object
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.patch('/profile',
  protect,
  checkPermission(Permissions.PROFILE_UPDATE_OWN),
  profileUpdateLimiter,
  validateUserUpdate,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const allowedFields = [
        'name', 'phone', 'dateOfBirth', 'gender', 'bio', 'preferences'
      ];

      const updateData = {};
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      });

      // Email updates require verification
      if (req.body.email && req.body.email !== req.user.email) {
        updateData.pendingEmail = req.body.email;
        updateData.isEmailVerified = false;
        
        // Send email verification
        const verificationToken = generateToken(req.user.id);
        await sendEmail({
          to: req.body.email,
          subject: 'Verify Your New Email Address',
          template: 'email-change-verification',
          data: {
            name: req.user.name,
            verificationUrl: `${process.env.CLIENT_URL}/verify-email-change/${verificationToken}`
          }
        });
      }

      updateData.updatedAt = new Date();

      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        updateData,
        { new: true, runValidators: true }
      ).select('-password -refreshToken');

      // Emit real-time event
      io.to(`user-${req.user.id}`).emit('profile-updated', {
        userId: req.user.id,
        updatedFields: Object.keys(updateData)
      });

      logger.info(`Profile updated`, {
        userId: req.user.id,
        updatedFields: Object.keys(updateData)
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: updatedUser,
        emailVerificationRequired: !!req.body.email
      });

    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating profile'
      });
    }
  }
);

/**
 * @swagger
 * /users/avatar:
 *   post:
 *     summary: Upload user avatar
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 */
router.post('/avatar',
  protect,
  checkPermission(Permissions.PROFILE_UPDATE_OWN),
  profileUpdateLimiter,
  upload.single('avatar'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Avatar image is required'
        });
      }

      // ✅ Process and optimize image from disk path instead of buffer
      const optimizedImage = await sharp(req.file.path)
        .resize(300, 300, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      // Upload to Cloudinary
      const uploadResult = await uploadToCloudinary(optimizedImage, {
        folder: `quicklocal/avatars/${req.user.id}`,
        public_id: `avatar_${Date.now()}`,
        transformation: [
          { width: 300, height: 300, crop: 'fill', gravity: 'faces' },
          { quality: 'auto:good' },
          { fetch_format: 'auto' }
        ]
      });

      // Delete old avatar if exists
      const user = await User.findById(req.user.id);
      if (user.avatar) {
        try {
          const publicId = extractPublicIdFromUrl(user.avatar);
          await deleteFromCloudinary(publicId);
        } catch (deleteError) {
          logger.warn('Failed to delete old avatar:', deleteError);
        }
      }

      // Update user avatar
      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        { 
          avatar: uploadResult.secure_url,
          updatedAt: new Date()
        },
        { new: true }
      ).select('-password -refreshToken');

      // ✅ Delete temporary file after successful upload
      try { 
        if (req.file && req.file.path) {
          await fs.promises.unlink(req.file.path); 
        }
      } catch (e) {
        logger.warn('Failed to delete temp file:', e);
      }

      logger.info(`Avatar updated`, {
        userId: req.user.id,
        avatarUrl: uploadResult.secure_url
      });

      res.json({
        success: true,
        message: 'Avatar updated successfully',
        avatar: uploadResult.secure_url,
        user: updatedUser
      });

    } catch (error) {
      // ✅ Delete temporary file on error
      try { 
        if (req.file && req.file.path) {
          await fs.promises.unlink(req.file.path); 
        }
      } catch (e) {
        logger.warn('Failed to delete temp file on error:', e);
      }

      logger.error('Upload avatar error:', error);
      res.status(500).json({
        success: false,
        message: 'Error uploading avatar'
      });
    }
  }
);

// ==================== ADDRESS MANAGEMENT ====================

/**
 * @swagger
 * /users/addresses:
 *   get:
 *     summary: Get user's addresses
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user addresses
 */
router.get('/addresses',
  protect,
  checkPermission(Permissions.ADDRESS_MANAGE_OWN),
  userLimiter,
  async (req, res) => {
    try {
      const addresses = await Address.find({ 
        user: req.user.id,
        isDeleted: false 
      }).sort({ isDefault: -1, createdAt: -1 });

      res.json({
        success: true,
        addresses,
        count: addresses.length
      });

    } catch (error) {
      logger.error('Get addresses error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving addresses'
      });
    }
  }
);

/**
 * @swagger
 * /users/addresses:
 *   post:
 *     summary: Add new address
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - street
 *               - city
 *               - state
 *               - pincode
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [home, work, other]
 *               street:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               pincode:
 *                 type: string
 *               landmark:
 *                 type: string
 *               coordinates:
 *                 type: array
 *                 items:
 *                   type: number
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Address added successfully
 */
router.post('/addresses',
  protect,
  checkPermission(Permissions.ADDRESS_MANAGE_OWN),
  profileUpdateLimiter,
  validateAddressData,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      // Check address limit (max 5 addresses per user)
      const addressCount = await Address.countDocuments({ 
        user: req.user.id, 
        isDeleted: false 
      });

      if (addressCount >= 5) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 5 addresses allowed per user'
        });
      }

      const addressData = {
        ...req.body,
        user: req.user.id
      };

      // If this is the first address or explicitly set as default
      if (addressCount === 0 || req.body.isDefault) {
        // Remove default from other addresses
        if (req.body.isDefault) {
          await Address.updateMany(
            { user: req.user.id },
            { isDefault: false }
          );
        }
        addressData.isDefault = true;
      }

      const address = await Address.create(addressData);

      logger.info(`Address added`, {
        userId: req.user.id,
        addressId: address._id,
        type: address.type
      });

      res.status(201).json({
        success: true,
        message: 'Address added successfully',
        address
      });

    } catch (error) {
      logger.error('Add address error:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding address'
      });
    }
  }
);

/**
 * @swagger
 * /users/addresses/{id}:
 *   patch:
 *     summary: Update address
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Address updated successfully
 */
router.patch('/addresses/:id',
  protect,
  checkPermission(Permissions.ADDRESS_MANAGE_OWN),
  profileUpdateLimiter,
  validateAddressData,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const address = await Address.findOne({
        _id: req.params.id,
        user: req.user.id,
        isDeleted: false
      });

      if (!address) {
        return res.status(404).json({
          success: false,
          message: 'Address not found'
        });
      }

      // Handle default address change
      if (req.body.isDefault && !address.isDefault) {
        await Address.updateMany(
          { user: req.user.id },
          { isDefault: false }
        );
      }

      const updatedAddress = await Address.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updatedAt: new Date() },
        { new: true, runValidators: true }
      );

      logger.info(`Address updated`, {
        userId: req.user.id,
        addressId: address._id
      });

      res.json({
        success: true,
        message: 'Address updated successfully',
        address: updatedAddress
      });

    } catch (error) {
      logger.error('Update address error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating address'
      });
    }
  }
);

/**
 * @swagger
 * /users/addresses/{id}:
 *   delete:
 *     summary: Delete address
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Address deleted successfully
 */
router.delete('/addresses/:id',
  protect,
  checkPermission(Permissions.ADDRESS_MANAGE_OWN),
  userLimiter,
  async (req, res) => {
    try {
      const address = await Address.findOne({
        _id: req.params.id,
        user: req.user.id,
        isDeleted: false
      });

      if (!address) {
        return res.status(404).json({
          success: false,
          message: 'Address not found'
        });
      }

      // Soft delete
      address.isDeleted = true;
      address.deletedAt = new Date();
      await address.save();

      // If this was the default address, make another one default
      if (address.isDefault) {
        const nextAddress = await Address.findOne({
          user: req.user.id,
          isDeleted: false,
          _id: { $ne: address._id }
        });

        if (nextAddress) {
          nextAddress.isDefault = true;
          await nextAddress.save();
        }
      }

      logger.info(`Address deleted`, {
        userId: req.user.id,
        addressId: address._id
      });

      res.json({
        success: true,
        message: 'Address deleted successfully'
      });

    } catch (error) {
      logger.error('Delete address error:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting address'
      });
    }
  }
);

// ==================== USER MANAGEMENT (ADMIN ROUTES) ====================

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users (Admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, suspended]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of users
 */
router.get('/',
  protect,
  authorize('admin', 'super_admin'),
  checkPermission(Permissions.USER_VIEW_ALL),
  userLimiter,
  [
    query('page')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Page must be 1-1000')
      .toInt(),
    
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be 1-100')
      .toInt(),
    
    query('role')
      .optional()
      .isIn(Object.values(UserRoles))
      .withMessage('Invalid role filter'),
    
    query('status')
      .optional()
      .isIn(['active', 'inactive', 'suspended'])
      .withMessage('Invalid status filter')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const {
        page = 1,
        limit = 20,
        role,
        status,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // Build query
      const query = {};

      if (role) query.role = role;
      if (status) query.status = status;
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ];
      }

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      const [users, totalUsers, userStats] = await Promise.all([
        User.find(query)
          .select('-password -refreshToken')
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        
        User.countDocuments(query),
        
        // Get user statistics
        User.aggregate([
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
              roleDistribution: {
                $push: '$role'
              }
            }
          }
        ])
      ]);

      // Process role distribution
      const roleStats = {};
      if (userStats[0]?.roleDistribution) {
        userStats[0].roleDistribution.forEach(role => {
          roleStats[role] = (roleStats[role] || 0) + 1;
        });
      }

      res.json({
        success: true,
        users,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalUsers / limit),
          totalUsers,
          hasNext: page * limit < totalUsers,
          hasPrev: page > 1
        },
        stats: {
          ...userStats[0],
          roleDistribution: roleStats
        }
      });

    } catch (error) {
      logger.error('Get users error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving users'
      });
    }
  }
);

/**
 * @swagger
 * /users/{id}/role:
 *   patch:
 *     summary: Update user role (Admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [super_admin, admin, regional_manager, seller, customer, moderator, delivery_agent, support]
 *     responses:
 *       200:
 *         description: User role updated successfully
 */
router.patch('/:id/role',
  protect,
  authorize('admin', 'super_admin'),
  checkPermission(Permissions.USER_MANAGE_ROLES),
  [
    body('role')
      .isIn(Object.values(UserRoles))
      .withMessage('Invalid role specified')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { role } = req.body;
      const targetUserId = req.params.id;

      // Prevent self-role modification for security
      if (targetUserId === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot modify your own role'
        });
      }

      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Role hierarchy validation
      if (!canAssignRole(req.user.role, role)) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to assign this role'
        });
      }

      const previousRole = targetUser.role;
      targetUser.role = role;
      targetUser.roleChangedAt = new Date();
      targetUser.roleChangedBy = req.user.id;
      await targetUser.save();

      // Send notification to user
      await sendEmail({
        to: targetUser.email,
        subject: 'Role Updated - QuickLocal',
        template: 'role-updated',
        data: {
          name: targetUser.name,
          previousRole,
          newRole: role,
          updatedBy: req.user.name
        }
      });

      logger.info(`User role updated`, {
        targetUserId,
        previousRole,
        newRole: role,
        updatedBy: req.user.id
      });

      res.json({
        success: true,
        message: 'User role updated successfully',
        user: {
          id: targetUser._id,
          name: targetUser.name,
          email: targetUser.email,
          role: targetUser.role,
          previousRole
        }
      });

    } catch (error) {
      logger.error('Update user role error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating user role'
      });
    }
  }
);

//