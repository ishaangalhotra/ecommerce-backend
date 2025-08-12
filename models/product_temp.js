// models/Product.js

const mongoose = require('mongoose');

// 📦 Enhanced Product Schema Definition
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
  shortDescription: {
    type: String,
    trim: true,
    maxlength: [200, 'Short description cannot exceed 200 characters']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative'],
    set: val => Math.round(val * 100) / 100
  },
  originalPrice: {
    type: Number,
    min: [0, 'Original price cannot be negative'],
    set: val => Math.round(val * 100) / 100
  },
  discountPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  images: [{
    url: { type: String, required: true },
    publicId: String,
    alt: { type: String, default: function () { return this.parent().name; } },
    isPrimary: { type: Boolean, default: false },
    order: { type: Number, default: 0 }
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  subCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  stock: { 
    type: Number, 
    default: 0, 
    min: 0
  },
  lowStockThreshold: { type: Number, default: 10, min: 0 },
  unit: {
    type: String,
    enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'packet', 'box', 'dozen', 'pair', 'set'],
    default: 'piece'
  },
  weight: { type: Number, min: 0 },
  dimensions: {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    unit: { type: String, enum: ['cm', 'inch', 'mm'], default: 'cm' }
  },
  
  // 📊 Rating & Reviews
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
    set: val => Math.round(val * 10) / 10
  },
  totalReviews: { type: Number, default: 0, min: 0 },
  ratingDistribution: {
    1: { type: Number, default: 0 },
    2: { type: Number, default: 0 },
    3: { type: Number, default: 0 },
    4: { type: Number, default: 0 },
    5: { type: Number, default: 0 }
  },
  
  slug: { 
    type: String, 
    unique: true, 
    lowercase: true,
    sparse: true,
    index: true
  },
  tags: {
    type: [String],
    validate: [v => v.length <= 10, 'Cannot have more than 10 tags'],
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending', 'rejected', 'out_of_stock', 'draft'],
    default: 'draft',
    index: true
  },
  
  // 🗑️ Soft Delete
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // 📈 Analytics
  views: { type: Number, default: 0, min: 0, index: true },
  totalSales: { type: Number, default: 0, min: 0 },
  totalRevenue: { type: Number, default: 0, min: 0 },
  wishlistCount: { type: Number, default: 0, min: 0 },
  cartAddCount: { type: Number, default: 0, min: 0 },
  
  // 🏷️ Product Details
  brand: { 
    type: String, 
    trim: true, 
    maxlength: 50,
    index: true
  },
  model: {
    type: String,
    trim: true,
    maxlength: 50
  },
  sku: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    index: true
  },
  barcode: {
    type: String,
    unique: true,
    sparse: true
  },
  
  // 📋 Specifications & Features
  specifications: {
    type: Map,
    of: String,
    validate: [specs => specs.size <= 25, 'Cannot exceed 25 specifications']
  },
  features: [String],
  colors: [{
    name: String,
    code: String, // Hex color code
    image: String
  }],
  sizes: [{
    name: String,
    stock: { type: Number, default: 0 },
    price: Number // Optional size-specific pricing
  }],
  
  // ⏰ Time-sensitive fields
  expiryDate: {
    type: Date,
    validate: {
      validator: date => !date || date > new Date(),
      message: 'Expiry must be in the future'
    }
  },
  manufacturingDate: Date,
  warrantyPeriod: {
    duration: Number,
    unit: { type: String, enum: ['days', 'months', 'years'], default: 'months' }
  },

  // 🛵 Enhanced Delivery Configuration
  sellerLocation: {
    type: {
      type: String,
      default: 'Point',
      enum: ['Point']
    },
    coordinates: {
      type: [Number],
      default: [0, 0],
      validate: {
        validator: coords =>
          coords.length === 2 &&
          coords[0] >= -180 && coords[0] <= 180 &&
          coords[1] >= -90 && coords[1] <= 90
      }
    },
    address: { type: String, default: '' },
    locality: { type: String, default: '' },
    city: { type: String, default: '', index: true },
    state: { type: String, default: '' },
    pincode: { type: String, default: '', index: true },
    landmark: { type: String, default: '' },
    country: { type: String, default: 'India' }
  },
  
  deliveryConfig: {
    isLocalDeliveryEnabled: { type: Boolean, default: false },
    maxDeliveryRadius: { type: Number, default: 5000, min: 500, max: 20000 },
    preparationTime: { type: Number, default: 10, min: 5, max: 60 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    freeDeliveryThreshold: { type: Number, default: 500 },
    expressDeliveryAvailable: { type: Boolean, default: true },
    expressDeliveryFee: { type: Number, default: 20 },
    codAvailable: { type: Boolean, default: true },
    returnPolicy: {
      isReturnable: { type: Boolean, default: true },
      returnWindow: { type: Number, default: 7 }, // days
      returnShippingFee: { type: Number, default: 0 }
    },
    availableTimeSlots: [{
      day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      startTime: { type: String, default: '09:00' },
      endTime: { type: String, default: '21:00' },
      isAvailable: { type: Boolean, default: true },
      maxOrdersPerHour: { type: Number, default: 10 }
    }]
  },
  
  // 📊 Enhanced Delivery Metrics
  deliveryMetrics: {
    totalDeliveries: { type: Number, default: 0 },
    averageDeliveryTime: { type: Number, default: 0 },
    successfulDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 },
    cancelledDeliveries: { type: Number, default: 0 },
    averageRating: { type: Number, default: 5.0 },
    lastDeliveryDate: { type: Date },
    fastestDelivery: { type: Number, default: 0 },
    slowestDelivery: { type: Number, default: 0 },
    onTimeDeliveryRate: { type: Number, default: 100 }
  },

  // 🎯 Marketing & Promotions
  isFeatured: { type: Boolean, default: false, index: true },
  isNewArrival: { type: Boolean, default: false, index: true },
  isBestSeller: { type: Boolean, default: false, index: true },
  promotionalBadges: [String],
  seasonalTags: [String],
  
  // 🔍 SEO & Metadata
  seoMetadata: {
    metaTitle: { type: String, maxlength: 60 },
    metaDescription: { type: String, maxlength: 160 },
    keywords: [String],
    canonicalUrl: String,
    ogImage: String
  },
  
  // 🏢 Business & Compliance
  businessMetadata: {
    hsnCode: String, // For tax purposes
    gstRate: { type: Number, default: 18 },
    manufacturerDetails: {
      name: String,
      address: String,
      country: String
    },
    importerDetails: {
      name: String,
      address: String
    },
    certifications: [String],
    safetyWarnings: [String]
  },
  
  // 📱 Digital Commerce
  digitalProductInfo: {
    isDigital: { type: Boolean, default: false },
    downloadUrl: String,
    fileSize: String,
    fileFormat: String,
    downloadLimit: Number,
    licenseType: String
  }
  
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

// 🌍 Optimized Indexes
productSchema.index({ sellerLocation: '2dsphere' });
productSchema.index({ name: 'text', description: 'text', tags: 'text', brand: 'text' }, {
  weights: { name: 10, brand: 5, tags: 3, description: 1 }
});
productSchema.index({ category: 1, status: 1, createdAt: -1 });
productSchema.index({ seller: 1, status: 1 });
productSchema.index({ price: 1, status: 1 });
productSchema.index({ averageRating: -1, totalReviews: -1 });
productSchema.index({ views: -1 });
productSchema.index({ totalSales: -1 });
productSchema.index({ 'sellerLocation.city': 1, 'sellerLocation.pincode': 1 });
productSchema.index({ isFeatured: 1, status: 1 });
productSchema.index({ isNewArrival: 1, createdAt: -1 });
productSchema.index({ stock: 1, status: 1 });
productSchema.index({ 'deliveryConfig.isLocalDeliveryEnabled': 1 });

// 📊 Enhanced Virtuals
productSchema.virtual('finalPrice').get(function () {
  if (this.discountPercentage > 0) {
    return Math.round((this.price * (1 - this.discountPercentage / 100)) * 100) / 100;
  }
  return this.price;
});

productSchema.virtual('savings').get(function () {
  if (this.originalPrice && this.originalPrice > this.price) {
    return Math.round((this.originalPrice - this.price) * 100) / 100;
  }
  return 0;
});

productSchema.virtual('isInStock').get(function () {
  return this.stock > 0 && this.status === 'active' && !this.isDeleted;
});

productSchema.virtual('isLowStock').get(function () {
  return this.stock <= this.lowStockThreshold && this.stock > 0;
});

productSchema.virtual('stockStatus').get(function () {
  if (this.stock === 0) return 'out_of_stock';
  if (this.stock <= this.lowStockThreshold) return 'low_stock';
  return 'in_stock';
});

productSchema.virtual('primaryImage').get(function () {
  const primary = this.images.find(img => img.isPrimary);
  return primary || this.images[0];
});

// 📐 Enhanced Middleware
productSchema.pre('save', async function (next) {
  // Generate slug from name
  if (this.isModified('name')) {
    const baseSlug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    
    // Ensure unique slug
    let slug = baseSlug;
    let counter = 1;
    
    while (await this.constructor.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    this.slug = slug;
  }

  // Auto-generate SKU if not provided
  if (!this.sku) {
    this.sku = `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }

  // Set original price if not provided
  if (!this.originalPrice) {
    this.originalPrice = this.price;
  }

  // Auto-populate seller location from User model
  if ((this.isNew || this.isModified('seller')) &&
    this.sellerLocation.coordinates[0] === 0 &&
    this.sellerLocation.coordinates[1] === 0) {
    try {
      const User = mongoose.model('User');
      const seller = await User.findById(this.seller);
      if (seller?.location?.coordinates?.length === 2) {
        this.sellerLocation = {
          ...this.sellerLocation,
          coordinates: seller.location.coordinates,
          address: seller.location.address || '',
          city: seller.location.city || '',
          state: seller.location.state || '',
          pincode: seller.location.pincode || '',
          country: seller.location.country || 'India'
        };
        this.deliveryConfig.isLocalDeliveryEnabled = true;
      }
    } catch (err) {
      console.warn('Seller location auto-set failed:', err.message);
    }
  }

  // Ensure at least one image is marked as primary
  if (this.images.length > 0 && !this.images.some(img => img.isPrimary)) {
    this.images[0].isPrimary = true;
  }

  next();
});

// 🧠 Enhanced Instance Methods
productSchema.methods.calculateDistance = function ([lng1, lat1], [lng2, lat2]) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

productSchema.methods.calculateDeliveryDetails = function (userLocation) {
  if (!this.deliveryConfig.isLocalDeliveryEnabled) {
    return { canDeliver: false, reason: 'Local delivery not available' };
  }

  const distance = this.calculateDistance(userLocation, this.sellerLocation.coordinates);

  if (distance > this.deliveryConfig.maxDeliveryRadius) {
    return { 
      canDeliver: false, 
      reason: 'Outside delivery radius', 
      distance: Math.round(distance),
      maxRadius: this.deliveryConfig.maxDeliveryRadius
    };
  }

  const travelTime = Math.ceil(distance / 250); // Assuming 15 km/h average speed
  const totalTime = this.deliveryConfig.preparationTime + travelTime;
  
  let deliveryFee = 0;
  if (distance > 2000) { // Free delivery within 2km
    deliveryFee = this.deliveryConfig.deliveryFee || 25;
  }

  return {
    canDeliver: true,
    distance: Math.round(distance),
    estimatedTime: totalTime,
    deliveryFee,
    preparationTime: this.deliveryConfig.preparationTime,
    travelTime,
    freeDeliveryEligible: this.price >= this.deliveryConfig.freeDeliveryThreshold
  };
};

productSchema.methods.updateRating = function (newRating, oldRating = null) {
  if (oldRating) {
    // Update existing rating
    this.ratingDistribution[oldRating]--;
    this.ratingDistribution[newRating]++;
  } else {
    // New rating
    this.ratingDistribution[newRating]++;
    this.totalReviews++;
  }

  // Recalculate average rating
  const totalRatings = Object.keys(this.ratingDistribution).reduce((sum, star) => {
    return sum + (parseInt(star) * this.ratingDistribution[star]);
  }, 0);

  this.averageRating = totalRatings / this.totalReviews;
  return this.save();
};

productSchema.methods.incrementView = function () {
  this.views++;
  return this.save();
};

// 📊 Static Methods
productSchema.statics.findByLocation = function (coordinates, radius = 5000) {
  return this.find({
    'deliveryConfig.isLocalDeliveryEnabled': true,
    sellerLocation: {
      $near: {
        $geometry: { type: 'Point', coordinates },
        $maxDistance: radius
      }
    },
    status: 'active',
    isDeleted: false
  });
};

productSchema.statics.findFeatured = function (limit = 10) {
  return this.find({
    isFeatured: true,
    status: 'active',
    isDeleted: false
  })
  .sort({ averageRating: -1, totalSales: -1 })
  .limit(limit)
  .populate('seller', 'name businessName')
  .populate('category', 'name');
};

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
