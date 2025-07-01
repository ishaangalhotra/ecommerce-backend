const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    default: 0
  },
  imageUrl: { // Changed from 'image' to 'imageUrl' for clarity and consistency
    type: String,
    required: false
  },
  category: {
    type: String,
    required: false,
    trim: true
  },
  countInStock: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  rating: {
    type: Number,
    default: 0
  },
  numReviews: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Product', ProductSchema);