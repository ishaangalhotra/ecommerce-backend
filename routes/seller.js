// routes/seller.js - FIXED VERSION
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Category = require('../models/Category'); // Added Category model import

// ===== Auth middleware (fail-secure) =====
let hybridProtect, authorize;
let authModuleLoaded = false;

try {
  const auth = require('../middleware/authMiddleware');
  hybridProtect = auth.hybridProtect;
  authorize = auth.authorize;

  if (typeof hybridProtect !== 'function' || typeof authorize !== 'function') {
    throw new Error('Auth middleware functions are not properly exported');
  }

  authModuleLoaded = true;
  console.log('✅ Authentication middleware loaded successfully');
} catch (error) {
  console.error('🔐 CRITICAL SECURITY ERROR: Auth middleware failed to load:', error.message);

  hybridProtect = () => (req, res) => {
    console.error('🚨 SECURITY BREACH ATTEMPT: Auth middleware unavailable, blocking request');
    res.status(503).json({
      error: 'Service temporarily unavailable due to security module failure',
      code: 'AUTH_MODULE_UNAVAILABLE'
    });
  };

  authorize = () => (req, res) => {
    console.error('🚨 SECURITY BREACH ATTEMPT: Authorization unavailable, blocking request');
    res.status(503).json({
      error: 'Service temporarily unavailable due to security module failure',
      code: 'AUTH_MODULE_UNAVAILABLE'
    });
  };
}

// ===== Upload middleware (graceful degradation) =====
let upload;
let uploadModuleLoaded = false;

try {
  upload = require('../utils/multer');
  if (!upload || typeof upload.fields !== 'function') {
    throw new Error('Upload middleware not properly configured');
  }
  uploadModuleLoaded = true;
  console.log('✅ Upload middleware loaded successfully');
} catch (error) {
  console.error('📁 Upload middleware import failed:', error.message);
  upload = {
    fields: () => (req, res, next) => {
      console.warn('⚠️ Upload functionality unavailable, proceeding without file handling');
      req.fileUploadError = 'File upload service temporarily unavailable';
      next();
    }
  };
}

// ===== Rate limiting middleware =====
let rateLimiter;
try {
  const rateLimit = require('express-rate-limit');
  rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
      error: 'Too many requests from this IP, please try again later',
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
} catch (error) {
  console.warn('⚠️ Rate limiting unavailable:', error.message);
  rateLimiter = (req, res, next) => next();
}

// ===== Controller (with fixed presence checks) =====
let sellerCtrl;
let controllerModuleLoaded = false;
const sellerOrders = require('../controllers/sellerOrdersController');

try {
  sellerCtrl = require('../controllers/sellercontroller');

  // Check required methods (functions only)
  const requiredMethods = [
    'uploadProduct',
    'getMyProducts',
    'updateProduct',
    'deleteProduct',
    'getSellerDashboard',
    'getProductAnalytics',
    'bulkUpdateProducts',
    'exportProducts'
  ];

  for (const method of requiredMethods) {
    if (typeof sellerCtrl[method] !== 'function') {
      throw new Error(`Required controller method '${method}' is missing or not a function`);
    }
  }
  
  // Check validateProduct separately - it can be an array OR undefined
  // If it exists, it should be an array
  if (sellerCtrl.validateProduct !== undefined && !Array.isArray(sellerCtrl.validateProduct)) {
    throw new Error(`validateProduct must be an array if defined`);
  }

  controllerModuleLoaded = true;
  console.log('✅ Seller controller loaded successfully');
} catch (error) {
  console.error('🎛️ Seller controller import failed:', error.message);

  const fallback = (methodName) => (req, res) =>
    res.status(503).json({
      error: 'Product management service temporarily unavailable',
      code: 'CONTROLLER_UNAVAILABLE',
      method: methodName,
      timestamp: new Date().toISOString()
    });

  sellerCtrl = {
    uploadProduct: fallback('uploadProduct'),
    getMyProducts: fallback('getMyProducts'),
    updateProduct: fallback('updateProduct'),
    deleteProduct: fallback('deleteProduct'),
    getSellerDashboard: fallback('getSellerDashboard'),
    getProductAnalytics: fallback('getProductAnalytics'),
    bulkUpdateProducts: fallback('bulkUpdateProducts'),
    exportProducts: fallback('exportProducts'),
    validateProduct: [] // Empty array as fallback
  };
}

// ===== Health gate =====
const systemHealthCheck = (req, res, next) => {
  if (!authModuleLoaded) {
    console.error('🔐 Request blocked due to missing authentication system');
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      code: 'SYSTEM_DEGRADED',
      details: 'Authentication system unavailable'
    });
  }
  next();
};

// ===== Utilities =====
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((error) => {
    console.error('🚨 Route handler error:', { path: req.path, method: req.method, error: error.message });
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

const validateObjectId = (paramName = 'id') => (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params[paramName])) {
    return res.status(400).json({ message: `Invalid ${paramName} provided`, code: 'INVALID_OBJECT_ID' });
  }
  next();
};

const logRequest = (operation) => (req, res, next) => {
  console.log(`✅ ${operation} request initiated by user: ${req.user?.id}`);
  next();
};

const validateFileUpload = (req, res, next) => {
  if (req.fileUploadError) {
    return res.status(503).json({ error: 'File upload service temporarily unavailable', code: 'UPLOAD_UNAVAILABLE' });
  }
  next();
};

const validateBulkOperation = (req, res, next) => {
  const { productIds, updateData } = req.body;
  if (!productIds || !Array.isArray(productIds) || productIds.length === 0 || productIds.length > 100) {
    return res.status(400).json({ message: 'Product IDs must be an array with 1 to 100 elements.', code: 'INVALID_BULK_REQUEST' });
  }
  if (!updateData || typeof updateData !== 'object') {
    return res.status(400).json({ message: 'Update data is required.', code: 'MISSING_UPDATE_DATA' });
  }
  next();
};

const validateExportFormat = (req, res, next) => {
  const { format = 'json' } = req.query;
  if (!['json', 'csv'].includes(format)) {
    return res.status(400).json({ message: 'Invalid export format. Allowed formats: json, csv', code: 'INVALID_EXPORT_FORMAT' });
  }
  next();
};

// ====== ROUTES ======

router.use(rateLimiter);

// Create product - using spread operator for validateProduct array
const createProductMiddleware = [
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  upload.fields([{ name: 'images', maxCount: 8 }]),
  validateFileUpload,
  ...(sellerCtrl.validateProduct || []), // Spread the array or empty array
  logRequest('Product creation'),
  asyncHandler(sellerCtrl.uploadProduct)
];

router.post('/products', ...createProductMiddleware);

// List my products
router.get(
  '/products',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  logRequest('Product retrieval'),
  asyncHandler(sellerCtrl.getMyProducts)
);

// Export my products
router.get(
  '/products/export',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  validateExportFormat,
  logRequest('Export products'),
  asyncHandler(sellerCtrl.exportProducts)
);

// Bulk operations
router.patch(
  '/products/bulk',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  validateBulkOperation,
  logRequest('Bulk product update'),
  asyncHandler(sellerCtrl.bulkUpdateProducts)
);

// Add categories endpoint to seller routes
router.get(
  '/categories',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  asyncHandler(async (req, res) => {
    try {
      const categories = await Category.find({ status: 'active' })
        .select('name description')
        .sort({ name: 1 });
      
      res.json({
        success: true,
        categories
      });
    } catch (error) {
      console.error('Categories fetch error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch categories'
      });
    }
  })
);

// Update product middleware stack
const updateProductMiddleware = [
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  validateObjectId('productId'),
  upload.fields([{ name: 'images', maxCount: 8 }]),
  validateFileUpload,
  ...(sellerCtrl.validateProduct || []), // Spread the array or empty array
  logRequest('Product update')
];

// Update product (full/partial)
router.put('/products/:productId', ...updateProductMiddleware, asyncHandler(sellerCtrl.updateProduct));
router.patch('/products/:productId', ...updateProductMiddleware, asyncHandler(sellerCtrl.updateProduct));

// Delete product
router.delete(
  '/products/:productId',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  validateObjectId('productId'),
  logRequest('Product deletion'),
  asyncHandler(sellerCtrl.deleteProduct)
);

// Seller dashboard
router.get(
  '/dashboard',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  logRequest('Dashboard access'),
  asyncHandler(sellerCtrl.getSellerDashboard)
);

// Product analytics
router.get(
  '/products/:productId/analytics',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  validateObjectId('productId'),
  logRequest('Product analytics'),
  asyncHandler(sellerCtrl.getProductAnalytics)
);

// --- SELLER ORDERS & CUSTOMERS ROUTES ---
router.get(
  '/orders',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  logRequest('Seller orders'),
  asyncHandler(sellerOrders.listSellerOrders)
);

router.patch(
  '/orders/:id/status',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  validateObjectId('id'),
  logRequest('Update order status'),
  asyncHandler(sellerOrders.updateOrderStatusForSeller)
);

router.get(
  '/customers',
  systemHealthCheck,
  hybridProtect(),
  requireRole(['seller', 'admin']),
  logRequest('Seller customers'),
  asyncHandler(sellerOrders.listSellerCustomers)
);

// System health status
router.get('/health', (req, res) => {
  const status = {
    service: 'seller-products',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    modules: {
      authentication: authModuleLoaded ? 'operational' : 'failed',
      fileUpload: uploadModuleLoaded ? 'operational' : 'degraded',
      controller: controllerModuleLoaded ? 'operational' : 'failed'
    },
    endpoints: {
      'POST /api/v1/seller/products': 'Create product',
      'GET /api/v1/seller/products': 'List products',
      'GET /api/v1/seller/products/export': 'Export products',
      'PUT/PATCH /api/v1/seller/products/:productId': 'Update product',
      'DELETE /api/v1/seller/products/:productId': 'Delete product',
      'PATCH /api/v1/seller/products/bulk': 'Bulk operations',
      'GET /api/v1/seller/dashboard': 'Seller dashboard',
      'GET /api/v1/seller/products/:productId/analytics': 'Product analytics',
      'GET /api/v1/seller/orders': 'List seller orders',
      'PATCH /api/v1/seller/orders/:id/status': 'Update order status',
      'GET /api/v1/seller/customers': 'List seller customers'
    }
  };
  res.status(authModuleLoaded && controllerModuleLoaded ? 200 : 503).json(status);
});

// Handle 404 for unmatched routes
router.use('*', (req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
    availableEndpoints: [
      'GET /api/v1/seller/health',
      'POST /api/v1/seller/products',
      'GET /api/v1/seller/products',
      'PATCH /api/v1/seller/products/bulk',
      'GET /api/v1/seller/dashboard',
      'GET /api/v1/seller/orders',
      'GET /api/v1/seller/customers',
    ]
  });
});

module.exports = router;