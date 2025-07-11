const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const {
  uploadProduct,
  getMyProducts,
  updateProduct,
  deleteProduct,
  getSellerDashboard
} = require('../controllers/sellerController');
const upload = require('../utils/fileUpload');
const { check } = require('express-validator');

// 🔒 Protect ALL seller routes + role authorization
router.use(protect);
router.use(authorize('seller', 'admin'));

// 📊 Seller Dashboard
router.get('/dashboard', getSellerDashboard);

// 🛒 Product Management
router.route('/products')
  .get(getMyProducts)
  .post(
    upload.array('images', 5), // Max 5 images
    [
      check('name', 'Product name is required').notEmpty().trim().escape(),
      check('price', 'Price must be a positive number').isFloat({ min: 0.01 }),
      check('stock', 'Stock must be ≥ 0').isInt({ min: 0 }),
      check('category', 'Category is required').notEmpty().trim().escape(),
    ],
    uploadProduct
  );

router.route('/products/:id')
  .put(
    upload.array('images', 5),
    [
      check('name', 'Product name is required').optional().trim().escape(),
      check('price', 'Invalid price').optional().isFloat({ min: 0.01 }),
      check('stock', 'Invalid stock').optional().isInt({ min: 0 }),
    ],
    updateProduct
  )
  .delete(deleteProduct);

module.exports = router;
