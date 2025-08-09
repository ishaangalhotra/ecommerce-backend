// models/Collection.js - Product Collections System

const mongoose = require('mongoose');
const slugify = require('slugify');

const collectionSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Collection name is required'],
    trim: true,
    maxlength: [100, 'Collection name cannot exceed 100 characters'],
    index: true
  },
  
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  
  shortDescription: {
    type: String,
    trim: true,
    maxlength: [300, 'Short description cannot exceed 300 characters']
  },
  
  // Collection Type
  type: {
    type: String,
    enum: ['manual', 'automatic', 'seasonal', 'promotional'],
    default: 'manual',
    index: true
  },
  
  // Images
  images: [{
    url: { type: String, required: true },
    alt: String,
    isPrimary: { type: Boolean, default: false },
    position: { type: Number, default: 0 }
  }],
  
  banner: {
    desktop: String,
    mobile: String,
    alt: String
  },
  
  // Manual Collection - Products added manually
  products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductAdvanced' }],
  
  // Automatic Collection - Products added based on rules
  rules: [{
    field: { 
      type: String, 
      enum: ['category', 'brand', 'price', 'tags', 'rating', 'stock', 'created_date'] 
    },
    operator: { 
      type: String, 
      enum: ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in'] 
    },
    value: mongoose.Schema.Types.Mixed,
    condition: { type: String, enum: ['and', 'or'], default: 'and' }
  }],
  
  // Sorting
  sortBy: {
    field: { 
      type: String, 
      enum: ['created_date', 'updated_date', 'price', 'rating', 'popularity', 'name', 'manual'],
      default: 'manual'
    },
    order: { type: String, enum: ['asc', 'desc'], default: 'desc' }
  },
  
  // Visibility & Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'draft', 'scheduled'],
    default: 'draft',
    index: true
  },
  
  visibility: {
    type: String,
    enum: ['public', 'private', 'hidden'],
    default: 'public',
    index: true
  },
  
  // Scheduling
  publishedAt: Date,
  scheduledAt: Date,
  expiresAt: Date,
  
  // SEO
  seo: {
    metaTitle: { type: String, maxlength: 60 },
    metaDescription: { type: String, maxlength: 160 },
    keywords: [String],
    canonicalUrl: String,
    ogImage: String
  },
  
  // Analytics
  analytics: {
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }
  },
  
  // Display Settings
  displaySettings: {
    itemsPerPage: { type: Number, default: 20, min: 1, max: 100 },
    showFilters: { type: Boolean, default: true },
    showSorting: { type: Boolean, default: true },
    layoutType: { type: String, enum: ['grid', 'list', 'carousel'], default: 'grid' },
    gridColumns: { type: Number, default: 4, min: 1, max: 6 }
  },
  
  // Featured Collection
  isFeatured: { type: Boolean, default: false, index: true },
  featuredPosition: Number,
  
  // Tags & Categories
  tags: [String],
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  
  // Audit
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
collectionSchema.index({ name: 'text', description: 'text', tags: 'text' });
collectionSchema.index({ type: 1, status: 1 });
collectionSchema.index({ isFeatured: 1, featuredPosition: 1 });
collectionSchema.index({ publishedAt: -1 });

// Virtuals
collectionSchema.virtual('productCount').get(function() {
  return this.products ? this.products.length : 0;
});

collectionSchema.virtual('isActive').get(function() {
  const now = new Date();
  return this.status === 'active' && 
         (!this.expiresAt || this.expiresAt > now) &&
         (!this.publishedAt || this.publishedAt <= now);
});

// Middleware
collectionSchema.pre('save', async function(next) {
  // Generate slug
  if (this.isModified('name')) {
    const baseSlug = slugify(this.name, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    
    while (await this.constructor.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    this.slug = slug;
  }
  
  // Auto-populate SEO
  if (!this.seo.metaTitle) {
    this.seo.metaTitle = this.name;
  }
  
  if (!this.seo.metaDescription && this.shortDescription) {
    this.seo.metaDescription = this.shortDescription;
  }
  
  // Set published date for active collections
  if (this.isModified('status') && this.status === 'active' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  
  next();
});

// Methods
collectionSchema.methods.getProducts = async function(options = {}) {
  const ProductAdvanced = mongoose.model('ProductAdvanced');
  
  if (this.type === 'manual') {
    // Return manually selected products
    return ProductAdvanced.find({ 
      _id: { $in: this.products },
      status: 'active',
      isDeleted: false
    })
    .limit(options.limit || 50)
    .skip(options.skip || 0)
    .populate('brand', 'name logo')
    .populate('category', 'name');
  }
  
  if (this.type === 'automatic') {
    // Build query from rules
    const query = { status: 'active', isDeleted: false };
    
    for (const rule of this.rules) {
      let value = rule.value;
      
      switch (rule.operator) {
        case 'equals':
          query[rule.field] = value;
          break;
        case 'not_equals':
          query[rule.field] = { $ne: value };
          break;
        case 'contains':
          query[rule.field] = { $regex: value, $options: 'i' };
          break;
        case 'not_contains':
          query[rule.field] = { $not: { $regex: value, $options: 'i' } };
          break;
        case 'greater_than':
          query[rule.field] = { $gt: value };
          break;
        case 'less_than':
          query[rule.field] = { $lt: value };
          break;
        case 'in':
          query[rule.field] = { $in: Array.isArray(value) ? value : [value] };
          break;
        case 'not_in':
          query[rule.field] = { $nin: Array.isArray(value) ? value : [value] };
          break;
      }
    }
    
    // Apply sorting
    let sort = {};
    switch (this.sortBy.field) {
      case 'created_date':
        sort.createdAt = this.sortBy.order === 'asc' ? 1 : -1;
        break;
      case 'price':
        sort.basePrice = this.sortBy.order === 'asc' ? 1 : -1;
        break;
      case 'rating':
        sort['reviews.averageRating'] = this.sortBy.order === 'asc' ? 1 : -1;
        break;
      case 'popularity':
        sort['analytics.views'] = this.sortBy.order === 'asc' ? 1 : -1;
        break;
      case 'name':
        sort.title = this.sortBy.order === 'asc' ? 1 : -1;
        break;
      default:
        sort.createdAt = -1;
    }
    
    return ProductAdvanced.find(query)
      .sort(sort)
      .limit(options.limit || 50)
      .skip(options.skip || 0)
      .populate('brand', 'name logo')
      .populate('category', 'name');
  }
  
  return [];
};

collectionSchema.methods.updateAnalytics = function(type, value = 1) {
  switch(type) {
    case 'view':
      this.analytics.views += value;
      break;
    case 'click':
      this.analytics.clicks += value;
      break;
    case 'conversion':
      this.analytics.conversions += value;
      break;
    case 'revenue':
      this.analytics.revenue += value;
      break;
  }
  return this.save();
};

// Static Methods
collectionSchema.statics.findFeatured = function(limit = 10) {
  return this.find({
    isFeatured: true,
    status: 'active',
    visibility: 'public'
  })
  .sort({ featuredPosition: 1, createdAt: -1 })
  .limit(limit);
};

collectionSchema.statics.findActive = function(options = {}) {
  const now = new Date();
  return this.find({
    status: 'active',
    visibility: 'public',
    $or: [
      { publishedAt: { $lte: now } },
      { publishedAt: null }
    ],
    $or: [
      { expiresAt: { $gt: now } },
      { expiresAt: null }
    ]
  })
  .sort(options.sort || { createdAt: -1 })
  .limit(options.limit || 50);
};

module.exports = mongoose.models.Collection || mongoose.model('Collection', collectionSchema);
