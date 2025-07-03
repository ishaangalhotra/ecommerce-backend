const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

// @desc    Toggle product in wishlist
// @route   PUT /api/wishlist/:productId
// @access  Private
exports.toggleWishlist = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.productId);
  if (!product) return next(new ErrorResponse('Product not found', 404));

  let wishlist = await Wishlist.findOneAndUpdate(
    { user: req.user.id },
    { $exists: true } ? { 
      $addToSet: { products: product._id } 
    } : { 
      $pull: { products: product._id } 
    },
    { new: true, upsert: true }
  ).populate('products');

  res.status(200).json({
    success: true,
    data: wishlist
  });
});

// @desc    Get user wishlist
// @route   GET /api/wishlist
// @access  Private
exports.getWishlist = asyncHandler(async (req, res, next) => {
  const wishlist = await Wishlist.findOne({ user: req.user.id })
    .populate({
      path: 'products',
      select: 'name price image ratings'
    });

  res.status(200).json({
    success: true,
    count: wishlist?.products?.length || 0,
    data: wishlist || { products: [] }
  });
});

// @desc    Clear wishlist
// @route   DELETE /api/wishlist
// @access  Private
exports.clearWishlist = asyncHandler(async (req, res, next) => {
  await Wishlist.findOneAndDelete({ user: req.user.id });
  res.status(200).json({ 
    success: true, 
    data: { products: [] } 
  });
});