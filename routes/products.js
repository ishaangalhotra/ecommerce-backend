const express = require('express');
const router = express.Router();
const {
  getProducts,
  createProduct,
  getProductById,
  deleteProduct,
  updateProduct
} = require('../controllers/productController');
const { protect, admin, isSeller } = require('../middleware/authMiddleware'); // Import middleware

// @route   GET /api/products - Get all products (Public)
// @route   POST /api/products - Create a new product (Protected, Seller/Admin only)
router.route('/').get(getProducts).post(protect, isSeller, createProduct);

// @route   GET /api/products/:id - Get a single product by ID (Public)
// @route   DELETE /api/products/:id - Delete a product (Protected, Seller/Admin only)
// @route   PUT /api/products/:id - Update a product (Protected, Seller/Admin only)
router
  .route('/:id')
  .get(getProductById)
  .delete(protect, isSeller, deleteProduct)
  .put(protect, isSeller, updateProduct);

module.exports = router;