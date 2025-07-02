const Product = require('../models/Product');

// @desc    Create a new product
// @route   POST /api/products
// @access  Private (requires authentication)
const createProduct = async (req, res) => {
  const { name, description, price, image } = req.body;

  if (!name || !description || !price || !image) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  const product = new Product({
    name,
    description,
    price,
    image,
    // Add seller/user ID if you want to track who uploaded it
    // user: req.user._id,
  });

  try {
    const newProduct = await product.save();
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
};

// @desc    Get all products
// @route   GET /api/products
// @access  Public
const getProducts = async (req, res) => {
  try {
    const products = await Product.find({});
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
};

module.exports = {
  createProduct,
  getProducts,
};