// routes/seller.products.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../utils/multer'); // memoryStorage from earlier
const sellerCtrl = require('../controllers/sellercontroller'); // <-- matches your file

// Create product (accept single OR multiple)
router.post(
  '/products',
  protect,
  authorize('seller', 'admin'),
  upload.fields([{ name: 'images', maxCount: 8 }, { name: 'image', maxCount: 1 }]),
  sellerCtrl.uploadProduct
);

// List my products
router.get(
  '/products',
  protect,
  authorize('seller', 'admin'),
  sellerCtrl.getMyProducts
);

// (Optional) update/delete etc. if you want now:
// router.put('/products/:productId', protect, authorize('seller','admin'), upload.array('images', 8), sellerCtrl.updateProduct);
// router.delete('/products/:productId', protect, authorize('seller','admin'), sellerCtrl.deleteProduct);

module.exports = router;
