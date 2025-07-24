const mongoose = require('mongoose');
const slugify = require('slugify');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    lowercase: true
  },
  description: {
    type: String,
    trim: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    main: { type: String },
    subcategory: { type: String },
    tags: [String]
  },
  pricing: {
    basePrice: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    finalPrice: { type: Number }
  },
  images: [
    {
      url: String,
      publicId: String
    }
  ],
  inventory: {
    stock: { type: Number, default: 0 },
    sku: { type: String },
    variants: [
      {
        name: String,
        options: [String]
      }
    ]
  },
  shipping: {
    weight: Number,
    dimensions: {
      length: Number,
      width: Number,
      height: Number
    },
    location: String
  },
  rating: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },
  analytics: {
    totalSold: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 }
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },
  isPublished: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  metadata: {
    tags: [String],
    brand: String,
    warranty: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ✅ Slug generation
productSchema.pre('save', async function (next) {
  if (!this.isModified('name')) return next();
  const baseSlug = slugify(this.name, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;
  
  // FIXED: Corrected the syntax error (_id instead of *id)
  while (await this.constructor.findOne({ slug, _id: { $ne: this._id } })) {
    slug = `${baseSlug}-${counter++}`;
  }
  this.slug = slug;
  next();
});

// ✅ Calculate final price before save
productSchema.pre('save', function (next) {
  if (this.isModified('pricing.basePrice') || this.isModified('pricing.discount') || this.isModified('pricing.tax')) {
    const discountAmount = (this.pricing.basePrice * this.pricing.discount) / 100;
    const priceAfterDiscount = this.pricing.basePrice - discountAmount;
    const taxAmount = (priceAfterDiscount * this.pricing.tax) / 100;
    this.pricing.finalPrice = priceAfterDiscount + taxAmount;
  }
  next();
});

// ✅ Virtual: product URL
productSchema.virtual('url').get(function () {
  return `/products/${this.slug}`;
});

// ✅ Virtual: discount percentage
productSchema.virtual('discountPercentage').get(function () {
  return this.pricing.discount || 0;
});

// ✅ Virtual: is in stock
productSchema.virtual('inStock').get(function () {
  return this.inventory.stock > 0;
});

// ✅ FIXED: Complete indexes - schema-level only (no field-level)
// Core unique index for slug
productSchema.index({ slug: 1 }, { unique: true });

// Text search index
productSchema.index({ name: 'text', description: 'text', 'category.tags': 'text' }, {
  weights: {
    name: 10,
    description: 5,
    'category.tags': 2
  },
  name: 'product_text_index'
});

// Performance indexes
productSchema.index({ seller: 1, status: 1 });
productSchema.index({ 'category.main': 1, 'category.subcategory': 1 });
productSchema.index({ 'pricing.basePrice': 1 });
productSchema.index({ 'pricing.finalPrice': 1 });
productSchema.index({ 'rating.average': -1 });
productSchema.index({ isFeatured: 1, isPublished: 1 });
productSchema.index({ 'inventory.stock': 1, status: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ 'analytics.totalSold': -1 });

// Compound indexes for common queries
productSchema.index({ status: 1, isPublished: 1, createdAt: -1 });
productSchema.index({ 'category.main': 1, 'pricing.finalPrice': 1 });
productSchema.index({ seller: 1, createdAt: -1 });

// ✅ Instance Methods
productSchema.methods.updateViews = function() {
  this.analytics.views += 1;
  return this.save();
};

productSchema.methods.updateClicks = function() {
  this.analytics.clicks += 1;
  return this.save();
};

productSchema.methods.updateSoldCount = function(quantity = 1) {
  this.analytics.totalSold += quantity;
  return this.save();
};

productSchema.methods.updateStock = function(quantity) {
  this.inventory.stock = Math.max(0, this.inventory.stock + quantity);
  return this.save();
};

// ✅ Static Methods
productSchema.statics.findByCategory = function(category) {
  return this.find({ 'category.main': category, isPublished: true });
};

productSchema.statics.findBySeller = function(sellerId) {
  return this.find({ seller: sellerId }).sort({ createdAt: -1 });
};

productSchema.statics.findFeatured = function(limit = 10) {
  return this.find({ isFeatured: true, isPublished: true })
    .sort({ 'rating.average': -1 })
    .limit(limit);
};

productSchema.statics.search = function(query, options = {}) {
  const searchOptions = {
    $text: { $search: query }
  };
  
  if (options.category) {
    searchOptions['category.main'] = options.category;
  }
  
  if (options.minPrice || options.maxPrice) {
    searchOptions['pricing.finalPrice'] = {};
    if (options.minPrice) searchOptions['pricing.finalPrice'].$gte = options.minPrice;
    if (options.maxPrice) searchOptions['pricing.finalPrice'].$lte = options.maxPrice;
  }
  
  return this.find(searchOptions)
    .sort({ score: { $meta: 'textScore' } })
    .limit(options.limit || 20);
};

module.exports = mongoose.model('Product', productSchema);