const Product = require('../models/Product');
const asyncHandler = require('express-async-handler');

// @desc    Fetch all products
// @route   GET /api/products
// @access  Public
exports.getProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({});
  res.json(products);
});

// @desc    Create a new product
// @route   POST /api/products
// @access  Private (Seller/Admin)
exports.createProduct = asyncHandler(async (req, res) => {
  const { name, description, price, imageUrl, countInStock } = req.body;

  // Basic validation
  if (!name || !description || !price || !imageUrl || countInStock === undefined) {
    res.status(400);
    throw new Error('Please fill all product fields');
  }

  // Create new product instance
  const product = new Product({
    user: req.user.id, // Assign the product to the logged-in seller/admin (req.user.id from protect middleware)
    name,
    description,
    price,
    imageUrl,
    countInStock,
  });

  const createdProduct = await product.save();
  res.status(201).json(createdProduct);
});

// @desc    Fetch single product by ID
// @route   GET /api/products/:id
// @access  Public
exports.getProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (product) {
    res.json(product);
  } else {
    res.status(404);
    throw new Error('Product not found');
  }
});

// @desc    Delete a product (Admin/Seller)
// @route   DELETE /api/products/:id
// @access  Private/Admin/Seller
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (product) {
    // Only allow the owner or admin to delete
    if (req.user.role === 'admin' || (req.user.role === 'seller' && product.user.toString() === req.user.id.toString())) {
      await Product.deleteOne({ _id: product._id }); // Use deleteOne for Mongoose 6+
      res.json({ message: 'Product removed' });
    } else {
      res.status(403);
      throw new Error('Not authorized to delete this product');
    }
  } else {
    res.status(404);
    throw new Error('Product not found');
  }
});

// @desc    Update a product (Admin/Seller)
// @route   PUT /api/products/:id
// @access  Private/Admin/Seller
exports.updateProduct = asyncHandler(async (req, res) => {
  const { name, description, price, imageUrl, countInStock } = req.body;

  const product = await Product.findById(req.params.id);

  if (product) {
    // Only allow the owner or admin to update
    if (req.user.role === 'admin' || (req.user.role === 'seller' && product.user.toString() === req.user.id.toString())) {
      product.name = name || product.name;
      product.description = description || product.description;
      product.price = price || product.price;
      product.imageUrl = imageUrl || product.imageUrl;
      product.countInStock = countInStock !== undefined ? countInStock : product.countInStock;

      const updatedProduct = await product.save();
      res.json(updatedProduct);
    } else {
      res.status(403);
      throw new Error('Not authorized to update this product');
    }
  } else {
    res.status(404);
    throw new Error('Product not found');
  }
});