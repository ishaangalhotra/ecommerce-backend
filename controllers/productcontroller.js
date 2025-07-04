const Product = require('../models/Product');

exports.getProducts = async (req, res) => {
    const keyword = req.query.keyword ? {
        name: {
            $regex: req.query.keyword,
            $options: 'i' // case-insensitive
        }
    } : {};
  const products = await Product.find({...keyword});
  res.json(products);
};

exports.getProductById = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (product) {
    res.json(product);
  } else {
    res.status(404).json({ message: 'Product not found' });
  }
};

exports.createProduct = async (req, res) => {
    const { name, price, description, image, category, countInStock, originalPrice } = req.body;
    const product = new Product({
        name,
        price,
        originalPrice,
        description,
        image,
        category,
        countInStock,
        seller: req.user._id,
    });
    const createdProduct = await product.save();
    res.status(201).json(createdProduct);
};