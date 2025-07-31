const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative'],
    set: val => Math.round(val * 100) / 100 // Round to 2 decimal places
  },
  
  discountPercentage: {
    type: Number,
    default: 0,
    min: [0, 'Discount cannot be negative'],
    max: [100, 'Discount cannot exceed 100%']
  },
  
  images: [{
    url: {
      type: String,
      required: true
    },
    publicId: String,
    alt: String
  }],
  
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product category is required']
  },
  
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Product seller is required']
  },
  
  stock: {
    type: Number,
    required: [true, 'Stock quantity is required'],
    min: [0, 'Stock cannot be negative'],
    default: 0
  },
  
  unit: {
    type: String,
    enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'packet', 'box', 'dozen'],
    default: 'piece'
  },
  
  weight: {
    type: Number,
    min: [0, 'Weight cannot be negative']
  },
  
  dimensions: {
    length: Number,
    width: Number,
    height: Number,
    unit: {
      type: String,
      enum: ['cm', 'inch'],
      default: 'cm'
    }
  },
  
  // Rating and Reviews
  averageRating: {
    type: Number,
    default: 0,
    min: [0, 'Rating cannot be negative'],
    max: [5, 'Rating cannot exceed 5']
  },
  
  totalReviews: {
    type: Number,
    default: 0,
    min: [0, 'Review count cannot be negative']
  },
  
  // SEO and Search
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  
  tags: [String],
  
  // Status and Visibility
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending', 'rejected'],
    default: 'pending'
  },
  
  isDeleted: {
    type: Boolean,
    default: false
  },
  
  deletedAt: Date,
  
  // Analytics
  views: {
    type: Number,
    default: 0,
    min: 0
  },
  
  totalSales: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Additional Info
  brand: String,
  
  sku: {
    type: String,
    unique: true,
    sparse: true
  },
  
  specifications: {
    type: Map,
    of: String
  },
  
  expiryDate: Date,
  
  // Delivery Info
  deliveryInfo: {
    isLocalDeliveryEnabled: {
      type: Boolean,
      default: true
    },
    preparationTime: {
      type: Number,
      default: 10, // minutes
      min: 5,
      max: 60
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.__v;
      delete ret.isDeleted;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// ==================== INDEXES ====================
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1, status: 1, isDeleted: 1 });
productSchema.index({ seller: 1, status: 1, isDeleted: 1 });
productSchema.index({ status: 1, isDeleted: 1, createdAt: -1 });
productSchema.index({ price: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ totalSales: -1 });
productSchema.index({ views: -1 });

// ==================== VIRTUALS ====================
productSchema.virtual('finalPrice').get(function() {
  if (this.discountPercentage > 0) {
    return this.price - (this.price * this.discountPercentage / 100);
  }
  return this.price;
});

productSchema.virtual('isOnSale').get(function() {
  return this.discountPercentage > 0;
});

productSchema.virtual('isInStock').get(function() {
  return this.stock > 0;
});

productSchema.virtual('estimatedDelivery').get(function() {
  return `${this.deliveryInfo.preparationTime} mins`;
});

// ==================== MIDDLEWARE ====================
// Generate slug before saving
productSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
  next();
});

// Generate SKU if not provided
productSchema.pre('save', function(next) {
  if (this.isNew && !this.sku) {
    this.sku = `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }
  next();
});

// Exclude deleted products from queries
productSchema.pre(/^find/, function(next) {
  this.where({ isDeleted: false });
  next();
});

// ==================== STATIC METHODS ====================
productSchema.statics.getActiveProducts = function(filters = {}) {
  return this.find({
    ...filters,
    status: 'active',
    isDeleted: false
  });
};

productSchema.statics.searchProducts = function(searchTerm, filters = {}) {
  return this.find({
    $text: { $search: searchTerm },
    status: 'active',
    isDeleted: false,
    ...filters
  }, {
    score: { $meta: 'textScore' }
  }).sort({ score: { $meta: 'textScore' } });
};

productSchema.statics.getProductsByCategory = function(categoryId, options = {}) {
  const { page = 1, limit = 20, sort = { createdAt: -1 } } = options;
  const skip = (page - 1) * limit;
  
  return this.find({
    category: categoryId,
    status: 'active',
    isDeleted: false
  })
  .populate('category', 'name slug')
  .populate('seller', 'name rating verified')
  .sort(sort)
  .skip(skip)
  .limit(limit);
};

// ==================== INSTANCE METHODS ====================
productSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save({ validateBeforeSave: false });
};

productSchema.methods.updateStock = function(quantity) {
  this.stock = Math.max(0, this.stock + quantity);
  return this.save();
};

productSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Product', productSchema);