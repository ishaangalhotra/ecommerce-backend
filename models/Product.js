const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  image: String // optional: for product image URLs
});

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
