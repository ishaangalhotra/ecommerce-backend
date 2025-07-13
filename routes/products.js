const express = require('express');
const router = express.Router();
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct
} = require('../controllers/productController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Public routes
router.route('/')
  .get(getProducts);

router.route('/:id')
  .get(getProduct);

// Protected routes (require authentication and authorization)
router.use(protect);

router.route('/')
  .post(authorize('seller', 'admin'), createProduct);

router.route('/:id')
  .put(authorize('seller', 'admin'), updateProduct)
  .delete(authorize('seller', 'admin'), deleteProduct);

module.exports = router;