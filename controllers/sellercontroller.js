// controllers/sellerController.js
const Product = require('../models/Product');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const path = require('path');

// @desc    Upload a product
// @route   POST /api/v1/seller/products
// @access  Private (Seller/Admin)
exports.uploadProduct = asyncHandler(async (req, res, next) => {
  const { name, description, price, category, countInStock } = req.body;

  if (!name || !price || !description || !category) {
    return next(new ErrorResponse('Missing required fields', 400));
  }

  if (!req.file) {
    return next(new ErrorResponse('Product image required', 400));
  }

  const product = await Product.create({
    name,
    description,
    price,
    category,
    countInStock: countInStock || 0,
    image: `/uploads/${req.file.filename}`,
    user: req.user.id
  });

  res.status(201).json({ success: true, data: product });
});

// @desc    Get seller's products
exports.getMyProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ user: req.user.id });
  res.status(200).json({ success: true, count: products.length, data: products });
});

// @desc    Update product
exports.updateProduct = asyncHandler(async (req, res, next) => {
  let product = await Product.findById(req.params.id);
  if (!product) return next(new ErrorResponse('Product not found', 404));
  if (product.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new ErrorResponse('Not authorized', 403));
  }

  product = await Product.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true
  });

  res.status(200).json({ success: true, data: product });
});

// @desc    Delete product
exports.deleteProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(new ErrorResponse('Product not found', 404));
  if (product.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new ErrorResponse('Not authorized', 403));
  }

  await product.remove();
  res.status(200).json({ success: true, data: {} });
});
