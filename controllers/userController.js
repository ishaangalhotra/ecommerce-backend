const User = require('../models/User');
const Address = require('../models/Address');
const Order = require('../models/Order');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/asyncHandlerHandlerHandler');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { createAuditLog } = require('../services/auditService');
const { sendNotification } = require('../services/notificationService');
const { uploadImage, deleteImage } = require('../utils/cloudinary');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const jwt = require('jsonwebtoken');

// Configuration Constants
const USER_CONFIG = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  CACHE_TTL: 300, // 5 minutes
  MAX_ADDRESSES: 5,
  AVATAR_SIZE: { width: 300, height: 300 },
  PASSWORD_MIN_LENGTH: 8,
  PROFILE_COMPLETION_THRESHOLD: 80,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_TIME: 30 * 60 * 1000 // 30 minutes
};

// User roles and permissions
const USER_ROLES = ['customer', 'seller', 'admin', 'moderator', 'delivery_agent'];
const ACCOUNT_STATUSES = ['active', 'suspended', 'locked', 'deactivated'];

/**
 * @desc    Get user profile with comprehensive data
 * @route   GET /api/v1/users/profile
 * @access  Private
 */
exports.getUserProfile = asyncHandler(async (req, res, next) => {
  try {
    // Check cache first with stampede protection
    const cacheKey = `user:profile:${req.user.id}`;
    const cachedProfile = await getCachedDataWithStampedeProtection(cacheKey);
    
    if (cachedProfile) {
      return res.status(200).json(cachedProfile);
    }

    const user = await User.findById(req.user.id)
      .select('-password -refreshToken -loginAttempts -lockUntil')
      .populate({
        path: 'addresses',
        match: { isDeleted: false }
      })
      .lean();

    if (!user) {
      throw new ErrorResponse('User not found', 404);
    }

    // Get user statistics in parallel
    const [stats, recentOrders, favoriteProducts] = await Promise.all([
      getUserStatistics(req.user.id),
      getRecentOrders(req.user.id),
      getFavoriteProducts(req.user.id)
    ]);

    // Calculate profile completion
    const profileCompletion = calculateProfileCompletion(user);

    const response = {
      success: true,
      data: {
        ...user,
        statistics: stats,
        recentOrders,
        favoriteProducts,
        profileCompletion,
        preferences: user.preferences || {},
        notificationSettings: user.notificationSettings || {},
        lastLoginAt: user.lastLoginAt,
        accountStatus: user.accountStatus || 'active',
        isProfileComplete: profileCompletion >= USER_CONFIG.PROFILE_COMPLETION_THRESHOLD,
        metadata: {
          hasPassword: !!user.password,
          hasTwoFactor: !!user.twoFactorSecret
        }
      }
    };

    // Cache the result
    await setCachedData(cacheKey, response, USER_CONFIG.CACHE_TTL);

    logger.info('User profile retrieved', { userId: req.user.id });

    res.status(200).json(response);

  } catch (error) {
    logger.error('Failed to get user profile', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Update user profile with validation
 * @route   PUT /api/v1/users/profile
 * @access  Private
 */
exports.updateUserProfile = asyncHandler(async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(errors.array());
    }

    const {
      name,
      phone,
      dateOfBirth,
      gender,
      bio,
      preferences,
      notificationSettings,
      socialLinks
    } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Track changes for audit log
    const changes = {};
    const previousData = user.toObject();

    // Update allowed fields with validation
    if (name && name !== user.name) {
      changes.name = { from: user.name, to: name };
      user.name = name.trim();
    }

    if (phone && phone !== user.phone) {
      if (!isValidPhoneNumber(phone)) {
        throw new ValidationError([{ msg: 'Invalid phone number format' }]);
      }
      changes.phone = { from: user.phone, to: phone };
      user.phone = phone;
    }

    if (dateOfBirth) {
      const dob = new Date(dateOfBirth);
      if (isNaN(dob.getTime())) {
        throw new ValidationError([{ msg: 'Invalid date format' }]);
      }
      changes.dateOfBirth = { from: user.dateOfBirth, to: dob };
      user.dateOfBirth = dob;
    }

    if (gender && gender !== user.gender) {
      changes.gender = { from: user.gender, to: gender };
      user.gender = gender;
    }

    if (bio && bio !== user.bio) {
      changes.bio = { from: user.bio, to: bio };
      user.bio = bio.trim();
    }

    if (preferences) {
      changes.preferences = { from: user.preferences, to: preferences };
      user.preferences = { ...user.preferences, ...preferences };
    }

    if (notificationSettings) {
      changes.notificationSettings = { 
        from: user.notificationSettings, 
        to: notificationSettings 
      };
      user.notificationSettings = notificationSettings;
    }

    if (socialLinks) {
      const validatedLinks = validateSocialLinks(socialLinks);
      changes.socialLinks = { from: user.socialLinks, to: validatedLinks };
      user.socialLinks = validatedLinks;
    }

    user.updatedAt = new Date();
    await user.save();

    // Create audit log
    await createAuditLog({
      action: 'profile_updated',
      userId: req.user.id,
      targetId: user._id,
      details: {
        changes,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    // Clear cache
    await clearUserCache(req.user.id);

    logger.info('User profile updated', {
      userId: req.user.id,
      changes: Object.keys(changes)
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user.getPublicProfile()
    });

  } catch (error) {
    logger.error('Failed to update user profile', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Upload user avatar
 * @route   POST /api/v1/users/avatar
 * @access  Private
 */
exports.uploadAvatar = asyncHandler(async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ValidationError([{ msg: 'Please upload an image file' }]);
    }

    // Validate image type and size
    if (!req.file.mimetype.startsWith('image')) {
      throw new ValidationError([{ msg: 'Please upload an image file' }]);
    }

    if (req.file.size > 5 * 1024 * 1024) { // 5MB limit
      throw new ValidationError([{ msg: 'Image size must be less than 5MB' }]);
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Delete old avatar if exists
    if (user.avatar) {
      try {
        const publicId = extractPublicIdFromUrl(user.avatar);
        await deleteImage(publicId);
      } catch (error) {
        logger.warn('Failed to delete old avatar', { 
          userId: req.user.id,
          error: error.message 
        });
      }
    }

    // Upload new avatar with transformations
    const uploadResult = await uploadImage(req.file.buffer, {
      folder: `avatars/${req.user.id}`,
      public_id: `avatar_${Date.now()}`,
      transformation: [
        {
          width: USER_CONFIG.AVATAR_SIZE.width,
          height: USER_CONFIG.AVATAR_SIZE.height,
          crop: 'fill',
          gravity: 'faces',
          quality: 'auto:best'
        },
        { format: 'webp' } // Convert to webp for better performance
      ]
    });

    // Update user record
    user.avatar = uploadResult.secure_url;
    user.updatedAt = new Date();
    await user.save();

    // Clear cache
    await clearUserCache(req.user.id);

    logger.info('Avatar uploaded', {
      userId: req.user.id,
      avatarUrl: uploadResult.secure_url
    });

    res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: {
        avatar: uploadResult.secure_url
      }
    });

  } catch (error) {
    logger.error('Failed to upload avatar', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Change user password
 * @route   PUT /api/v1/users/change-password
 * @access  Private
 */
exports.changePassword = asyncHandler(async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword) {
      throw new ValidationError([{ 
        msg: 'Current password and new password are required' 
      }]);
    }

    if (newPassword !== confirmPassword) {
      throw new ValidationError([{ 
        msg: 'New password and confirmation do not match' 
      }]);
    }

    if (newPassword.length < USER_CONFIG.PASSWORD_MIN_LENGTH) {
      throw new ValidationError([{ 
        msg: `Password must be at least ${USER_CONFIG.PASSWORD_MIN_LENGTH} characters long` 
      }]);
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new ValidationError([{ msg: 'Current password is incorrect' }]);
    }

    // Check if new password is same as current
    if (await bcrypt.compare(newPassword, user.password)) {
      throw new ValidationError([{ 
        msg: 'New password must be different from current password' 
      }]);
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(newPassword, salt);
    user.passwordChangedAt = new Date();
    user.updatedAt = new Date();
    await user.save();

    // Invalidate all existing sessions
    await invalidateUserSessions(req.user.id);

    // Create audit log
    await createAuditLog({
      action: 'password_changed',
      userId: req.user.id,
      targetId: user._id,
      details: { 
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    // Send notification
    await sendNotification({
      userId: req.user.id,
      type: 'security',
      title: 'Password Changed',
      message: 'Your password was successfully changed',
      metadata: {
        changedAt: new Date(),
        device: req.headers['user-agent']
      }
    });

    logger.info('Password changed', { userId: req.user.id });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Failed to change password', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Get user addresses
 * @route   GET /api/v1/users/addresses
 * @access  Private
 */
exports.getUserAddresses = asyncHandler(async (req, res, next) => {
  try {
    // Check cache first
    const cacheKey = `user:addresses:${req.user.id}`;
    const cachedAddresses = await getCachedData(cacheKey);
    
    if (cachedAddresses) {
      return res.status(200).json(cachedAddresses);
    }

    const addresses = await Address.find({
      user: req.user.id,
      isDeleted: false
    })
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();

    const response = {
      success: true,
      count: addresses.length,
      data: addresses
    };

    // Cache the result
    await setCachedData(cacheKey, response, USER_CONFIG.CACHE_TTL);

    res.status(200).json(response);

  } catch (error) {
    logger.error('Failed to get user addresses', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Add new address
 * @route   POST /api/v1/users/addresses
 * @access  Private
 */
exports.addAddress = asyncHandler(async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(errors.array());
    }

    // Check address limit
    const addressCount = await Address.countDocuments({
      user: req.user.id,
      isDeleted: false
    });

    if (addressCount >= USER_CONFIG.MAX_ADDRESSES) {
      throw new ValidationError([{ 
        msg: `Maximum ${USER_CONFIG.MAX_ADDRESSES} addresses allowed` 
      }]);
    }

    const addressData = {
      ...req.body,
      user: req.user.id
    };

    // If this is the first address, make it default
    if (addressCount === 0) {
      addressData.isDefault = true;
    }

    // If setting as default, remove default from others
    if (req.body.isDefault) {
      await Address.updateMany(
        { user: req.user.id },
        { isDefault: false }
      );
    }

    const address = await Address.create(addressData);

    // Clear addresses cache
    await clearUserCache(req.user.id, 'addresses');

    // Create audit log
    await createAuditLog({
      action: 'address_added',
      userId: req.user.id,
      targetId: address._id,
      details: {
        addressType: address.type,
        isDefault: address.isDefault
      }
    });

    logger.info('Address added', {
      userId: req.user.id,
      addressId: address._id
    });

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: address
    });

  } catch (error) {
    logger.error('Failed to add address', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Update address
 * @route   PUT /api/v1/users/addresses/:id
 * @access  Private
 */
exports.updateAddress = asyncHandler(async (req, res, next) => {
  try {
    const address = await Address.findOne({
      _id: req.params.id,
      user: req.user.id,
      isDeleted: false
    });

    if (!address) {
      throw new NotFoundError('Address not found');
    }

    // Track changes for audit log
    const changes = {};
    const previousData = address.toObject();

    // Update address fields
    for (const [key, value] of Object.entries(req.body)) {
      if (JSON.stringify(address[key]) !== JSON.stringify(value)) {
        changes[key] = { from: address[key], to: value };
        address[key] = value;
      }
    }

    // If setting as default, remove default from others
    if (req.body.isDefault && !address.isDefault) {
      await Address.updateMany(
        { user: req.user.id, _id: { $ne: address._id } },
        { isDefault: false }
      );
    }

    address.updatedAt = new Date();
    await address.save();

    // Clear addresses cache
    await clearUserCache(req.user.id, 'addresses');

    // Create audit log
    await createAuditLog({
      action: 'address_updated',
      userId: req.user.id,
      targetId: address._id,
      details: {
        changes,
        isDefault: address.isDefault
      }
    });

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: address
    });

  } catch (error) {
    logger.error('Failed to update address', {
      userId: req.user.id,
      addressId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Delete address
 * @route   DELETE /api/v1/users/addresses/:id
 * @access  Private
 */
exports.deleteAddress = asyncHandler(async (req, res, next) => {
  try {
    const address = await Address.findOne({
      _id: req.params.id,
      user: req.user.id,
      isDeleted: false
    });

    if (!address) {
      throw new NotFoundError('Address not found');
    }

    // Check if address is used in any pending orders
    const activeOrder = await Order.findOne({
      'shipping.address': address._id,
      status: { $in: ['pending', 'processing', 'shipped'] }
    });

    if (activeOrder) {
      throw new ValidationError([{ 
        msg: 'Cannot delete address associated with active orders' 
      }]);
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
      }).sort({ createdAt: -1 });

      if (nextAddress) {
        nextAddress.isDefault = true;
        await nextAddress.save();
      }
    }

    // Clear addresses cache
    await clearUserCache(req.user.id, 'addresses');

    // Create audit log
    await createAuditLog({
      action: 'address_deleted',
      userId: req.user.id,
      targetId: address._id,
      details: {
        addressType: address.type,
        wasDefault: address.isDefault
      }
    });

    res.status(200).json({
      success: true,
      message: 'Address deleted successfully'
    });

  } catch (error) {
    logger.error('Failed to delete address', {
      userId: req.user.id,
      addressId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Get user order history
 * @route   GET /api/v1/users/orders
 * @access  Private
 */
exports.getUserOrders = asyncHandler(async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = USER_CONFIG.DEFAULT_PAGE_SIZE,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      startDate,
      endDate
    } = req.query;

    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), USER_CONFIG.MAX_PAGE_SIZE);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = { customer: req.user.id };
    if (status) query.status = { $in: status.split(',') };
    
    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Check cache
    const cacheKey = `user:orders:${req.user.id}:${JSON.stringify(req.query)}`;
    const cachedOrders = await getCachedData(cacheKey);
    
    if (cachedOrders) {
      return res.status(200).json(cachedOrders);
    }

    // Execute queries in parallel
    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('items.product', 'name images price slug')
        .populate('shipping.address', 'name phone address1 city state postalCode')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(query)
    ]);

    const response = {
      success: true,
      count: orders.length,
      total,
      pages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: orders
    };

    // Cache the result
    await setCachedData(cacheKey, response, USER_CONFIG.CACHE_TTL);

    res.status(200).json(response);

  } catch (error) {
    logger.error('Failed to get user orders', {
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Get single order details
 * @route   GET /api/v1/users/orders/:id
 * @access  Private
 */
exports.getOrderDetails = asyncHandler(async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      customer: req.user.id
    })
    .populate('items.product', 'name images price slug description')
    .populate('shipping.address')
    .populate('payment.method')
    .lean();

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Add tracking information if available
    if (order.shipping.trackingNumber) {
      order.shipping.trackingInfo = await getTrackingInfo(order.shipping.trackingNumber);
    }

    res.status(200).json({
      success: true,
      data: order
    });

  } catch (error) {
    logger.error('Failed to get order details', {
      userId: req.user.id,
      orderId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

/**
 * @desc    Delete user account (Admin only)
 * @route   DELETE /api/v1/users/:id
 * @access  Private/Admin
 */
exports.deleteUser = asyncHandler(async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      throw new NotFoundError(`User not found with id ${req.params.id}`);
    }

    // Prevent deletion of admin accounts
    if (user.role === 'admin') {
      throw new ValidationError([{ msg: 'Cannot delete admin accounts' }]);
    }

    // Check for active orders
    const activeOrders = await Order.countDocuments({
      $or: [
        { customer: user._id, status: { $in: ['pending', 'confirmed', 'processing'] }},
        { seller: user._id, status: { $in: ['pending', 'confirmed', 'processing'] }}
      ]
    });

    if (activeOrders > 0) {
      throw new ValidationError([{ 
        msg: 'Cannot delete user with active orders' 
      }]);
    }

    // Soft delete
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = req.user.id;
    user.email = `${user.email}.deleted.${Date.now()}`; // Make email unique
    user.phone = `${user.phone}.deleted.${Date.now()}`; // Make phone unique
    await user.save();

    // Invalidate all sessions
    await invalidateUserSessions(user._id);

    // Create audit log
    await createAuditLog({
      action: 'user_deleted',
      userId: req.user.id,
      targetId: user._id,
      details: { 
        deletedUserEmail: user.email,
        role: user.role,
        accountAge: `${Math.floor((new Date() - user.createdAt) / (1000 * 60 * 60 * 24))} days`
      }
    });

    // Send notification to user if account wasn't deleted by themselves
    if (req.user.id !== user._id.toString()) {
      await sendNotification({
        userId: user._id,
        type: 'account',
        title: 'Account Deleted',
        message: 'Your account has been deleted by an administrator',
        metadata: {
          deletedAt: new Date(),
          deletedBy: req.user.id
        }
      });
    }

    logger.info('User deleted', {
      deletedUserId: user._id,
      deletedBy: req.user.id,
      role: user.role
    });

    res.status(200).json({
      success: true,
      message: 'User account deleted successfully'
    });

  } catch (error) {
    logger.error('Failed to delete user', {
      userId: req.params.id,
      deletedBy: req.user.id,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Get user statistics
 */
const getUserStatistics = async (userId) => {
  try {
    const stats = await Order.aggregate([
      { $match: { customer: userId } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$pricing.total' },
          avgOrderValue: { $avg: '$pricing.total' },
          completedOrders: {
            $sum: {
              $cond: [{ $eq: ['$status', 'completed'] }, 1, 0]
            }
          },
          canceledOrders: {
            $sum: {
              $cond: [{ $eq: ['$status', 'canceled'] }, 1, 0]
            }
          }
        }
      }
    ]);

    return stats[0] || {
      totalOrders: 0,
      totalSpent: 0,
      avgOrderValue: 0,
      completedOrders: 0,
      canceledOrders: 0
    };
  } catch (error) {
    logger.warn('Failed to get user statistics', { 
      userId,
      error: error.message 
    });
    return { 
      totalOrders: 0, 
      totalSpent: 0, 
      avgOrderValue: 0,
      completedOrders: 0,
      canceledOrders: 0
    };
  }
};

/**
 * Get recent orders
 */
const getRecentOrders = async (userId, limit = 3) => {
  try {
    return await Order.find({ customer: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('orderNumber status createdAt pricing.total')
      .lean();
  } catch (error) {
    logger.warn('Failed to get recent orders', { 
      userId,
      error: error.message 
    });
    return [];
  }
};

/**
 * Get favorite products
 */
const getFavoriteProducts = async (userId, limit = 5) => {
  try {
    return await Order.aggregate([
      { $match: { customer: userId } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          count: { $sum: 1 },
          lastPurchased: { $max: '$createdAt' }
        }
      },
      { $sort: { count: -1, lastPurchased: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: 0,
          product: {
            _id: '$product._id',
            name: '$product.name',
            price: '$product.price',
            images: '$product.images',
            slug: '$product.slug'
          },
          purchasedCount: '$count'
        }
      }
    ]);
  } catch (error) {
    logger.warn('Failed to get favorite products', { 
      userId,
      error: error.message 
    });
    return [];
  }
};

/**
 * Calculate profile completion percentage
 */
const calculateProfileCompletion = (user) => {
  const fields = [
    { field: 'name', weight: 20 },
    { field: 'email', weight: 15 },
    { field: 'phone', weight: 15, validate: (val) => isValidPhoneNumber(val) },
    { field: 'avatar', weight: 10 },
    { field: 'dateOfBirth', weight: 10 },
    { field: 'gender', weight: 5 },
    { field: 'addresses', weight: 15, validate: (val) => val && val.length > 0 },
    { field: 'bio', weight: 5 },
    { field: 'preferences', weight: 5, validate: (val) => val && Object.keys(val).length > 0 }
  ];

  let completion = 0;

  fields.forEach(({ field, weight, validate }) => {
    const value = user[field];
    if (validate ? validate(value) : value && value.toString().trim() !== '') {
      completion += weight;
    }
  });

  return Math.min(100, Math.round(completion));
};

/**
 * Validate phone number format
 */
const isValidPhoneNumber = (phone) => {
  const phoneRegex = /^[+]?[1-9][\d\s\-\(\)]{7,15}$/;
  return phoneRegex.test(phone);
};

/**
 * Validate social links
 */
const validateSocialLinks = (links) => {
  const validLinks = {};
  const allowedPlatforms = ['facebook', 'twitter', 'instagram', 'linkedin', 'youtube'];

  for (const [platform, url] of Object.entries(links)) {
    if (allowedPlatforms.includes(platform) {
      try {
        new URL(url); // Validate URL format
        validLinks[platform] = url;
      } catch (e) {
        logger.warn(`Invalid social URL for ${platform}`, { url });
      }
    }
  }

  return validLinks;
};

/**
 * Extract public ID from Cloudinary URL
 */
const extractPublicIdFromUrl = (url) => {
  try {
    const parts = url.split('/');
    const uploadIndex = parts.findIndex(part => part === 'upload');
    return parts.slice(uploadIndex + 2).join('/').split('.')[0];
  } catch (error) {
    logger.warn('Failed to extract public ID from URL', { url, error: error.message });
    return null;
  }
};

/**
 * Invalidate all user sessions
 */
const invalidateUserSessions = async (userId) => {
  try {
    // Invalidate refresh tokens
    await User.findByIdAndUpdate(userId, { 
      $set: { refreshToken: null } 
    });

    // Add to token blacklist (if using JWT)
    const tokenVersionKey = `user:${userId}:tokenVersion`;
    await redis?.incr(tokenVersionKey);
    
    logger.info('User sessions invalidated', { userId });
  } catch (error) {
    logger.error('Failed to invalidate user sessions', { 
      userId,
      error: error.message 
    });
  }
};

/**
 * Get tracking information from shipping provider
 */
const getTrackingInfo = async (trackingNumber) => {
  try {
    // This would integrate with your shipping provider's API
    return {
      status: 'in_transit',
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      events: [
        {
          date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          status: 'shipped',
          location: 'Warehouse',
          description: 'Package has left the warehouse'
        },
        {
          date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          status: 'in_transit',
          location: 'Distribution Center',
          description: 'Package is in transit'
        }
      ]
    };
  } catch (error) {
    logger.warn('Failed to get tracking info', { 
      trackingNumber,
      error: error.message 
    });
    return null;
  }
};

/**
 * Cache management functions with stampede protection
 */
const getCachedDataWithStampedeProtection = async (key) => {
  if (!redis) return null;
  
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
    
    // Set a temporary lock to prevent cache stampede
    const lockKey = `${key}:lock`;
    const lockSet = await redis.set(lockKey, '1', 'EX', 5, 'NX');
    
    if (lockSet) {
      return null; // Current request will generate new data
    }
    
    // Wait for other request to populate cache
    await new Promise(resolve => setTimeout(resolve, 100));
    return getCachedDataWithStampedeProtection(key);
  } catch (error) {
    logger.warn('Cache get failed', { key, error: error.message });
    return null;
  }
};

const setCachedData = async (key, data, ttl) => {
  if (!redis) return;
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
    // Clear the lock if it exists
    await redis.del(`${key}:lock`);
  } catch (error) {
    logger.warn('Cache set failed', { key, error: error.message });
  }
};

const clearUserCache = async (userId, type = null) => {
  if (!redis) return;
  try {
    const pattern = type 
      ? `user:${type}:${userId}*`
      : `user:*:${userId}*`;
    
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (error) {
    logger.warn('Cache clear failed', { userId, error: error.message });
  }
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  uploadAvatar,
  changePassword,
  getUserAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  getUserOrders,
  getOrderDetails,
  deleteUser
};