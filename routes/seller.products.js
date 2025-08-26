// routes/seller.products.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// ===== Auth middleware (fail-secure) =====
let protect, authorize;
let authModuleLoaded = false;

try {
  const auth = require('../middleware/authMiddleware');
  protect = auth.protect;
  authorize = auth.authorize;

  if (typeof protect !== 'function' || typeof authorize !== 'function') {
    throw new Error('Auth middleware functions are not properly exported');
  }

  authModuleLoaded = true;
  console.log('✅ Authentication middleware loaded successfully');
} catch (error) {
  console.error('🔐 CRITICAL SECURITY ERROR: Auth middleware failed to load:', error.message);

  protect = (req, res) => {
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
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
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

// ===== Controller (with presence checks) =====
let sellerCtrl;
let controllerModuleLoaded = false;

try {
  sellerCtrl = require('../controllers/sellercontroller');

  const requiredMethods = [
    'uploadProduct',
    'getMyProducts',
    'updateProduct',
    'deleteProduct',
    'getSellerDashboard',
    'getProductAnalytics',
    'bulkUpdateProducts',
    'exportProducts',
    'validateProduct'  // Include validation middleware
  ];

  for (const method of requiredMethods) {
    if (typeof sellerCtrl[method] !== 'function') {
      throw new Error(`Required controller method '${method}' is missing or not a function`);
    }
  }

  controllerModuleLoaded = true;
  console.log('✅ Seller controller loaded successfully');
} catch (error) {
  console.error('🎛️ Seller controller import failed:', error.message);

  // Fallback no-op controller responses
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
    validateProduct: [] // Empty validation array fallback
  };
}

// ===== Health gate =====
const systemHealthCheck = (req, res, next) => {
  const systemStatus = {
    auth: authModuleLoaded,
    upload: uploadModuleLoaded,
    controller: controllerModuleLoaded
  };

  if (!authModuleLoaded || !controllerModuleLoaded) {
    console.warn('⚠️ System running in degraded mode:', systemStatus);
  }

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
    console.error('🚨 Route handler error:', {
      path: req.path,
      method: req.method,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      userId: req.user?.id,
      userRole: req.user?.role,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId: req.id || 'unknown',
      timestamp: new Date().toISOString()
    });
  });

const validateObjectId = (paramName = 'id') => (req, res, next) => {
  const id = req.params[paramName];
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: `Invalid ${paramName} provided`,
      code: 'INVALID_OBJECT_ID'
    });
  }
  next();
};

// Enhanced request logging
const logRequest = (operation) => (req, res, next) => {
  console.log(`✅ ${operation} request:`, {
    userId: req.user?.id,
    userRole: req.user?.role,
    productId: req.params.productId,
    query: req.query,
    hasFiles: !!(req.files?.images || req.files?.image),
    timestamp: new Date().toISOString()
  });
  next();
};

// File upload validation with enhanced checks
const validateFileUpload = (req, res, next) => {
  if (req.fileUploadError && !uploadModuleLoaded) {
    return res.status(503).json({
      error: 'File upload service temporarily unavailable',
      code: 'UPLOAD_UNAVAILABLE'
    });
  }
  
  // Additional file validation if files are present
  if (req.files) {
    const { images, image } = req.files;
    const allFiles = [...(images || []), ...(image || [])];
    
    // Check total file count
    if (allFiles.length > 8) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 8 images allowed per product',
        code: 'TOO_MANY_FILES'
      });
    }
    
    // Check file size limits and types
    const maxSize = 5 * 1024 * 1024; // 5MB
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    
    for (const file of allFiles) {
      if (file.size > maxSize) {
        return res.status(400).json({
          success: false,
          message: 'File size too large',
          code: 'FILE_TOO_LARGE',
          maxSize: '5MB',
          fileName: file.originalname
        });
      }
      
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed',
          code: 'INVALID_FILE_TYPE',
          fileName: file.originalname,
          receivedType: file.mimetype
        });
      }
    }
  }
  
  next();
};

// Validate bulk operation request
const validateBulkOperation = (req, res, next) => {
  const { productIds, updateData } = req.body;
  
  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Product IDs array is required and cannot be empty',
      code: 'INVALID_BULK_REQUEST'
    });
  }
  
  if (productIds.length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Cannot update more than 100 products at once',
      code: 'BULK_LIMIT_EXCEEDED'
    });
  }
  
  if (!updateData || typeof updateData !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'Update data is required',
      code: 'MISSING_UPDATE_DATA'
    });
  }
  
  // Validate ObjectIds
  const invalidIds = productIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
  if (invalidIds.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Some product IDs are invalid',
      code: 'INVALID_PRODUCT_IDS',
      invalidIds
    });
  }
  
  next();
};

// Validate export format
const validateExportFormat = (req, res, next) => {
  const { format = 'json' } = req.query;
  const allowedFormats = ['json', 'csv'];
  
  if (!allowedFormats.includes(format)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid export format',
      code: 'INVALID_EXPORT_FORMAT',
      allowedFormats
    });
  }
  
  next();
};

// ====== ROUTES ======

// Apply rate limiting to all routes
router.use(rateLimiter);

// Create product
router.post(
  '/products',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  upload.fields([
    { name: 'images', maxCount: 8 },
    { name: 'image', maxCount: 1 }
  ]),
  validateFileUpload,
  sellerCtrl.validateProduct, // Apply validation rules
  logRequest('Product creation'),
  asyncHandler(sellerCtrl.uploadProduct)
);

// List my products (with filtering, sorting, pagination)
router.get(
  '/products',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  logRequest('Product retrieval'),
  asyncHandler(sellerCtrl.getMyProducts)
);

// Export my products
router.get(
  '/products/export',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  validateExportFormat,
  logRequest('Export products'),
  asyncHandler(sellerCtrl.exportProducts)
);

// Bulk operations (status changes, price updates, etc.)
router.patch(
  '/products/bulk',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  validateBulkOperation,
  logRequest('Bulk product update'),
  asyncHandler(sellerCtrl.bulkUpdateProducts)
);

// Update product middleware stack
const updateProductMiddleware = [
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  validateObjectId('productId'),
  upload.fields([
    { name: 'images', maxCount: 8 },
    { name: 'image', maxCount: 1 }
  ]),
  validateFileUpload,
  sellerCtrl.validateProduct, // Apply validation rules
  logRequest('Product update')
];

// Update product (full update)
router.put(
  '/products/:productId',
  ...updateProductMiddleware,
  asyncHandler(async (req, res, next) => {
    req.isFullUpdate = true;
    await sellerCtrl.updateProduct(req, res, next);
  })
);

// Update product (partial update)
router.patch(
  '/products/:productId',
  ...updateProductMiddleware,
  asyncHandler(async (req, res, next) => {
    req.isPartialUpdate = true;
    await sellerCtrl.updateProduct(req, res, next);
  })
);

// Delete product
router.delete(
  '/products/:productId',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  validateObjectId('productId'),
  logRequest('Product deletion'),
  asyncHandler(sellerCtrl.deleteProduct)
);

// Seller dashboard (overview metrics)
router.get(
  '/dashboard',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  logRequest('Dashboard access'),
  asyncHandler(sellerCtrl.getSellerDashboard)
);

// Product analytics
router.get(
  '/products/:productId/analytics',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  validateObjectId('productId'),
  logRequest('Product analytics'),
  asyncHandler(sellerCtrl.getProductAnalytics)
);

// System health status (monitoring endpoint)
router.get('/health', (req, res) => {
  const status = {
    service: 'seller-products',
    version: '2.3.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    modules: {
      authentication: authModuleLoaded ? 'operational' : 'failed',
      fileUpload: uploadModuleLoaded ? 'operational' : 'degraded',
      controller: controllerModuleLoaded ? 'operational' : 'failed'
    },
    security: {
      authenticationRequired: true,
      failsSecurely: true,
      rateLimitingEnabled: true,
      fileValidationEnabled: true
    },
    limits: {
      maxFilesPerProduct: 8,
      maxFileSize: '5MB',
      maxBulkOperations: 100,
      rateLimitWindow: '15 minutes',
      rateLimitMax: 100
    },
    endpoints: {
      'POST /products': 'Create product',
      'GET /products': 'List products',
      'GET /products/export': 'Export products',
      'PUT /products/:productId': 'Update product (full)',
      'PATCH /products/:productId': 'Update product (partial)',
      'DELETE /products/:productId': 'Delete product',
      'PATCH /products/bulk': 'Bulk operations',
      'GET /dashboard': 'Seller dashboard',
      'GET /products/:productId/analytics': 'Product analytics'
    }
  };

  const httpStatus = (authModuleLoaded && controllerModuleLoaded) ? 200 : 503;
  res.status(httpStatus).json(status);
});

// --- TEMP STUBS: Add these to keep the UI working until Order model is ready ---

// GET /api/v1/seller/orders
router.get(
  '/orders',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  logRequest('Seller orders (stub)'),
  asyncHandler(async (req, res) => {
    // Return a valid empty list to prevent frontend 404 errors
    res.json({
      success: true,
      message: 'Orders retrieved (stub)',
      data: { orders: [] } 
    });
  })
);

// GET /api/v1/seller/customers
router.get(
  '/customers',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  logRequest('Seller customers (stub)'),
  asyncHandler(async (req, res) => {
    // Return a valid empty list to prevent frontend 404 errors
    res.json({
      success: true,
      message: 'Customers retrieved (stub)',
      data: { customers: [] }
    });
  })
);

// PATCH /api/v1/seller/orders/:id/status
router.patch(
  '/orders/:id/status',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  validateObjectId('id'), // Validate the order ID from params
  logRequest('Update order status (stub)'),
  asyncHandler(async (req, res) => {
    res.json({ 
        success: true, 
        message: 'Order status updated (stub)', 
        data: { id: req.params.id, newStatus: 'processing' } 
    });
  })
);

// --- End of TEMP STUBS ---


// Handle 404 for unmatched routes within this router
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
    availableEndpoints: [
      'GET /seller/health',
      'POST /seller/products',
      'GET /seller/products',
      'GET /seller/products/export',
      'PUT /seller/products/:productId',
      'PATCH /seller/products/:productId',
      'DELETE /seller/products/:productId',
      'PATCH /seller/products/bulk',
      'GET /seller/dashboard',
      'GET /seller/products/:productId/analytics',
      // Added for clarity
      'GET /seller/orders',
      'GET /seller/customers',
      'PATCH /seller/orders/:id/status'
    ]
  });
});

// Export router with metadata
module.exports = router;
module.exports.metadata = {
  name: 'seller-products',
  version: '2.3.0',
  security: 'fail-secure',
  features: [
    'rate-limiting',
    'file-upload-validation',
    'comprehensive-logging',
    'bulk-operations',
    'input-validation',
    'export-validation',
    'enhanced-error-handling',
    'analytics-support'
  ],
  dependencies: {
    auth: authModuleLoaded,
    upload: uploadModuleLoaded,
    controller: controllerModuleLoaded
  },
  limits: {
    maxFilesPerProduct: 8,
    maxFileSize: 5242880, // 5MB in bytes
    maxBulkOperations: 100,
    rateLimitWindow: 900000, // 15 minutes in ms
    rateLimitMax: 100
  },
  loadedAt: new Date().toISOString()
};