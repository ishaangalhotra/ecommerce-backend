const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    minlength: [2, 'Category name must be at least 2 characters long'],
    maxlength: [100, 'Category name must be less than 100 characters'],
  },
  slug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
    // removed unique: true to prevent duplicate index warning
  },
  description: {
    type: String,
    maxlength: [500, 'Description must be less than 500 characters'],
  },
  image: {
    type: String,
    default: null,
  },
  parentCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
}, {
  timestamps: true
});

// Keep only the explicit index definition
categorySchema.index({ slug: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);
