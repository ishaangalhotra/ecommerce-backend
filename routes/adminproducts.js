const express = require('express');
const { query, body, param } = require('express-validator');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { protect, restrictTo } = require('../middleware/authMiddleware');
const asyncHandler = require('../middleware/asyncHandler');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');
const redis = require('../utils/redis');
const { clearCache } = require('../middleware/cache');
const { sendNotification } = require('../services/notificationService');

const router = express.Router();

// Constants
const PRODUCT_STATUSES = ['active', 'inactive', 'pending', 'rejected', 'archived'];
const MAX_SEARCH_LENGTH = 100;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

// 🔐 Secure all admin product routes
router.use(protect);
router.use(restrictTo('admin'));

// Redis-backed rate limiter for admin product routes
const adminProductLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `admin:${req.user.id}:products`,
  store: new rateLimit.RedisStore({
    client: redis,
    prefix: 'ratelimit:adminProducts'
  }),
  handler: (req, res) => {
    logger.warn('Admin product rate limit exceeded', {
      userId: req.user.id,
      path: req.path,
      ip: req.ip
    });
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please wait and try again.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

router.use(adminProductLimiter);

// Centralized validation handler
const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.debug('Validation failed', {
        path: req.path,
        userId: req.user.id,
        errors: errors.array(),
        body: req.body,
        query: req.query
      });
      return res.status(400).json({
        success: false,
        errors: errors.array().map(err => ({
          param: err.param,
          message: err.msg,
          value: err.value
        }))
      });
    }
    next();
  }
];

/**
 * @route   GET /api/admin/products
 * @desc    Get paginated, filterable, searchable list of products with advanced options
 * @access  Admin
 * @params  page, limit, search, category, status, minPrice, maxPrice, sort
 * @returns {Products[], pagination}
 */
router.get(
  '/',
  validate([
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: MAX_PAGE_SIZE }).toInt(),
    query('search').optional().trim().isLength({ max: MAX_SEARCH_LENGTH }),
    query('category').optional().isMongoId().withMessage('Invalid category ID'),
    query('status').optional().isIn(PRODUCT_STATUSES),
    query('minPrice').optional().isFloat({ min: 0 }).toFloat(),
    query('maxPrice').optional().isFloat({ min: 0 }).toFloat(),
    query('sort').optional().isIn([
      'newest', 'oldest', 
      'price_asc', 'price_desc',
      'popular', 'name_asc', 'name_desc'
    ])
  ]),
  asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = DEFAULT_PAGE_SIZE, 
      search = '', 
      category, 
      status,
      minPrice,
      maxPrice,
      sort = 'newest'
    } = req.query;
    
    const query = {};
    const populateOptions = [
      { path: 'seller', select: 'name email' },
      { path: 'category', select: 'name slug' }
    ];

    // Search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } }
      ];
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Price range filter
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = minPrice;
      if (maxPrice) query.price.$lte = maxPrice;
    }

    // Sorting options
    let sortOption = { createdAt: -1 }; // Default: newest first
    switch (sort) {
      case 'oldest':
        sortOption = { createdAt: 1 };
        break;
      case 'price_asc':
        sortOption = { price: 1 };
        break;
      case 'price_desc':
        sortOption = { price: -1 };
        break;
      case 'popular':
        sortOption = { salesCount: -1 };
        break;
      case 'name_asc':
        sortOption = { name: 1 };
        break;
      case 'name_desc':
        sortOption = { name: -1 };
        break;
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate(populateOptions)
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Product.countDocuments(query)
    ]);

    // Add category tree for each product
    if (category) {
      const categoryTree = await Category.getAncestors(category);
      products.forEach(product => {
        product.categoryTree = categoryTree;
      });
    }

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: Number(page),
      data: products
    });
  })
);

/**
 * @route   GET /api/admin/products/:id
 * @desc    Get detailed product information including audit history
 * @access  Admin
 * @returns {Product}
 */
router.get(
  '/:id',
  validate([
    param('id').isMongoId().withMessage('Invalid product ID')
  ]),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id)
      .populate('seller', 'name email')
      .populate('category', 'name slug')
      .populate('reviews.user', 'name avatar')
      .populate({
        path: 'auditLog.user',
        select: 'name role'
      });

    if (!product) {
      logger.warn('Product not found', { productId: req.params.id });
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.status(200).json({
      success: true,
      data: product
    });
  })
);

/**
 * @route   PATCH /api/admin/products/:id/status
 * @desc    Update product status with audit logging
 * @access  Admin
 * @returns {Product}
 */
router.patch(
  '/:id/status',
  validate([
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('status')
      .isIn(PRODUCT_STATUSES)
      .withMessage('Invalid status value'),
    body('reason')
      .if(body('status').equals('rejected'))
      .notEmpty()
      .withMessage('Reason is required for rejection')
      .optional()
      .isString()
      .trim()
      .escape()
  ]),
  clearCache(['products']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body;
    const { id: adminId } = req.user;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const previousStatus = product.status;
    product.status = status;

    // Add to audit log
    product.auditLog.push({
      action: 'status_change',
      user: adminId,
      previousStatus,
      newStatus: status,
      reason,
      changedAt: new Date()
    });

    await product.save();

    // Send notification to seller if status changed
    if (previousStatus !== status) {
      await sendNotification({
        userId: product.seller,
        title: 'Product Status Changed',
        message: `Your product "${product.name}" status changed from ${previousStatus} to ${status}`,
        type: 'product_update',
        metadata: { productId: product._id }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Product status updated successfully',
      data: {
        _id: product._id,
        name: product.name,
        status: product.status,
        previousStatus
      }
    });
  })
);

/**
 * @route   PUT /api/admin/products/:id
 * @desc    Update product details (admin override)
 * @access  Admin
 * @returns {Product}
 */
router.put(
  '/:id',
  validate([
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('name').optional().isString().trim().isLength({ min: 3, max: 100 }),
    body('description').optional().isString().trim().isLength({ max: 5000 }),
    body('price').optional().isFloat({ min: 0 }).toFloat(),
    body('stock').optional().isInt({ min: 0 }).toInt(),
    body('category').optional().isMongoId().withMessage('Invalid category ID'),
    body('images').optional().isArray(),
    body('images.*').optional().isURL(),
    body('tags').optional().isArray(),
    body('tags.*').optional().isString().trim().escape(),
    body('specifications').optional().isArray(),
    body('isFeatured').optional().isBoolean()
  ]),
  clearCache(['products']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const { id: adminId } = req.user;

    // Get product before update for audit logging
    const originalProduct = await Product.findById(id);
    if (!originalProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Prepare update with audit log
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      {
        ...updateData,
        $push: {
          auditLog: {
            action: 'admin_edit',
            user: adminId,
            changes: Object.keys(updateData),
            changedAt: new Date()
          }
        }
      },
      { new: true, runValidators: true }
    ).populate('seller', 'name email');

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct
    });
  })
);

/**
 * @route   DELETE /api/admin/products/:id
 * @desc    Archive a product (soft delete)
 * @access  Admin
 * @returns {message}
 */
router.delete(
  '/:id',
  validate([
    param('id').isMongoId().withMessage('Invalid product ID')
  ]),
  clearCache(['products']),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { id: adminId } = req.user;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (product.status === 'archived') {
      return res.status(400).json({
        success: false,
        message: 'Product is already archived'
      });
    }

    // Soft delete by setting status to archived
    product.status = 'archived';
    product.auditLog.push({
      action: 'archived',
      user: adminId,
      changedAt: new Date()
    });
    await product.save();

    // Notify seller
    await sendNotification({
      userId: product.seller,
      title: 'Product Archived',
      message: `Your product "${product.name}" has been archived by admin`,
      type: 'product_update',
      metadata: { productId: product._id }
    });

    res.status(200).json({
      success: true,
      message: 'Product has been archived',
      data: {
        _id: product._id,
        name: product.name,
        status: product.status
      }
    });
  })
);

module.exports = router;