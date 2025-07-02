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
  if (req.user.role !== "seller") {
    return res.status(403).json({ message: "Only sellers can upload products" });
  }

  const { name, description, price, image } = req.body;
  if (!name || !price || !image) {
    return res.status(400).json({ message: "Please provide all required fields" });
  }

  try {
    const product = new Product({
      name,
      description,
      price,
      image,
      seller: req.user.id,
    });

    const saved = await product.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: "Product upload failed" });
  }
};