const Product = require('../models/Product');
const Order = require('../models/Order');
const asyncHandler = require('express-async-Handler');
const logger = require('../utils/logger');
const { deleteImage } = require('../utils/cloudinary'); // If using cloud storage

// Helper: Validate seller owns product
const validateProductOwnership = async (productId, sellerId) => {
  const product = await Product.findOne({ _id: productId, seller: sellerId });
  if (!product) throw new Error('Product not found or unauthorized');
  return product;
};

// @desc    Upload new product
// @route   POST /api/seller/products
// @access  Private/Seller
exports.uploadProduct = asyncHandler(async (req, res) => {
  const { name, description, price, category, stock } = req.body;

  // Validate required fields
  if (!name || !price || !category) {
    logger.warn('Missing required fields', { body: req.body });
    return res.status(400).json({ 
      success: false, 
      message: 'Name, price, and category are required' 
    });
  }

  try {
    const product = await Product.create({
      seller: req.user.id,
      name: name.trim(),
      description: description?.trim(),
      price: parseFloat(price).toFixed(2), // Ensure 2 decimal places
      category: category.trim(),
      stock: parseInt(stock) || 0,
      images: req.files?.map(file => ({
        url: file.path,
        publicId: file.filename
      })) || []
    });

    logger.info(`Product created: ${product._id} by seller ${req.user.id}`);
    
    res.status(201).json({
      success: true,
      data: {
        id: product._id,
        name: product.name,
        price: product.price,
        stock: product.stock
        // Exclude sensitive/unnecessary fields
      }
    });

  } catch (err) {
    logger.error('Product creation failed', { error: err.stack });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create product. Please try again.' 
    });
  }
});

// @desc    Get seller's products (with pagination)
// @route   GET /api/seller/products
// @access  Private/Seller
exports.getMyProducts = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const [products, total] = await Promise.all([
    Product.find({ seller: req.user.id })
      .skip(skip)
      .limit(limit)
      .select('-__v'), // Exclude version key
    Product.countDocuments({ seller: req.user.id })
  ]);

  res.status(200).json({
    success: true,
    count: products.length,
    total,
    pages: Math.ceil(total / limit),
    currentPage: page,
    data: products
  });
});

// @desc    Update product
// @route   PUT /api/seller/products/:id
// @access  Private/Seller
exports.updateProduct = asyncHandler(async (req, res) => {
  try {
    const product = await validateProductOwnership(req.params.id, req.user.id);
    const updates = req.body;

    // Apply updates
    if (updates.name) product.name = updates.name.trim();
    if (updates.description) product.description = updates.description.trim();
    if (updates.price) product.price = parseFloat(updates.price).toFixed(2);
    if (updates.category) product.category = updates.category.trim();
    if (updates.stock) product.stock = parseInt(updates.stock);

    // Handle image updates (if needed)
    if (req.files?.length) {
      // Delete old images from storage (example for Cloudinary)
      // await Promise.all(product.images.map(img => deleteImage(img.publicId)));
      product.images = req.files.map(file => ({
        url: file.path,
        publicId: file.filename
      }));
    }

    const updatedProduct = await product.save();
    logger.info(`Product updated: ${updatedProduct._id}`);

    res.status(200).json({ 
      success: true, 
      data: updatedProduct 
    });

  } catch (err) {
    logger.error('Product update failed', { 
      productId: req.params.id, 
      error: err.message 
    });
    res.status(err.message.includes('not found') ? 404 : 500).json({
      success: false,
      message: err.message
    });
  }
});

// @desc    Delete product (+ clean up images)
// @route   DELETE /api/seller/products/:id
// @access  Private/Seller
exports.deleteProduct = asyncHandler(async (req, res) => {
  try {
    const product = await validateProductOwnership(req.params.id, req.user.id);
    
    // Optional: Delete associated images from storage
    // await Promise.all(product.images.map(img => deleteImage(img.publicId)));
    
    await product.deleteOne();
    logger.info(`Product deleted: ${req.params.id}`);

    res.status(200).json({ 
      success: true, 
      message: 'Product deleted successfully' 
    });

  } catch (err) {
    logger.error('Product deletion failed', { 
      productId: req.params.id, 
      error: err.message 
    });
    res.status(err.message.includes('not found') ? 404 : 500).json({
      success: false,
      message: err.message
    });
  }
});

// @desc    Get seller dashboard stats (enhanced)
// @route   GET /api/seller/dashboard
// @access  Private/Seller
exports.getSellerDashboard = asyncHandler(async (req, res) => {
  try {
    const [products, orders, revenue] = await Promise.all([
      Product.countDocuments({ seller: req.user.id }),
      Order.countDocuments({ 'products.seller': req.user.id }),
      Order.aggregate([
        { $match: { 'products.seller': req.user.id } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        products,
        orders,
        revenue: revenue[0]?.total || 0
      }
    });

  } catch (err) {
    logger.error('Dashboard stats failed', { error: err.stack });
    res.status(500).json({ 
      success: false, 
      message: 'Failed to load dashboard data' 
    });
  }
});