// wishlist.js
const express = require('express');
const router = express.Router();
const {
  toggleWishlistItem,
  getWishlist,
  clearWishlist,
  checkWishlistStatus
} = require('../controllers/wishlistcontroller');
const { protect } = require('../middleware/authMiddleware'); // FIXED: Corrected 'middlewares' to 'middleware'

// Protected routes
router.route('/')
  .get(protect, getWishlist)
  .delete(protect, clearWishlist);

router.route('/:productId')
  .put(protect, toggleWishlistItem);

// REVERTED: Retained the original separate route for checkWishlistStatus for API consistency
router.route('/check/:productId')
  .get(protect, checkWishlistStatus);

module.exports = router;