// wishlistController.js
const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/asyncHandler');
const mongoose = require('mongoose'); // Needed for isValidObjectId

// @desc    Toggle product in wishlist (add if not present, remove if present)
// @route   PUT /api/v1/wishlist/:productId
// @access  Private
exports.toggleWishlistItem = asyncHandler(async (req, res, next) => {
  const { productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new ErrorResponse('Invalid product ID', 400));
  }

  const product = await Product.findById(productId);
  if (!product) {
    return next(new ErrorResponse('Product not found', 404));
  }

  let wishlist = await Wishlist.findOne({ user: req.user.id });

  if (!wishlist) {
    // If no wishlist exists for the user, create one and add the product
    wishlist = await Wishlist.create({ user: req.user.id, products: [productId] });
    return res.status(201).json({
      success: true,
      message: 'Product added to wishlist',
      data: wishlist.populate('products') // Populate to return full product details
    });
  }

  // Check if the product is already in the wishlist
  const productIndex = wishlist.products.findIndex(
    (p) => p.toString() === productId
  );

  if (productIndex > -1) {
    // Product found, remove it
    wishlist.products.splice(productIndex, 1);
    await wishlist.save();
    res.status(200).json({
      success: true,
      message: 'Product removed from wishlist',
      data: await wishlist.populate('products')
    });
  } else {
    // Product not found, add it
    wishlist.products.push(productId);
    await wishlist.save();
    res.status(200).json({
      success: true,
      message: 'Product added to wishlist',
      data: await wishlist.populate('products')
    });
  }
});


// @desc    Get user wishlist
// @route   GET /api/v1/wishlist
// @access  Private
exports.getWishlist = asyncHandler(async (req, res, next) => {
  const wishlist = await Wishlist.findOne({ user: req.user.id })
    .populate({
      path: 'products',
      select: 'name price image ratings averageRating' // Added averageRating as it's common
    });

  if (!wishlist) {
    // Return empty wishlist if none exists
    return res.status(200).json({ success: true, count: 0, data: { products: [] } });
  }

  res.status(200).json({
    success: true,
    count: wishlist.products.length,
    data: wishlist
  });
});

// @desc    Clear user wishlist
// @route   DELETE /api/v1/wishlist
// @access  Private
exports.clearWishlist = asyncHandler(async (req, res, next) => {
  const wishlist = await Wishlist.findOneAndDelete({ user: req.user.id });

  if (!wishlist) {
    return next(new ErrorResponse('Wishlist not found for this user', 404));
  }

  res.status(200).json({
    success: true,
    message: 'Wishlist cleared',
    data: {}
  });
});

// @desc    Check if a product is in the user's wishlist
// @route   GET /api/v1/wishlist/check/:productId
// @access  Private
exports.checkWishlistStatus = asyncHandler(async (req, res, next) => {
  const { productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(new ErrorResponse('Invalid product ID', 400));
  }

  const wishlist = await Wishlist.findOne({ user: req.user.id, products: productId });

  const isInWishlist = !!wishlist; // True if wishlist exists and contains product, false otherwise

  res.status(200).json({
    success: true,
    data: { productId, isInWishlist }
  });
});