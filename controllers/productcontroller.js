const asyncHandler = require('../middleware/asyncHandler');
const Product = require('../models/Product');
const logger = require('../utils/logger');
const { NotFoundError } = require('../utils/error');
const { body, validationResult } = require('express-validator');

// Validation middleware
exports.validateProduct = [
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('price').isFloat({ gt: 0 }).withMessage('Valid price required'),
  body('category').notEmpty().withMessage('Category is required'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        errors: errors.array() 
      });
    }
    next();
  }
];

// Get all products with pagination
exports.getProducts = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find()
      .skip(skip)
      .limit(limit)
      .select('name price category'), // Only select needed fields
    Product.countDocuments()
  ]);

  logger.info('Fetched products', { 
    count: products.length,
    page,
    limit 
  });

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    pages: Math.ceil(total / limit),
    currentPage: page,
    data: products
  });
});

// Get single product with security filtering
exports.getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .select('-__v -createdAt -updatedAt'); // Exclude unnecessary fields

  if (!product) {
    throw new NotFoundError('Product not found');
  }

  logger.info('Fetched product', { productId: req.params.id });

  res.status(200).json({
    success: true,
    data: {
      id: product._id,
      name: product.name,
      price: product.price,
      category: product.category,
      description: product.description
      // Only expose what's needed
    }
  });
});

// Create product (with validation middleware)
exports.createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create(req.body);
  
  logger.info('Product created', { 
    productId: product._id,
    createdBy: req.user?.id 
  });

  res.status(201).json({
    success: true,
    data: {
      id: product._id,
      name: product.name,
      price: product.price
    }
  });
});

// Update product
exports.updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    req.body,
    { 
      new: true,
      runValidators: true,
      select: 'name price category description' // Return only these fields
    }
  );

  if (!product) {
    throw new NotFoundError('Product not found');
  }

  logger.info('Product updated', { 
    productId: req.params.id,
    updatedBy: req.user?.id 
  });

  res.status(200).json({
    success: true,
    data: product
  });
});

// Delete product
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);

  if (!product) {
    throw new NotFoundError('Product not found');
  }

  logger.info('Product deleted', { 
    productId: req.params.id,
    deletedBy: req.user?.id 
  });

  res.status(200).json({
    success: true,
    data: null
  });
});