const express = require('express');
const router = express.Router();
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getTopProducts,
  createProductReview
} = require('../controllers/productController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public routes
router.route('/')
  .get(getProducts);

router.route('/top')
  .get(getTopProducts); // New featured products route

router.route('/:id')
  .get(getProduct);

router.route('/:id/reviews')
  .post(protect, createProductReview); // New review route

// Protected routes (seller/admin)
router.route('/')
  .post(protect, authorize('seller', 'admin'), createProduct);

router.route('/:id')
  .put(protect, authorize('seller', 'admin'), updateProduct)
  .delete(protect, authorize('seller', 'admin'), deleteProduct);

module.exports = router;