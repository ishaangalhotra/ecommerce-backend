const express = require('express');
const router = express.Router();
const {
  toggleWishlistItem,
  getWishlist,
  clearWishlist,
  checkWishlistStatus
} = require('../controllers/wishlistController');
const { protect } = require('../middlewares/authMiddleware');

// Protected routes
router.route('/')
  .get(protect, getWishlist)
  .delete(protect, clearWishlist);

router.route('/:productId')
  .put(protect, toggleWishlistItem);

router.route('/check/:productId')
  .get(protect, checkWishlistStatus); // New status check route

module.exports = router;