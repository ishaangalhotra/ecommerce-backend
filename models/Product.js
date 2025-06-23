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
  imageUrl: { // Changed from 'image' to 'imageUrl' for clarity
    type: String,
    required: false // Or true if every product must have an image
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
    min: 0 // Ensure stock doesn't go below 0
  },
  rating: { // Optional: for average rating from reviews
    type: Number,
    default: 0
  },
  numReviews: { // Optional: for number of reviews
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Product', ProductSchema);