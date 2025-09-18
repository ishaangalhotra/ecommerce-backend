const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Category = require('../models/Category');
const upload = require('../middleware/uploadMiddleware');
const {
  validateProductId,
  validateProductData,
  validateBulkProductData
} = require('../validators/productValidator');
const Product = require('../models/Product');
const asyncHandler = require('express-async-handler');
const {
  ApiError,
  ApiResponse
} = require('../utils/apiResponse');
const {
  formatProduct
} = require('../utils/productFormatter');
const {
  convertCsvToJson
} = require('../utils/csvConverter');
const logger = require('../utils/logger');
const {
  generateCsv
} = require('../utils/csvGenerator');
const orderUtils = require('../utils/orderUtils');

// ===== Auth middleware (fail-secure) =====
let hybridProtect, requireRole, authorize;
let authModuleLoaded = false;

try {
  const hybridAuth = require('../middleware/hybridAuth');
  hybridProtect = hybridAuth.hybridProtect;
  requireRole = hybridAuth.requireRole;

  // Keep backward compatibility with old auth middleware
  try {
    const auth = require('../middleware/authMiddleware');
    authorize = auth.authorize;
  } catch {
    // If old auth not available, use hybrid for all
    authorize = hybridAuth.requireRole;
  }

  if (typeof hybridProtect !== 'function' || typeof requireRole !== 'function') {
    throw new Error('Auth middleware functions are not properly exported');
  }

  authModuleLoaded = true;
  console.log('✅ Hybrid authentication middleware loaded successfully');
} catch (error) {
  console.error('🔐 CRITICAL SECURITY ERROR: Auth middleware failed to load:', error.message);

  // Corrected fallback middleware
  hybridProtect = (req, res, next) => {
    console.error('🚨 SECURITY BREACH ATTEMPT: Auth middleware unavailable, blocking request');
    res.status(503).json({
      error: 'Service temporarily unavailable due to security module failure',
      code: 'AUTH_MODULE_UNAVAILABLE'
    });
  };

  // Corrected fallback for requireRole
  requireRole = () => (req, res, next) => {
    hybridProtect(req, res, next);
  };

  authModuleLoaded = false;
}

// ===== Controller/Service module (fail-secure) =====
let sellerController;
let controllerModuleLoaded = false;

try {
  sellerController = require('../controllers/sellerController');
  controllerModuleLoaded = true;
  console.log('✅ Seller controller loaded successfully');
} catch (error) {
  console.error('❌ Failed to load seller controller:', error.message);
  sellerController = {
    // A placeholder that handles requests when the controller is unavailable
    handleUnavailable: (req, res) => {
      res.status(503).json({
        error: 'Seller service is currently unavailable. Please try again later.',
        code: 'SERVICE_UNAVAILABLE'
      });
    },
    // Map each expected controller function to the placeholder
    createProduct: (req, res) => this.handleUnavailable(req, res),
    getSellerProducts: (req, res) => this.handleUnavailable(req, res),
    exportProducts: (req, res) => this.handleUnavailable(req, res),
    updateProduct: (req, res) => this.handleUnavailable(req, res),
    deleteProduct: (req, res) => this.handleUnavailable(req, res),
    bulkUpdateProducts: (req, res) => this.handleUnavailable(req, res),
    getSellerDashboard: (req, res) => this.handleUnavailable(req, res),
    getProductAnalytics: (req, res) => this.handleUnavailable(req, res),
    getSellerOrders: (req, res) => this.handleUnavailable(req, res),
    updateOrderStatus: (req, res) => this.handleUnavailable(req, res),
    getSellerCustomers: (req, res) => this.handleUnavailable(req, res),
  };
}

/**
 * All routes in this router require seller authentication
 * NOTE: The `hybridProtect` middleware must be passed as a function reference, e.g. `hybridProtect`, NOT `hybridProtect()`
 */
if (authModuleLoaded && controllerModuleLoaded) {
  // Use hybridProtect for all routes below
  router.use(hybridProtect);
  router.use(requireRole('seller'));

  /**
   * @route   POST /api/v1/seller/products
   * @desc    Create a new product
   * @access  Private (Seller)
   */
  router.post(
    '/products',
    upload.array('images', 5),
    validateProductData,
    asyncHandler(sellerController.createProduct)
  );

  /**
   * @route   GET /api/v1/seller/products
   * @desc    Get all products for the authenticated seller
   * @access  Private (Seller)
   */
  router.get('/products', asyncHandler(sellerController.getSellerProducts));

  /**
   * @route   GET /api/v1/seller/products/export
   * @desc    Export seller's products to a CSV file
   * @access  Private (Seller)
   */
  router.get('/products/export', asyncHandler(sellerController.exportProducts));

  /**
   * @route   PUT /api/v1/seller/products/:productId
   * @desc    Update a product by ID
   * @access  Private (Seller)
   */
  router.put(
    '/products/:productId',
    validateProductId,
    validateProductData,
    asyncHandler(sellerController.updateProduct)
  );

  /**
   * @route   DELETE /api/v1/seller/products/:productId
   * @desc    Delete a product by ID
   * @access  Private (Seller)
   */
  router.delete(
    '/products/:productId',
    validateProductId,
    asyncHandler(sellerController.deleteProduct)
  );

  /**
   * @route   PATCH /api/v1/seller/products/bulk
   * @desc    Bulk update products from a CSV file
   * @access  Private (Seller)
   */
  router.patch(
    '/products/bulk',
    upload.single('file'),
    validateBulkProductData,
    asyncHandler(sellerController.bulkUpdateProducts)
  );

  /**
   * @route   GET /api/v1/seller/dashboard
   * @desc    Get seller dashboard data (sales, revenue, etc.)
   * @access  Private (Seller)
   */
  router.get('/dashboard', asyncHandler(sellerController.getSellerDashboard));

  /**
   * @route   GET /api/v1/seller/products/:productId/analytics
   * @desc    Get analytics for a single product
   * @access  Private (Seller)
   */
  router.get(
    '/products/:productId/analytics',
    validateProductId,
    asyncHandler(sellerController.getProductAnalytics)
  );

  /**
   * @route   GET /api/v1/seller/orders
   * @desc    Get orders for the authenticated seller
   * @access  Private (Seller)
   */
  router.get('/orders', asyncHandler(sellerController.getSellerOrders));

  /**
   * @route   PATCH /api/v1/seller/orders/:id/status
   * @desc    Update the status of an order
   * @access  Private (Seller)
   */
  router.patch(
    '/orders/:id/status',
    asyncHandler(sellerController.updateOrderStatus)
  );

  /**
   * @route   GET /api/v1/seller/customers
   * @desc    Get a list of customers who have bought from the seller
   * @access  Private (Seller)
   */
  router.get('/customers', asyncHandler(sellerController.getSellerCustomers));

  console.log('✅ Seller routes initialized successfully');
} else {
  console.error('❌ Seller routes are disabled due to failed dependencies');
  // Fallback routes if dependencies failed to load
  router.use((req, res) => {
    res.status(503).json({
      error: 'Seller service is currently unavailable due to a server configuration error.',
      code: 'SELLER_SERVICE_UNAVAILABLE'
    });
  });
}

/**
 * @route   GET /api/v1/seller/status
 * @desc    Check the status of the seller service
 * @access  Public
 */
router.get('/status', (req, res) => {
  const status = {
    service: 'Seller API',
    status: authModuleLoaded && controllerModuleLoaded ? 'operational' : 'degraded',
    dependencies: {
      auth: authModuleLoaded ? 'operational' : 'failed',
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
    details: 'The requested seller API endpoint does not exist.'
  });
});

module.exports = router;