const ErrorResponse = require('../utils/errorResponse');
const Product = require('../models/Product');

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res, next) => {
  try {
    const products = await Product.find();
    res.status(200).json({ 
      success: true, 
      count: products.length, 
      data: products 
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found with ID ${req.params.id}`, 404));
    }
    res.status(200).json({ 
      success: true, 
      data: product 
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Create product
// @route   POST /api/products
// @access  Private (Admin/Seller)
exports.createProduct = async (req, res, next) => {
  try {
    // Attach seller ID from logged-in user
    req.body.seller = req.user.id; 
    const product = await Product.create(req.body);
    res.status(201).json({ 
      success: true, 
      data: product 
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private (Admin/Seller)
exports.updateProduct = async (req, res, next) => {
  try {
    let product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found`, 404));
    }

    // Verify ownership
    if (product.seller.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new ErrorResponse(`Not authorized to update this product`, 401));
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({ 
      success: true, 
      data: product 
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Admin/Seller)
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return next(new ErrorResponse(`Product not found`, 404));
    }

    // Verify ownership
    if (product.seller.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new ErrorResponse(`Not authorized to delete this product`, 401));
    }

    await product.remove();
    res.status(200).json({ 
      success: true, 
      data: {} 
    });
  } catch (err) {
    next(err);
  }
};