const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  uploadProduct,
  getMyProducts,
  updateProduct,
  deleteProduct,
  getSellerDashboard,
  getProductAnalytics,
  bulkUpdateProducts,
  exportProducts
} = require('../controllers/sellerController');
const upload = require('../utils/fileUpload');
const { body, param, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { validateProductOwnership } = require('../middleware/productMiddleware');
const { cacheMiddleware } = require('../middleware/cache');
const { validateFileType } = require('../middleware/fileValidation');

const router = express.Router();

// Enhanced rate limiting with Redis and dynamic window adjustment
const createRateLimiter = (windowMs, max, keyPrefix) => {
  return rateLimit({
    windowMs,
    max,
    store: new rateLimit.RedisStore({
      client: redis,
      prefix: `rate_limit:seller:${keyPrefix}`
    }),
    keyGenerator: (req) => {
      // Differentiate between different types of requests
      const type = req.method === 'GET' ? 'read' : 'write';
      return `${req.user.id}:${type}:${req.path}`;
    },
    handler: (req, res) => {
      const retryAfter = Math.ceil(windowMs / 1000);
      logger.warn(`Rate limit exceeded for seller ${req.user.id} on ${req.path}`, {
        method: req.method,
        ip: req.ip
      });
      res.set('Retry-After', retryAfter);
      res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        retryAfter,
        documentation: 'https://api.yourdomain.com/docs/rate-limits'
      });
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for admin users
      return req.user.role === 'admin';
    }
  });
};

// Rate limiters with different tiers
const uploadLimiter = createRateLimiter(10 * 60 * 1000, 20, 'upload');
const productUpdateLimiter = createRateLimiter(15 * 60 * 1000, 30, 'update');
const dashboardLimiter = createRateLimiter(60 * 1000, 60, 'dashboard');
const exportLimiter = createRateLimiter(60 * 60 * 1000, 5, 'export');

// Enhanced validation with custom validators and sanitizers
const validateRequest = (validations) => [
  ...validations,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const formattedErrors = errors.array().map(err => ({
        field: err.param,
        message: err.msg,
        location: err.location,
        value: err.value
      }));

      logger.debug('Validation failed', {
        path: req.path,
        user: req.user.id,
        errors: formattedErrors
      });

      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: formattedErrors,
        documentation: 'https://api.yourdomain.com/docs/validation'
      });
    }
    next();
  }
];

// Enhanced request logger with performance tracking
const requestLogger = (action) => {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('Seller API Request', {
        action,
        method: req.method,
        path: req.path,
        sellerId: req.user.id,
        ip: req.ip,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.get('User-Agent')
      });
    });
    next();
  };
};

// 🔒 Protect ALL seller routes & require seller role
router.use(protect);
router.use(authorize('seller', 'admin'));

/**
 * @swagger
 * tags:
 *   name: Seller
 *   description: Seller product management and analytics
 */

/**
 * @swagger
 * /api/v2/seller/dashboard:
 *   get:
 *     summary: Get seller dashboard analytics
 *     tags: [Seller]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/timeRange'
 *       - $ref: '#/components/parameters/metrics'
 *     responses:
 *       200:
 *         description: Sales, orders, and product statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SellerDashboard'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get(
  '/dashboard',
  dashboardLimiter,
  validateRequest([
    query('timeRange')
      .optional()
      .isIn(['24h', '7d', '30d', '90d', 'custom'])
      .withMessage('Invalid time range'),
    query('metrics')
      .optional()
      .isArray()
      .withMessage('Metrics should be an array')
  ]),
  requestLogger('get_dashboard'),
  cacheMiddleware('5 minutes'),
  getSellerDashboard
);

/**
 * @swagger
 * /api/v2/seller/analytics/{productId}:
 *   get:
 *     summary: Get analytics for a specific product
 *     tags: [Seller]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/productId'
 *       - $ref: '#/components/parameters/timeRange'
 *       - $ref: '#/components/parameters/breakdown'
 *     responses:
 *       200:
 *         description: Product analytics data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductAnalytics'
 */
router.get(
  '/analytics/:productId',
  validateRequest([
    param('productId').isMongoId().withMessage('Invalid product ID'),
    query('timeRange')
      .optional()
      .isIn(['24h', '7d', '30d', '90d', 'all'])
      .withMessage('Invalid time range'),
    query('breakdown')
      .optional()
      .isIn(['daily', 'weekly', 'monthly'])
      .withMessage('Invalid breakdown period')
  ]),
  requestLogger('get_product_analytics'),
  validateProductOwnership,
  getProductAnalytics
);

/**
 * @swagger
 * /api/v2/seller/products:
 *   get:
 *     summary: Get seller's products with advanced filtering
 *     tags: [Seller]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/statusFilter'
 *       - $ref: '#/components/parameters/categoryFilter'
 *       - $ref: '#/components/parameters/priceRange'
 *       - $ref: '#/components/parameters/stockRange'
 *       - $ref: '#/components/parameters/sortBy'
 *       - $ref: '#/components/parameters/paginationPage'
 *       - $ref: '#/components/parameters/paginationLimit'
 *     responses:
 *       200:
 *         description: List of seller's products
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SellerProductsResponse'
 */
router.get(
  '/products',
  validateRequest([
    query('status')
      .optional()
      .isIn(['active', 'draft', 'out_of_stock', 'archived', 'all'])
      .withMessage('Invalid status filter'),
    query('category')
      .optional()
      .trim()
      .isLength({ max: 50 })
      .withMessage('Category filter too long'),
    query('minPrice')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Minimum price must be positive')
      .toFloat(),
    query('maxPrice')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Maximum price must be positive')
      .toFloat(),
    query('minStock')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Minimum stock must be positive')
      .toInt(),
    query('maxStock')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Maximum stock must be positive')
      .toInt(),
    query('sortBy')
      .optional()
      .isIn(['name', 'price', 'stock', 'createdAt', 'updatedAt', 'sales'])
      .withMessage('Invalid sort field'),
    query('sortOrder')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('Invalid sort order'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 200 })
      .withMessage('Limit must be between 1-200')
      .toInt(),
    query('search')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Search query too long')
  ]),
  requestLogger('get_products'),
  getMyProducts
);

/**
 * @swagger
 * /api/v2/seller/products/export:
 *   get:
 *     summary: Export products in various formats
 *     tags: [Seller]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/format'
 *       - $ref: '#/components/parameters/fields'
 *     responses:
 *       200:
 *         description: Products exported successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductExportResponse'
 *           text/csv:
 *             schema:
 *               type: string
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get(
  '/products/export',
  exportLimiter,
  validateRequest([
    query('format')
      .optional()
      .isIn(['json', 'csv', 'excel'])
      .withMessage('Invalid export format'),
    query('fields')
      .optional()
      .isArray()
      .withMessage('Fields should be an array')
  ]),
  requestLogger('export_products'),
  exportProducts
);

/**
 * @swagger
 * /api/v2/seller/products:
 *   post:
 *     summary: Create a new product
 *     tags: [Seller]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/ProductCreateRequest'
 *     responses:
 *       201:
 *         description: Product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       413:
 *         $ref: '#/components/responses/FileTooLargeError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.post(
  '/products',
  uploadLimiter,
  upload.array('images', 10),
  validateFileType(['image/jpeg', 'image/png', 'image/webp']),
  validateRequest([
    body('name')
      .notEmpty()
      .withMessage('Product name is required')
      .trim()
      .isLength({ max: 100 })
      .withMessage('Name must be less than 100 characters')
      .escape(),
    body('description')
      .optional()
      .trim()
      .isLength({ max: 5000 })
      .withMessage('Description too long')
      .escape(),
    body('price')
      .isFloat({ min: 0.01, max: 1000000 })
      .withMessage('Price must be between ₹0.01 - ₹1,000,000')
      .toFloat(),
    body('comparePrice')
      .optional()
      .isFloat({ min: 0.01 })
      .withMessage('Compare price must be positive')
      .toFloat()
      .custom((value, { req }) => {
        if (value && value <= req.body.price) {
          throw new Error('Compare price must be greater than price');
        }
        return true;
      }),
    body('costPerItem')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Cost must be positive')
      .toFloat(),
    body('stock')
      .isInt({ min: 0, max: 100000 })
      .withMessage('Stock must be between 0-100,000')
      .toInt(),
    body('category')
      .notEmpty()
      .withMessage('Category is required')
      .trim()
      .isLength({ max: 50 })
      .withMessage('Category too long')
      .escape(),
    body('tags')
      .optional()
      .isArray({ max: 20 })
      .withMessage('Maximum 20 tags allowed'),
    body('tags.*')
      .trim()
      .isLength({ max: 30 })
      .withMessage('Tag too long (max 30 chars)'),
    body('isPublished')
      .optional()
      .isBoolean()
      .withMessage('Invalid published status')
      .toBoolean(),
    body('variants')
      .optional()
      .isArray()
      .withMessage('Variants must be an array'),
    body('shipping.weight')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Weight must be positive')
      .toFloat(),
    body('shipping.dimensions.length')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Length must be positive')
      .toFloat(),
    body('shipping.dimensions.width')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Width must be positive')
      .toFloat(),
    body('shipping.dimensions.height')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Height must be positive')
      .toFloat()
  ]),
  requestLogger('create_product'),
  uploadProduct
);

/**
 * @swagger
 * /api/v2/seller/products/bulk:
 *   patch:
 *     summary: Bulk update products
 *     tags: [Seller]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BulkProductUpdateRequest'
 *     responses:
 *       200:
 *         description: Products updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BulkProductUpdateResponse'
 */
router.patch(
  '/products/bulk',
  productUpdateLimiter,
  validateRequest([
    body('productIds')
      .isArray({ min: 1, max: 100 })
      .withMessage('Must provide 1-100 product IDs'),
    body('productIds.*')
      .isMongoId()
      .withMessage('Invalid product ID format'),
    body('updateData')
      .isObject()
      .withMessage('Update data must be an object'),
    body('updateData.price')
      .optional()
      .isFloat({ min: 0.01 })
      .withMessage('Price must be positive'),
    body('updateData.stock')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Stock must be 0 or more'),
    body('updateData.status')
      .optional()
      .isIn(['active', 'draft', 'archived'])
      .withMessage('Invalid status')
  ]),
  requestLogger('bulk_update_products'),
  bulkUpdateProducts
);

/**
 * @swagger
 * /api/v2/seller/products/{productId}:
 *   put:
 *     summary: Update a product
 *     tags: [Seller]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/productId'
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/ProductUpdateRequest'
 *     responses:
 *       200:
 *         description: Product updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductResponse'
 *   delete:
 *     summary: Delete a product
 *     tags: [Seller]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/productId'
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.route('/products/:productId')
  .put(
    productUpdateLimiter,
    upload.array('images', 10),
    validateFileType(['image/jpeg', 'image/png', 'image/webp']),
    validateRequest([
      param('productId')
        .isMongoId()
        .withMessage('Invalid product ID'),
      body('name')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Name too long')
        .escape(),
      body('description')
        .optional()
        .trim()
        .isLength({ max: 5000 })
        .withMessage('Description too long')
        .escape(),
      body('price')
        .optional()
        .isFloat({ min: 0.01, max: 1000000 })
        .withMessage('Invalid price range')
        .toFloat(),
      body('comparePrice')
        .optional()
        .isFloat({ min: 0.01 })
        .withMessage('Compare price must be positive')
        .toFloat(),
      body('stock')
        .optional()
        .isInt({ min: 0, max: 100000 })
        .withMessage('Stock must be between 0-100,000')
        .toInt(),
      body('status')
        .optional()
        .isIn(['active', 'draft', 'archived'])
        .withMessage('Invalid status'),
      body('variants')
        .optional()
        .isArray()
        .withMessage('Variants must be an array')
    ]),
    requestLogger('update_product'),
    validateProductOwnership,
    updateProduct
  )
  .delete(
    validateRequest([
      param('productId')
        .isMongoId()
        .withMessage('Invalid product ID')
    ]),
    requestLogger('delete_product'),
    validateProductOwnership,
    deleteProduct
  );

module.exports = router;