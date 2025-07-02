const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  user: { // Link to the User who created the product (seller/admin)
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
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
  imageUrl: { // Changed from 'image' to 'imageUrl' for consistency
    type: String,
    required: true // Making image URL required for product creation
  },
  category: { // Optional: for product categories
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
  rating: { // Optional: for average rating
    type: Number,
    default: 0
  },
  numReviews: { // Optional: number of reviews
    type: Number,
    default: 0
  },
}, {
  timestamps: true // Automatically adds createdAt and updatedAt fields
});

module.exports = mongoose.model('Product', ProductSchema);