// models/ProductAdvanced.js - Amazon/Flipkart Level Product System

const mongoose = require('mongoose');
const slugify = require('slugify');

// 🎨 Product Variant Schema
const variantSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g., "Red - Large", "128GB - Blue"
  type: { type: String, required: true, enum: ['color', 'size', 'material', 'capacity', 'style', 'flavor', 'custom'] },
  value: { type: String, required: true }, // e.g., "Red", "Large", "Cotton"
  sku: { type: String, unique: true, sparse: true },
  price: { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  images: [String],
  attributes: {
    color: String,
    colorCode: String, // Hex code
    size: String,
    material: String,
    weight: Number,
    dimensions: {
      length: Number,
      width: Number,
      height: Number
    }
  },
  isActive: { type: Boolean, default: true },
  position: { type: Number, default: 0 } // For sorting variants
});

// 📦 Bundle Product Schema
const bundleItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductAdvanced', required: true },
  variant: variantSchema,
  quantity: { type: Number, required: true, min: 1 },
  discountPercentage: { type: Number, default: 0, min: 0, max: 100 }
});

// 🏷️ Advanced Product Schema
const productAdvancedSchema = new mongoose.Schema({
  // Basic Information
  title: {
    type: String,
    required: [true, 'Product title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters'],
    index: true
  },
  subtitle: {
    type: String,
    trim: true,
    maxlength: [300, 'Subtitle cannot exceed 300 characters']
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    trim: true,
    maxlength: [5000, 'Description cannot exceed 5000 characters']
  },
  shortDescription: {
    type: String,
    trim: true,
    maxlength: [500, 'Short description cannot exceed 500 characters']
  },
  
  // Product Type
  productType: {
    type: String,
    required: true,
    enum: ['simple', 'variable', 'bundle', 'digital', 'subscription'],
    default: 'simple',
    index: true
  },
  
  // Pricing
  basePrice: { type: Number, required: true, min: 0 },
  minPrice: { type: Number, min: 0 }, // For variable products
  maxPrice: { type: Number, min: 0 }, // For variable products
  costPrice: { type: Number, min: 0 }, // For profit calculation
  
  // Variants (for variable products)
  variants: [variantSchema],
  variantAttributes: [{
    name: { type: String, required: true }, // e.g., "Color", "Size"
    type: { type: String, required: true, enum: ['color', 'size', 'material', 'capacity', 'style', 'flavor', 'custom'] },
    values: [String], // e.g., ["Red", "Blue", "Green"]
    isRequired: { type: Boolean, default: true },
    displayType: { type: String, enum: ['dropdown', 'color_swatch', 'image', 'button'], default: 'dropdown' }
  }],
  
  // Bundle Products
  bundleItems: [bundleItemSchema],
  bundleDiscount: { type: Number, default: 0, min: 0, max: 100 },
  bundleType: { type: String, enum: ['fixed', 'dynamic'], default: 'fixed' },
  
  // Media
  media: {
    images: [{
      url: { type: String, required: true },
      alt: String,
      title: String,
      isPrimary: { type: Boolean, default: false },
      variantId: mongoose.Schema.Types.ObjectId, // Link to specific variant
      position: { type: Number, default: 0 }
    }],
    videos: [{
      url: { type: String, required: true },
      thumbnail: String,
      title: String,
      duration: Number, // in seconds
      type: { type: String, enum: ['product_demo', 'unboxing', 'review', 'tutorial'], default: 'product_demo' }
    }],
    documents: [{
      url: { type: String, required: true },
      name: String,
      type: { type: String, enum: ['manual', 'warranty', 'certificate', 'specification'], required: true },
      size: Number // in bytes
    }]
  },
  
  // Category & Classification
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
  subcategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  brand: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Brand', 
    required: true,
    index: true 
  },
  
  // Product Identifiers
  sku: { type: String, unique: true, sparse: true, uppercase: true, index: true },
  upc: { type: String, unique: true, sparse: true },
  ean: { type: String, unique: true, sparse: true },
  isbn: { type: String, unique: true, sparse: true },
  mpn: String, // Manufacturer Part Number
  gtin: String, // Global Trade Item Number
  
  // Inventory Management
  inventory: {
    trackQuantity: { type: Boolean, default: true },
    quantity: { type: Number, default: 0, min: 0 },
    reservedQuantity: { type: Number, default: 0, min: 0 }, // Items in pending orders
    lowStockThreshold: { type: Number, default: 10, min: 0 },
    allowBackorders: { type: Boolean, default: false },
    backorderMessage: String,
    stockStatus: { 
      type: String, 
      enum: ['in_stock', 'out_of_stock', 'low_stock', 'on_backorder'], 
      default: 'in_stock',
      index: true 
    }
  },
  
  // Physical Properties
  physical: {
    weight: { type: Number, min: 0 }, // in grams
    dimensions: {
      length: { type: Number, min: 0 }, // in cm
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 }
    },
    volume: { type: Number, min: 0 }, // in cubic cm
    color: String,
    material: String,
    isFragile: { type: Boolean, default: false },
    requiresAssembly: { type: Boolean, default: false }
  },
  
  // Seller Information
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sellerInfo: {
    businessName: String,
    rating: { type: Number, min: 0, max: 5, default: 5 },
    totalProducts: { type: Number, default: 0 },
    yearsInBusiness: Number,
    returnPolicy: String,
    shippingPolicy: String
  },
  
  // Reviews & Ratings
  reviews: {
    averageRating: { type: Number, default: 0, min: 0, max: 5, index: true },
    totalReviews: { type: Number, default: 0, min: 0 },
    ratingDistribution: {
      1: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      5: { type: Number, default: 0 }
    },
    reviewSummary: {
      pros: [String],
      cons: [String],
      commonKeywords: [String]
    }
  },
  
  // SEO & Marketing
  seo: {
    slug: { type: String, unique: true, lowercase: true, index: true },
    metaTitle: { type: String, maxlength: 60 },
    metaDescription: { type: String, maxlength: 160 },
    keywords: [String],
    canonicalUrl: String,
    ogTitle: String,
    ogDescription: String,
    ogImage: String,
    structuredData: mongoose.Schema.Types.Mixed // JSON-LD structured data
  },
  
  // Specifications
  specifications: [{
    group: { type: String, required: true }, // e.g., "Technical Specs", "Design"
    attributes: [{
      name: { type: String, required: true },
      value: { type: String, required: true },
      unit: String,
      isHighlight: { type: Boolean, default: false }
    }]
  }],
  
  // Features & Benefits
  features: [{
    title: { type: String, required: true },
    description: String,
    icon: String,
    category: { type: String, enum: ['performance', 'design', 'sustainability', 'convenience', 'safety'] }
  }],
  
  // Compatibility & Requirements
  compatibility: {
    operatingSystem: [String],
    deviceTypes: [String],
    minimumRequirements: mongoose.Schema.Types.Mixed,
    recommendedRequirements: mongoose.Schema.Types.Mixed
  },
  
  // Shipping & Delivery
  shipping: {
    weight: Number, // Shipping weight (may differ from product weight)
    dimensions: {
      length: Number,
      width: Number,
      height: Number
    },
    shippingClass: { type: String, enum: ['standard', 'heavy', 'fragile', 'hazardous', 'oversized'], default: 'standard' },
    freeShipping: { type: Boolean, default: false },
    freeShippingThreshold: Number,
    shippingCost: Number,
    handlingTime: { type: Number, default: 1 }, // days
    allowedRegions: [String],
    restrictedRegions: [String]
  },
  
  // Taxes & Compliance
  tax: {
    taxable: { type: Boolean, default: true },
    taxClass: String,
    hsnCode: String, // For Indian GST
    gstRate: { type: Number, default: 18 },
    customsCode: String, // For international shipping
    countryOfOrigin: { type: String, default: 'India' }
  },
  
  // Warranty & Support
  warranty: {
    hasWarranty: { type: Boolean, default: false },
    duration: Number, // in months
    type: { type: String, enum: ['manufacturer', 'seller', 'extended'] },
    coverage: String,
    terms: String,
    registrationRequired: { type: Boolean, default: false }
  },
  
  // Digital Product Info
  digital: {
    isDigital: { type: Boolean, default: false },
    downloadable: { type: Boolean, default: false },
    files: [{
      name: String,
      url: String,
      size: Number, // in bytes
      format: String,
      downloadLimit: Number,
      expiryDays: Number
    }],
    licenseKey: String,
    activationInstructions: String
  },
  
  // Subscription Info
  subscription: {
    isSubscription: { type: Boolean, default: false },
    billingCycle: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'yearly'] },
    trialPeriod: Number, // in days
    setupFee: Number,
    cancellationPolicy: String,
    autoRenew: { type: Boolean, default: true }
  },
  
  // Analytics & Performance
  analytics: {
    views: { type: Number, default: 0, index: true },
    uniqueViews: { type: Number, default: 0 },
    cartAdds: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0 },
    bounceRate: { type: Number, default: 0 },
    averageTimeOnPage: { type: Number, default: 0 }, // in seconds
    searchKeywords: [String],
    referralSources: [String]
  },
  
  // Status & Visibility
  status: {
    type: String,
    enum: ['draft', 'pending_review', 'active', 'inactive', 'out_of_stock', 'discontinued', 'rejected'],
    default: 'draft',
    index: true
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'hidden', 'catalog_only'],
    default: 'public',
    index: true
  },
  
  // Promotional & Marketing
  promotion: {
    isFeatured: { type: Boolean, default: false, index: true },
    isNewArrival: { type: Boolean, default: false, index: true },
    isBestSeller: { type: Boolean, default: false, index: true },
    isOnSale: { type: Boolean, default: false, index: true },
    badges: [String], // e.g., "Best Seller", "New", "Limited Edition"
    tags: [String],
    collections: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Collection' }]
  },
  
  // Quality & Safety
  quality: {
    certifications: [String], // e.g., "ISO 9001", "CE", "FCC"
    safetyWarnings: [String],
    ageRestriction: Number, // minimum age
    allergens: [String],
    ingredients: [String], // for food/cosmetic products
    nutritionFacts: mongoose.Schema.Types.Mixed,
    materialSafety: String
  },
  
  // Sustainability
  sustainability: {
    isEcoFriendly: { type: Boolean, default: false },
    carbonFootprint: Number, // in kg CO2
    recyclable: { type: Boolean, default: false },
    sustainabilityScore: { type: Number, min: 0, max: 100 },
    certifications: [String], // e.g., "Fair Trade", "Organic"
  },
  
  // Related Products
  related: {
    crossSells: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductAdvanced' }],
    upSells: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductAdvanced' }],
    accessories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductAdvanced' }],
    alternatives: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductAdvanced' }],
    frequentlyBoughtTogether: [{
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductAdvanced' },
      frequency: { type: Number, default: 1 }
    }]
  },
  
  // Audit Trail
  audit: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectionReason: String,
    changeHistory: [{
      field: String,
      oldValue: mongoose.Schema.Types.Mixed,
      newValue: mongoose.Schema.Types.Mixed,
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      changedAt: { type: Date, default: Date.now },
      reason: String
    }]
  },
  
  // Soft Delete
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: Date,
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletionReason: String

}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// 📊 Indexes for Performance
productAdvancedSchema.index({ 'seo.slug': 1 });
productAdvancedSchema.index({ title: 'text', description: 'text', 'seo.keywords': 'text' });
productAdvancedSchema.index({ category: 1, status: 1, visibility: 1 });
productAdvancedSchema.index({ seller: 1, status: 1 });
productAdvancedSchema.index({ basePrice: 1, status: 1 });
productAdvancedSchema.index({ 'reviews.averageRating': -1, 'reviews.totalReviews': -1 });
productAdvancedSchema.index({ 'analytics.views': -1 });
productAdvancedSchema.index({ 'analytics.purchases': -1 });
productAdvancedSchema.index({ 'promotion.isFeatured': 1, status: 1 });
productAdvancedSchema.index({ 'promotion.isNewArrival': 1, createdAt: -1 });
productAdvancedSchema.index({ 'inventory.stockStatus': 1 });
productAdvancedSchema.index({ createdAt: -1 });
productAdvancedSchema.index({ updatedAt: -1 });
productAdvancedSchema.index({ brand: 1, category: 1 });

// 🔄 Virtuals
productAdvancedSchema.virtual('finalPrice').get(function() {
  if (this.productType === 'variable' && this.variants.length > 0) {
    return Math.min(...this.variants.map(v => v.price));
  }
  return this.basePrice;
});

productAdvancedSchema.virtual('maxVariantPrice').get(function() {
  if (this.productType === 'variable' && this.variants.length > 0) {
    return Math.max(...this.variants.map(v => v.price));
  }
  return this.basePrice;
});

productAdvancedSchema.virtual('totalStock').get(function() {
  if (this.productType === 'variable') {
    return this.variants.reduce((total, variant) => total + variant.stock, 0);
  }
  return this.inventory.quantity;
});

productAdvancedSchema.virtual('primaryImage').get(function() {
  const primaryImg = this.media.images.find(img => img.isPrimary);
  return primaryImg || this.media.images[0];
});

productAdvancedSchema.virtual('isInStock').get(function() {
  return this.inventory.stockStatus === 'in_stock' && this.status === 'active' && !this.isDeleted;
});

productAdvancedSchema.virtual('profitMargin').get(function() {
  if (this.costPrice && this.basePrice) {
    return ((this.basePrice - this.costPrice) / this.basePrice * 100).toFixed(2);
  }
  return 0;
});

// 🔧 Middleware
productAdvancedSchema.pre('save', async function(next) {
  // Generate slug
  if (this.isModified('title')) {
    const baseSlug = slugify(this.title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    
    while (await this.constructor.findOne({ 'seo.slug': slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    this.seo.slug = slug;
  }
  
  // Auto-generate SKU
  if (!this.sku) {
    this.sku = `PRD-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }
  
  // Update stock status
  if (this.isModified('inventory.quantity') || this.isModified('inventory.lowStockThreshold')) {
    if (this.inventory.quantity === 0) {
      this.inventory.stockStatus = 'out_of_stock';
    } else if (this.inventory.quantity <= this.inventory.lowStockThreshold) {
      this.inventory.stockStatus = 'low_stock';
    } else {
      this.inventory.stockStatus = 'in_stock';
    }
  }
  
  // Set price range for variable products
  if (this.productType === 'variable' && this.variants.length > 0) {
    const prices = this.variants.map(v => v.price);
    this.minPrice = Math.min(...prices);
    this.maxPrice = Math.max(...prices);
  }
  
  // Ensure primary image
  if (this.media.images.length > 0 && !this.media.images.some(img => img.isPrimary)) {
    this.media.images[0].isPrimary = true;
  }
  
  // Update SEO meta if not set
  if (!this.seo.metaTitle) {
    this.seo.metaTitle = this.title.substring(0, 60);
  }
  if (!this.seo.metaDescription) {
    this.seo.metaDescription = this.shortDescription || this.description.substring(0, 160);
  }
  
  next();
});

// 📊 Instance Methods
productAdvancedSchema.methods.updateAnalytics = function(type, value = 1) {
  switch(type) {
    case 'view':
      this.analytics.views += value;
      break;
    case 'unique_view':
      this.analytics.uniqueViews += value;
      break;
    case 'cart_add':
      this.analytics.cartAdds += value;
      break;
    case 'purchase':
      this.analytics.purchases += value;
      break;
    case 'revenue':
      this.analytics.revenue += value;
      break;
  }
  
  // Calculate conversion rate
  if (this.analytics.uniqueViews > 0) {
    this.analytics.conversionRate = (this.analytics.purchases / this.analytics.uniqueViews * 100).toFixed(2);
  }
  
  return this.save();
};

productAdvancedSchema.methods.updateRating = function(newRating, oldRating = null) {
  if (oldRating) {
    this.reviews.ratingDistribution[oldRating]--;
    this.reviews.ratingDistribution[newRating]++;
  } else {
    this.reviews.ratingDistribution[newRating]++;
    this.reviews.totalReviews++;
  }
  
  // Recalculate average
  const totalRatings = Object.keys(this.reviews.ratingDistribution).reduce((sum, star) => {
    return sum + (parseInt(star) * this.reviews.ratingDistribution[star]);
  }, 0);
  
  this.reviews.averageRating = (totalRatings / this.reviews.totalReviews).toFixed(1);
  return this.save();
};

productAdvancedSchema.methods.getVariantByAttributes = function(attributes) {
  return this.variants.find(variant => {
    return Object.keys(attributes).every(key => 
      variant.attributes[key] === attributes[key]
    );
  });
};

productAdvancedSchema.methods.calculateShipping = function(destination, quantity = 1) {
  // Implement shipping calculation logic
  let cost = this.shipping.shippingCost || 0;
  
  if (this.shipping.freeShipping || 
      (this.shipping.freeShippingThreshold && this.basePrice >= this.shipping.freeShippingThreshold)) {
    cost = 0;
  }
  
  return {
    cost: cost * quantity,
    estimatedDays: this.shipping.handlingTime + 2, // 2 days shipping
    method: 'standard'
  };
};

// 📊 Static Methods
productAdvancedSchema.statics.findFeatured = function(limit = 20) {
  return this.find({
    'promotion.isFeatured': true,
    status: 'active',
    visibility: 'public',
    isDeleted: false
  })
  .sort({ 'reviews.averageRating': -1, 'analytics.purchases': -1 })
  .limit(limit)
  .populate('seller', 'name businessName')
  .populate('category', 'name')
  .populate('brand', 'name logo');
};

productAdvancedSchema.statics.findByCategory = function(categoryId, options = {}) {
  const query = {
    $or: [
      { category: categoryId },
      { subcategories: categoryId }
    ],
    status: 'active',
    visibility: 'public',
    isDeleted: false
  };
  
  return this.find(query)
    .sort(options.sort || { 'analytics.views': -1 })
    .limit(options.limit || 50)
    .populate('seller', 'name businessName')
    .populate('category', 'name')
    .populate('brand', 'name logo');
};

productAdvancedSchema.statics.searchProducts = function(searchTerm, options = {}) {
  const query = {
    $text: { $search: searchTerm },
    status: 'active',
    visibility: 'public',
    isDeleted: false
  };
  
  // Add filters
  if (options.category) query.category = options.category;
  if (options.brand) query.brand = options.brand;
  if (options.minPrice) query.basePrice = { $gte: options.minPrice };
  if (options.maxPrice) query.basePrice = { ...query.basePrice, $lte: options.maxPrice };
  if (options.rating) query['reviews.averageRating'] = { $gte: options.rating };
  
  return this.find(query, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(options.limit || 50)
    .populate('seller', 'name businessName')
    .populate('category', 'name')
    .populate('brand', 'name logo');
};

module.exports = mongoose.models.ProductAdvanced || mongoose.model('ProductAdvanced', productAdvancedSchema);
