const express = require('express');
const router = express.Router();
const { 
  protect, 
  authorize 
} = require('../middlewares/authMiddleware');
const {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  createProductReview,
  getTopProducts
} = require('../controllers/productController');
const upload = require('../middlewares/uploadMiddleware');

// Public routes
router.get('/', getProducts);
router.get('/top', getTopProducts);
router.get('/:id', getProductById);

// Protected routes
router.post('/', protect, authorize('seller', 'admin'), upload.single('image'), createProduct);
router.put('/:id', protect, authorize('seller', 'admin'), updateProduct);
router.delete('/:id', protect, authorize('seller', 'admin'), deleteProduct);
router.post('/:id/reviews', protect, createProductReview);

module.exports = router;