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

// CORRECTED IMPORTS - match what's actually exported
const { checkProductOwnership } = require('../middleware/productMiddleware');
const { uploadImages, validateFileRequirements } = require('../middleware/fileValidation');

const router = express.Router();

// Simple cache middleware placeholder
const cacheMiddleware = (duration) => {
  return (req, res, next) => {
    next();
  };
};

// Simple in-memory rate limiter
const createSimpleRateLimiter = (windowMs, max) => {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => {
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
        retryAfter
      });
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.user.role === 'admin'
  });
};

const uploadLimiter = createSimpleRateLimiter(10 * 60 * 1000, 20);
const productUpdateLimiter = createSimpleRateLimiter(15 * 60 * 1000, 30);
const dashboardLimiter = createSimpleRateLimiter(60 * 1000, 60);
const exportLimiter = createSimpleRateLimiter(60 * 60 * 1000, 5);

// Unified field validator
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
        user: req.user?.id,
        errors: formattedErrors
      });
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: formattedErrors
      });
    }
    next();
  }
];

// Logging middleware
const requestLogger = (action) => {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('Seller API Request', {
        action,
        method: req.method,
        path: req.path,
        sellerId: req.user?.id,
        ip: req.ip,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.get('User-Agent')
      });
    });
    next();
  };
};

// 🔐 Auth guard
router.use(protect);
router.use(authorize('seller', 'admin'));

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    user: req.user?.id
  });
});

// 📊 Dashboard
router.get(
  '/dashboard',
  dashboardLimiter,
  validateRequest([
    query('timeRange').optional().isIn(['24h', '7d', '30d', '90d', 'custom']).withMessage('Invalid time range'),
    query('metrics').optional().isArray().withMessage('Metrics should be an array')
  ]),
  requestLogger('get_dashboard'),
  cacheMiddleware('5 minutes'),
  getSellerDashboard
);

// 📈 Product analytics
router.get(
  '/analytics/:productId',
  validateRequest([
    param('productId').isMongoId().withMessage('Invalid product ID'),
    query('timeRange').optional().isIn(['24h', '7d', '30d', '90d', 'all']).withMessage('Invalid time range'),
    query('breakdown').optional().isIn(['daily', 'weekly', 'monthly']).withMessage('Invalid breakdown period')
  ]),
  requestLogger('get_product_analytics'),
  checkProductOwnership, // CHANGED from validateProductOwnership
  getProductAnalytics
);

// 📋 Get seller products
router.get(
  '/products',
  validateRequest([
    query('status').optional().isIn(['active', 'draft', 'out_of_stock', 'archived', 'all']).withMessage('Invalid status filter'),
    query('category').optional().trim().isLength({ max: 50 }).withMessage('Category filter too long'),
    query('minPrice').optional().isFloat({ min: 0 }).withMessage('Minimum price must be positive').toFloat(),
    query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Maximum price must be positive').toFloat(),
    query('minStock').optional().isInt({ min: 0 }).withMessage('Minimum stock must be positive').toInt(),
    query('maxStock').optional().isInt({ min: 0 }).withMessage('Maximum stock must be positive').toInt(),
    query('sortBy').optional().isIn(['name', 'price', 'stock', 'createdAt', 'updatedAt', 'sales']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer').toInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('Limit must be between 1-200').toInt(),
    query('search').optional().trim().isLength({ max: 100 }).withMessage('Search query too long')
  ]),
  requestLogger('get_products'),
  getMyProducts
);

// 📤 Export products
router.get(
  '/products/export',
  exportLimiter,
  validateRequest([
    query('format').optional().isIn(['json', 'csv', 'excel']).withMessage('Invalid export format'),
    query('fields').optional().isArray().withMessage('Fields should be an array')
  ]),
  requestLogger('export_products'),
  exportProducts
);

// ➕ Upload product
router.post(
  '/products',
  uploadLimiter,
  uploadImages(10), // CHANGED: Use uploadImages instead of upload.array and validateFileType
  validateRequest([
    body('name').notEmpty().withMessage('Product name is required').trim().isLength({ max: 100 }).escape(),
    body('description').optional().trim().isLength({ max: 5000 }).escape(),
    body('price').isFloat({ min: 0.01, max: 1000000 }).withMessage('Price must be between ₹0.01 - ₹1,000,000').toFloat(),
    body('comparePrice').optional().isFloat({ min: 0.01 }).custom((value, { req }) => {
      if (value && value <= req.body.price) {
        throw new Error('Compare price must be greater than price');
      }
      return true;
    }),
    body('costPerItem').optional().isFloat({ min: 0 }).toFloat(),
    body('stock').isInt({ min: 0, max: 100000 }).toInt(),
    body('category').notEmpty().trim().isLength({ max: 50 }).escape(),
    body('tags').optional().isArray({ max: 20 }),
    body('tags.*').trim().isLength({ max: 30 }),
    body('isPublished').optional().isBoolean().toBoolean(),
    body('variants').optional().isArray(),
    body('shipping.weight').optional().isFloat({ min: 0 }).toFloat(),
    body('shipping.dimensions.length').optional().isFloat({ min: 0 }).toFloat(),
    body('shipping.dimensions.width').optional().isFloat({ min: 0 }).toFloat(),
    body('shipping.dimensions.height').optional().isFloat({ min: 0 }).toFloat()
  ]),
  requestLogger('create_product'),
  uploadProduct
);

// 🔁 Bulk update
router.patch(
  '/products/bulk',
  productUpdateLimiter,
  validateRequest([
    body('productIds').isArray({ min: 1, max: 100 }),
    body('productIds.*').isMongoId(),
    body('updateData').isObject(),
    body('updateData.price').optional().isFloat({ min: 0.01 }),
    body('updateData.stock').optional().isInt({ min: 0 }),
    body('updateData.status').optional().isIn(['active', 'draft', 'archived'])
  ]),
  requestLogger('bulk_update_products'),
  bulkUpdateProducts
);

// ✏️ Update & 🗑️ Delete product
router.route('/products/:productId')
  .put(
    productUpdateLimiter,
    uploadImages(10), // CHANGED: Use uploadImages instead of upload.array and validateFileType
    validateRequest([
      param('productId').isMongoId(),
      body('name').optional().trim().isLength({ max: 100 }).escape(),
      body('description').optional().trim().isLength({ max: 5000 }).escape(),
      body('price').optional().isFloat({ min: 0.01, max: 1000000 }).toFloat(),
      body('comparePrice').optional().isFloat({ min: 0.01 }).toFloat(),
      body('stock').optional().isInt({ min: 0, max: 100000 }).toInt(),
      body('status').optional().isIn(['active', 'draft', 'archived']),
      body('variants').optional().isArray()
    ]),
    requestLogger('update_product'),
    checkProductOwnership, // CHANGED from validateProductOwnership
    updateProduct
  )
  .delete(
    validateRequest([
      param('productId').isMongoId()
    ]),
    requestLogger('delete_product'),
    checkProductOwnership, // CHANGED from validateProductOwnership
    deleteProduct
  );

module.exports = router;