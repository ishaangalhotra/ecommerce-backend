const Product = require('../models/Product');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

// @desc    Compare products
// @route   GET /api/compare?ids=id1,id2,id3
// @access  Public
exports.compareProducts = asyncHandler(async (req, res, next) => {
  const { ids } = req.query;
  if (!ids) return next(new ErrorResponse('Product IDs required', 400));

  const productIds = ids.split(',');
  if (productIds.length > 4) {
    return next(new ErrorResponse('Maximum 4 products can be compared', 400));
  }

  const products = await Product.find({ 
    _id: { $in: productIds } 
  }).select('name price image specifications');

  // Generate comparison matrix
  const specifications = {};
  products.forEach(product => {
    Object.entries(product.specifications).forEach(([key, value]) => {
      if (!specifications[key]) specifications[key] = {};
      specifications[key][product._id] = value;
    });
  });

  res.status(200).json({
    success: true,
    count: products.length,
    data: { products, specifications }
  });
});