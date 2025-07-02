const Product = require("../models/Product");

exports.getAllProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch products" });
  }
};

exports.createProduct = async (req, res) => {
  if (req.user.role !== "seller" && req.user.role !== "admin") {
    return res.status(403).json({ message: "Only sellers or admins can upload products" });
  }

  const { name, description, price, imageUrl, countInStock, category } = req.body;

  if (!name || !price || !imageUrl) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const newProduct = new Product({
      name,
      description,
      price,
      imageUrl,
      countInStock,
      category,
      seller: req.user.id,
    });

    const saved = await newProduct.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: "Error saving product" });
  }
};
