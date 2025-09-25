// routes/seller.js

const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');

// --- Middleware Imports ---
let multipleImages;
try {
  const uploadMiddleware = require('../middleware/uploadMiddleware');
  multipleImages = uploadMiddleware.multipleImages;
} catch (error) {
  console.warn('⚠️ Upload middleware not available, file uploads will be skipped.');
  multipleImages = () => (req, res, next) => next();
}

let hybridProtect, requireRole;
try {
  const hybridAuth = require('../middleware/hybridAuthmiddleware');
  hybridProtect = hybridAuth.hybridProtect;
  requireRole = hybridAuth.requireRole;
  console.log('✅ Hybrid authentication middleware loaded successfully');
} catch (error) {
  console.error('🔐 CRITICAL: Auth middleware failed to load. All seller routes will be blocked.');
  const blockRequest = (req, res, next) => {
    res.status(503).json({ error: 'Service temporarily unavailable due to a security module failure.' });
  };
  hybridProtect = blockRequest;
  requireRole = () => blockRequest;
}

// --- Validator Imports ---
const {
  validateProductId,
  validateProductData,
  validateBulkProductData
} = require('../validators/productValidator');

// --- Controller Import ---
// This now imports the single, consolidated controller.
const sellerController = require('../controllers/sellercontroller');

// All routes below require a logged-in seller
router.use(hybridProtect, requireRole('seller'));

/**
 * @route   POST /api/v1/seller/products
 * @desc    Create a new product
 */
router.post(
  '/products',
  multipleImages('images', 8), // Allow up to 8 images
  sellerController.validateProduct, // Use validator from controller
  asyncHandler(sellerController.uploadProduct)
);

/**
 * @route   GET /api/v1/seller/products
 * @desc    Get all products for the authenticated seller
 */
router.get('/products', asyncHandler(sellerController.getMyProducts));

/**
 * @route   GET /api/v1/seller/products/export
 * @desc    Export seller's products
 */
router.get('/products/export', asyncHandler(sellerController.exportProducts));

/**
 * @route   PUT /api/v1/seller/products/:productId
 * @desc    Update a product by ID
 */
router.put(
  '/products/:productId',
  validateProductId,
  sellerController.validateProduct,
  asyncHandler(sellerController.updateProduct)
);

/**
 * @route   DELETE /api/v1/seller/products/:productId
 * @desc    Delete a product by ID
 */
router.delete(
  '/products/:productId',
  validateProductId,
  asyncHandler(sellerController.deleteProduct)
);

/**

 * @route   PATCH /api/v1/seller/products/bulk
 * @desc    Bulk update products
 */
router.patch(
  '/products/bulk',
  validateBulkProductData,
  asyncHandler(sellerController.bulkUpdateProducts)
);

/**
 * @route   GET /api/v1/seller/dashboard
 * @desc    Get seller dashboard data
 */
router.get('/dashboard', asyncHandler(sellerController.getSellerDashboard));

/**
 * @route   GET /api/v1/seller/products/:productId/analytics
 * @desc    Get analytics for a single product
 */
router.get(
  '/products/:productId/analytics',
  validateProductId,
  asyncHandler(sellerController.getProductAnalytics)
);

/**
 * @route   GET /api/v1/seller/orders
 * @desc    Get orders for the authenticated seller
 */
router.get('/orders', asyncHandler(sellerController.getSellerOrders));

/**
 * @route   PATCH /api/v1/seller/orders/:id/status
 * @desc    Update the status of an order item(s)
 */
router.patch(
  '/orders/:id/status',
  asyncHandler(sellerController.updateOrderStatus)
);

/**
 * @route   GET /api/v1/seller/customers
 * @desc    Get a list of customers for the seller
 */
router.get('/customers', asyncHandler(sellerController.getSellerCustomers));

console.log('✅ Seller routes initialized successfully');

module.exports = router;