// routes/seller.products.js
const express = require('express');
const router = express.Router();

// Security-first approach: Fail securely if auth middleware is missing
let protect, authorize;
let authModuleLoaded = false;

try {
  const auth = require('../middleware/authMiddleware');
  protect = auth.protect;
  authorize = auth.authorize;
  
  // Validate that the middleware functions exist and are callable
  if (typeof protect !== 'function' || typeof authorize !== 'function') {
    throw new Error('Auth middleware functions are not properly exported');
  }
  
  authModuleLoaded = true;
  console.log('✅ Authentication middleware loaded successfully');
} catch (error) {
  console.error('🔒 CRITICAL SECURITY ERROR: Auth middleware failed to load:', error.message);
  
  // SECURE FALLBACK: Block all requests when auth fails
  protect = (req, res, next) => {
    console.error('🚨 SECURITY BREACH ATTEMPT: Auth middleware unavailable, blocking request');
    res.status(503).json({ 
      error: 'Service temporarily unavailable due to security module failure',
      code: 'AUTH_MODULE_UNAVAILABLE'
    });
  };
  
  authorize = (...roles) => (req, res, next) => {
    console.error('🚨 SECURITY BREACH ATTEMPT: Authorization unavailable, blocking request');
    res.status(503).json({ 
      error: 'Service temporarily unavailable due to security module failure',
      code: 'AUTH_MODULE_UNAVAILABLE'
    });
  };
}

// File upload middleware with graceful degradation
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
  
  // Fallback: Accept requests but handle file upload gracefully
  upload = {
    fields: (config) => (req, res, next) => {
      console.warn('⚠️ Upload functionality unavailable, proceeding without file handling');
      req.fileUploadError = 'File upload service temporarily unavailable';
      next();
    }
  };
}

// Controller with comprehensive error handling
let sellerCtrl;
let controllerModuleLoaded = false;

try {
  sellerCtrl = require('../controllers/sellercontroller');
  
  // Validate required controller methods exist
  const requiredMethods = ['uploadProduct', 'getMyProducts'];
  for (const method of requiredMethods) {
    if (typeof sellerCtrl[method] !== 'function') {
      throw new Error(`Required controller method '${method}' is missing or not a function`);
    }
  }
  
  controllerModuleLoaded = true;
  console.log('✅ Seller controller loaded successfully');
} catch (error) {
  console.error('🎛️ Seller controller import failed:', error.message);
  
  // Fallback: Provide informative error responses
  sellerCtrl = {
    uploadProduct: (req, res) => {
      console.error('🚫 Product upload attempted but controller unavailable');
      res.status(503).json({ 
        error: 'Product management service temporarily unavailable',
        code: 'CONTROLLER_UNAVAILABLE'
      });
    },
    getMyProducts: (req, res) => {
      console.error('🚫 Product retrieval attempted but controller unavailable');
      res.status(503).json({ 
        error: 'Product management service temporarily unavailable',
        code: 'CONTROLLER_UNAVAILABLE'
      });
    }
  };
}

// Middleware to check system health before processing requests
const systemHealthCheck = (req, res, next) => {
  const systemStatus = {
    auth: authModuleLoaded,
    upload: uploadModuleLoaded,
    controller: controllerModuleLoaded
  };
  
  // Log system status for monitoring
  if (!authModuleLoaded || !controllerModuleLoaded) {
    console.warn('⚠️ System running in degraded mode:', systemStatus);
  }
  
  // Critical: Block requests if auth is not available
  if (!authModuleLoaded) {
    console.error('🔒 Request blocked due to missing authentication system');
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      code: 'SYSTEM_DEGRADED',
      details: 'Authentication system unavailable'
    });
  }
  
  next();
};

// Enhanced error wrapper for async route handlers
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
    console.error('🚨 Route handler error:', {
      path: req.path,
      method: req.method,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      timestamp: new Date().toISOString()
    });
    
    // Don't expose internal errors to clients
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId: req.id || 'unknown'
    });
  });
};

// CREATE PRODUCT ROUTE
router.post(
  '/products',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  upload.fields([
    { name: 'images', maxCount: 8 }, 
    { name: 'image', maxCount: 1 }
  ]),
  asyncHandler(async (req, res, next) => {
    // Additional validation for file upload issues
    if (req.fileUploadError && !uploadModuleLoaded) {
      return res.status(503).json({
        error: 'File upload service temporarily unavailable',
        code: 'UPLOAD_UNAVAILABLE'
      });
    }
    
    // Log successful authentication for security monitoring
    console.log('✅ Authenticated product creation request:', {
      userId: req.user?.id,
      userRole: req.user?.role,
      hasFiles: !!(req.files?.images || req.files?.image),
      timestamp: new Date().toISOString()
    });
    
    await sellerCtrl.uploadProduct(req, res, next);
  })
);

// GET PRODUCTS ROUTE
router.get(
  '/products',
  systemHealthCheck,
  protect,
  authorize('seller', 'admin'),
  asyncHandler(async (req, res, next) => {
    // Log successful authentication for security monitoring
    console.log('✅ Authenticated product retrieval request:', {
      userId: req.user?.id,
      userRole: req.user?.role,
      query: req.query,
      timestamp: new Date().toISOString()
    });
    
    await sellerCtrl.getMyProducts(req, res, next);
  })
);

// SYSTEM STATUS ENDPOINT (for monitoring)
router.get('/status', (req, res) => {
  const status = {
    service: 'seller-products',
    timestamp: new Date().toISOString(),
    modules: {
      authentication: authModuleLoaded ? 'operational' : 'failed',
      fileUpload: uploadModuleLoaded ? 'operational' : 'degraded',
      controller: controllerModuleLoaded ? 'operational' : 'failed'
    },
    security: {
      authenticationRequired: true,
      failsSecurely: true
    }
  };
  
  const httpStatus = (authModuleLoaded && controllerModuleLoaded) ? 200 : 503;
  res.status(httpStatus).json(status);
});

// Export router with metadata for debugging
module.exports = router;

// Module metadata for introspection
module.exports.metadata = {
  name: 'seller-products',
  version: '2.0.0',
  security: 'fail-secure',
  dependencies: {
    auth: authModuleLoaded,
    upload: uploadModuleLoaded,
    controller: controllerModuleLoaded
  },
  loadedAt: new Date().toISOString()
};