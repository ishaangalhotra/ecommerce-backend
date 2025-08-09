// routes/wishlist.js
const express = require('express');
const router = express.Router();
const {
  toggleWishlistItem,
  getWishlist,
  clearWishlist,
  checkWishlistStatus,
  removeFromWishlist,
  getWishlistCount,
  shareWishlist,
  getSharedWishlist
} = require('../controllers/wishlistController');
const { protect } = require('../middleware/authMiddleware');
const { validateObjectId } = require('../middleware/validation');

/**
 * @route   GET /api/v1/wishlist
 * @desc    Get user's wishlist
 * @access  Private
 */
router.get('/', protect, getWishlist);

/**
 * @route   POST /api/v1/wishlist/:productId
 * @desc    Add product to wishlist
 * @access  Private
 */
router.post('/:productId', protect, validateObjectId('productId'), toggleWishlistItem);

/**
 * @route   PUT /api/v1/wishlist/:productId
 * @desc    Toggle product in wishlist (add/remove)
 * @access  Private
 */
router.put('/:productId', protect, validateObjectId('productId'), toggleWishlistItem);

/**
 * @route   DELETE /api/v1/wishlist/:productId
 * @desc    Remove specific product from wishlist
 * @access  Private
 */
router.delete('/:productId', protect, validateObjectId('productId'), removeFromWishlist);

/**
 * @route   DELETE /api/v1/wishlist
 * @desc    Clear entire wishlist
 * @access  Private
 */
router.delete('/', protect, clearWishlist);

/**
 * @route   GET /api/v1/wishlist/check/:productId
 * @desc    Check if product is in user's wishlist
 * @access  Private
 */
router.get('/check/:productId', protect, validateObjectId('productId'), checkWishlistStatus);

/**
 * @route   GET /api/v1/wishlist/count
 * @desc    Get wishlist items count
 * @access  Private
 */
router.get('/count', protect, getWishlistCount);

/**
 * @route   POST /api/v1/wishlist/share
 * @desc    Generate shareable wishlist link
 * @access  Private
 */
router.post('/share', protect, shareWishlist);

/**
 * @route   GET /api/v1/wishlist/shared/:shareId
 * @desc    Get shared wishlist by share ID
 * @access  Public
 */
router.get('/shared/:shareId', getSharedWishlist);

module.exports = router;