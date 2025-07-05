// routes/seller.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  uploadProduct,
  getMyProducts,
  updateProduct,
  deleteProduct
} = require('../controllers/sellerController');
const upload = require('../utils/fileUpload');

router.route('/products')
  .get(protect, authorize('seller', 'admin'), getMyProducts)
  .post(protect, authorize('seller', 'admin'), upload.single('image'), uploadProduct);

router.route('/products/:id')
  .put(protect, authorize('seller', 'admin'), updateProduct)
  .delete(protect, authorize('seller', 'admin'), deleteProduct);

module.exports = router;
