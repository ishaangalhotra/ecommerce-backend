const mongoose = require('mongoose');
const slugify = require('slugify');
const validator = require('validator');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [120, 'Product name cannot exceed 120 characters'],
    minlength: [3, 'Product name must be at least 3 characters'],
    unique: true
  },
  slug: {
    type: String,
    unique: true,
    index: true
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  shortDescription: {
    type: String,
    trim: true,
    maxlength: [200, 'Short description cannot exceed 200 characters']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0.01, 'Price must be at least 0.01'],
    set: v => Math.round(v * 100) / 100 // Store prices with 2 decimal precision
  },
  discountedPrice: {
    type: Number,
    validate: {
      validator: function(value) {
        return value === null || (value < this.price && value >= 0);
      },
      message: 'Discounted price must be less than regular price and non-negative'
    },
    default: null
  },
  images: [{
    type: String,
    validate: {
      validator: function(v) {
        return validator.isURL(v, {
          protocols: ['http', 'https'],
          require_protocol: true
        });
      },
      message: 'Invalid image URL'
    }
  }],
  mainImage: {
    type: String,
    required: [true, 'Main product image is required'],
    validate: {
      validator: function(v) {
        return validator.isURL(v, {
          protocols: ['http', 'https'],
          require_protocol: true
        });
      },
      message: 'Invalid main image URL'
    }
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product category is required']
  },
  subCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubCategory'
  },
  stock: {
    type: Number,
    required: [true, 'Stock quantity is required'],
    min: [0, 'Stock cannot be negative'],
    default: 0
  },
  sku: {
    type: String,
    unique: true,
    uppercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[A-Z0-9\-_]{6,20}$/.test(v);
      },
      message: 'SKU must be 6-20 characters (letters, numbers, hyphens, underscores)'
    }
  },
  brand: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand'
  },
  ratingsAverage: {
    type: Number,
    default: 0,
    min: [0, 'Rating must be at least 0'],
    max: [5, 'Rating cannot exceed 5'],
    set: v => Math.round(v * 10) / 10 // Round to 1 decimal place
  },
  ratingsQuantity: {
    type: Number,
    default: 0
  },
  featured: {
    type: Boolean,
    default: false
  },
  active: {
    type: Boolean,
    default: true,
    select: false
  },
  attributes: [{
    name: {
      type: String,
      required: [true, 'Attribute name is required'],
      trim: true
    },
    value: {
      type: String,
      required: [true, 'Attribute value is required'],
      trim: true
    }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual property for discount percentage
productSchema.virtual('discountPercentage').get(function() {
  if (!this.discountedPrice) return 0;
  return Math.round(((this.price - this.discountedPrice) / this.price) * 100);
});

// Virtual populate reviews
productSchema.virtual('reviews', {
  ref: 'Review',
  foreignField: 'product',
  localField: '_id'
});

// Document middleware: runs before .save() and .create()
productSchema.pre('save', function(next) {
  this.slug = slugify(this.name, { lower: true, strict: true });
  next();
});

// Query middleware
productSchema.pre(/^find/, function(next) {
  this.find({ active: { $ne: false } });
  this.populate({
    path: 'category',
    select: 'name slug'
  }).populate({
    path: 'createdBy',
    select: 'name email'
  });
  next();
});

// Indexes for better performance
productSchema.index({ name: 'text', description: 'text', shortDescription: 'text' });
productSchema.index({ price: 1 });
productSchema.index({ discountedPrice: 1 });
productSchema.index({ category: 1 });
productSchema.index({ stock: 1 });
productSchema.index({ ratingsAverage: -1 });
productSchema.index({ createdAt: -1 });

// Static method for calculating ratings
productSchema.statics.calcAverageRatings = async function(productId) {
  const stats = await this.model('Review').aggregate([
    { $match: { product: productId } },
    {
      $group: {
        _id: '$product',
        nRating: { $sum: 1 },
        avgRating: { $avg: '$rating' }
      }
    }
  ]);

  if (stats.length > 0) {
    await this.findByIdAndUpdate(productId, {
      ratingsQuantity: stats[0].nRating,
      ratingsAverage: stats[0].avgRating
    });
  } else {
    await this.findByIdAndUpdate(productId, {
      ratingsQuantity: 0,
      ratingsAverage: 0
    });
  }
};

module.exports = mongoose.model('Product', productSchema);