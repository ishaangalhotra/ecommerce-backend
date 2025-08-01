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
    isPrimary: { type: Boolean, default: false }, // Enhancement: Mark primary image
    sortOrder: { type: Number, default: 0 } // Enhancement: Image ordering
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  stock: { type: Number, default: 0, min: 0 },
  lowStockThreshold: { type: Number, default: 10, min: 0 },
  unit: {
    type: String,
    enum: ['piece', 'kg', 'gram', 'liter', 'ml', 'packet', 'box', 'dozen'],
    default: 'piece'
  },
  weight: { type: Number, min: 0 },
  dimensions: {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    unit: { type: String, enum: ['cm', 'inch', 'mm'], default: 'cm' }
  },
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
    set: val => Math.round(val * 10) / 10
  },
  totalReviews: { type: Number, default: 0, min: 0 },
  slug: { type: String, unique: true, lowercase: true },
  tags: {
    type: [String],
    validate: [v => v.length <= 10, 'Cannot have more than 10 tags']
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending', 'rejected', 'out_of_stock'],
    default: 'pending'
  },
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date,
  views: { type: Number, default: 0, min: 0 },
  totalSales: { type: Number, default: 0, min: 0 },
  brand: { type: String, trim: true, maxlength: 50 },
  sku: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true
  },
  specifications: {
    type: Map,
    of: String,
    validate: [specs => specs.size <= 20, 'Cannot exceed 20 specs']
  },
  expiryDate: {
    type: Date,
    validate: {
      validator: date => !date || date > new Date(),
      message: 'Expiry must be in the future'
    }
  },

  // Enhanced: Inventory tracking
  inventoryHistory: [{
    type: { type: String, enum: ['purchase', 'sale', 'adjustment', 'return'] },
    quantity: Number,
    previousStock: Number,
    newStock: Number,
    reason: String,
    date: { type: Date, default: Date.now },
    referenceId: String // Order ID, Purchase ID, etc.
  }],

  // 🛵 Delivery enhancements
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
          coords[1] >= -90 && coords[1] <= 90,
        message: 'Invalid coordinates format'
      }
    },
    address: { type: String, default: '' },
    locality: { type: String, default: '' },
    city: { type: String, default: '' },
    pincode: { type: String, default: '' },
    landmark: { type: String, default: '' }
  },
  deliveryConfig: {
    isLocalDeliveryEnabled: { type: Boolean, default: false },
    maxDeliveryRadius: { type: Number, default: 5000, min: 500, max: 20000 },
    preparationTime: { type: Number, default: 10, min: 5, max: 60 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    freeDeliveryThreshold: { type: Number, default: 500 },
    availableTimeSlots: [{
      day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      startTime: { type: String, default: '09:00' },
      endTime: { type: String, default: '21:00' },
      isAvailable: { type: Boolean, default: true },
      maxOrdersPerHour: { type: Number, default: 10 }
    }],
    expressDeliveryAvailable: { type: Boolean, default: true },
    expressDeliveryFee: { type: Number, default: 20 },
    // Enhancement: Delivery zones with different pricing
    deliveryZones: [{
      name: String,
      radius: Number,
      fee: Number,
      estimatedTime: Number
    }]
  },
  deliveryMetrics: {
    totalDeliveries: { type: Number, default: 0 },
    averageDeliveryTime: { type: Number, default: 0 },
    successfulDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 },
    averageRating: { type: Number, default: 5.0 },
    lastDeliveryDate: { type: Date },
    fastestDelivery: { type: Number, default: 0 },
    slowestDelivery: { type: Number, default: 0 }
  },

  // Enhancement: Pricing history
  priceHistory: [{
    price: Number,
    discountPercentage: Number,
    effectiveDate: { type: Date, default: Date.now },
    reason: String
  }],

  // Enhancement: Bulk order configuration
  bulkPricing: [{
    minQuantity: Number,
    maxQuantity: Number,
    discountPercentage: Number,
    price: Number
  }],

  seoMetadata: {
    metaTitle: { type: String, maxlength: 60 },
    metaDescription: { type: String, maxlength: 160 },
    keywords: [String]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 🌐 Enhanced Indexes
productSchema.index({ sellerLocation: '2dsphere' });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ seller: 1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ price: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ views: -1 });
productSchema.index({ brand: 1 });
productSchema.index({ 'deliveryConfig.isLocalDeliveryEnabled': 1 });
productSchema.index({ slug: 1 });
productSchema.index({ isDeleted: 1 });
productSchema.index({ 'sellerLocation.pincode': 1 });
productSchema.index({ expiryDate: 1 }); // Enhancement: For expiry tracking
productSchema.index({ 'bulkPricing.minQuantity': 1 }); // Enhancement: For bulk pricing

// 🧠 Enhanced Virtuals
productSchema.virtual('finalPrice').get(function () {
  return this.discountPercentage
    ? Math.round((this.price * (1 - this.discountPercentage / 100)) * 100) / 100
    : this.price;
});

productSchema.virtual('isInStock').get(function () {
  return this.stock > 0 && this.status === 'active';
});

productSchema.virtual('isLowStock').get(function () {
  return this.stock <= this.lowStockThreshold && this.stock > 0;
});

productSchema.virtual('primaryImage').get(function () {
  return this.images.find(img => img.isPrimary) || this.images[0];
});

productSchema.virtual('deliveryAvailable').get(function () {
  return this.deliveryConfig.isLocalDeliveryEnabled && this.isInStock;
});

// Enhancement: Check if product is near expiry
productSchema.virtual('isNearExpiry').get(function () {
  if (!this.expiryDate) return false;
  const daysUntilExpiry = (this.expiryDate - new Date()) / (1000 * 60 * 60 * 24);
  return daysUntilExpiry <= 7; // Within 7 days
});

// 📦 Enhanced Middleware
productSchema.pre('save', async function (next) {
  // Generate slug from name
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  // Generate SKU if not provided
  if (!this.sku) {
    this.sku = `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }

  // Auto-set seller location from user
  if ((this.isNew || this.isModified('seller')) &&
    this.sellerLocation.coordinates[0] === 0 &&
    this.sellerLocation.coordinates[1] === 0) {
    try {
      const User = mongoose.model('User');
      const seller = await User.findById(this.seller);
      if (seller?.location?.coordinates?.length === 2) {
        this.sellerLocation.coordinates = seller.location.coordinates;
        this.sellerLocation.address = seller.location.address || '';
        this.sellerLocation.pincode = seller.location.pincode || '';
        this.deliveryConfig.isLocalDeliveryEnabled = true;
      }
    } catch (err) {
      console.warn('Seller location auto-set failed:', err.message);
    }
  }

  // Enhancement: Track price changes
  if (this.isModified('price') || this.isModified('discountPercentage')) {
    this.priceHistory.push({
      price: this.price,
      discountPercentage: this.discountPercentage,
      reason: 'Price update'
    });
  }

  // Enhancement: Auto-update status based on stock
  if (this.isModified('stock')) {
    if (this.stock === 0) {
      this.status = 'out_of_stock';
    } else if (this.status === 'out_of_stock' && this.stock > 0) {
      this.status = 'active';
    }
  }

  // Enhancement: Set soft delete timestamp
  if (this.isModified('isDeleted') && this.isDeleted) {
    this.deletedAt = new Date();
  }

  next();
});

// Enhancement: Pre-find middleware to exclude deleted products by default
productSchema.pre(/^find/, function(next) {
  if (!this.getQuery().includeDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// 📐 Enhanced Methods
productSchema.methods.calculateDistance = function ([lng1, lat1], [lng2, lat2]) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

productSchema.methods.calculateDeliveryDetails = function (userLocation) {
  if (!this.deliveryConfig.isLocalDeliveryEnabled) {
    return { canDeliver: false, reason: 'Local delivery not available' };
  }
  
  const distance = this.calculateDistance(userLocation, this.sellerLocation.coordinates);
  
  if (distance > this.deliveryConfig.maxDeliveryRadius) {
    return { canDeliver: false, reason: 'Outside delivery radius', distance };
  }

  // Check delivery zones for specific pricing
  let deliveryFee = this.deliveryConfig.deliveryFee || 25;
  let estimatedTime = this.deliveryConfig.preparationTime;

  const zone = this.deliveryConfig.deliveryZones?.find(z => distance <= z.radius);
  if (zone) {
    deliveryFee = zone.fee;
    estimatedTime += zone.estimatedTime;
  } else {
    const travelTime = Math.ceil(distance / 250); // 250m per minute average
    estimatedTime += travelTime;
  }

  // Free delivery threshold
  if (distance <= 2000) deliveryFee = 0;

  return {
    canDeliver: true,
    distance: Math.round(distance),
    estimatedTime,
    deliveryFee,
    preparationTime: this.deliveryConfig.preparationTime,
    travelTime: estimatedTime - this.deliveryConfig.preparationTime
  };
};

// Enhancement: Calculate bulk pricing
productSchema.methods.getBulkPrice = function(quantity) {
  const bulkTier = this.bulkPricing?.find(tier => 
    quantity >= tier.minQuantity && 
    (tier.maxQuantity ? quantity <= tier.maxQuantity : true)
  );
  
  if (bulkTier) {
    return bulkTier.price || (this.price * (1 - bulkTier.discountPercentage / 100));
  }
  
  return this.finalPrice;
};

// Enhancement: Update stock with history tracking
productSchema.methods.updateStock = function(quantity, type, reason, referenceId) {
  const previousStock = this.stock;
  this.stock += quantity;
  
  this.inventoryHistory.push({
    type,
    quantity,
    previousStock,
    newStock: this.stock,
    reason,
    referenceId
  });
  
  return this.save();
};

// Enhancement: Soft delete method
productSchema.methods.softDelete = function(reason) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  // Could add deletion reason field if needed
  return this.save();
};

// Static methods
productSchema.statics.findNearExpiry = function(days = 7) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  
  return this.find({
    expiryDate: { $lte: futureDate, $gte: new Date() },
    isDeleted: false
  });
};

productSchema.statics.findLowStock = function() {
  return this.find({
    $expr: { $lte: ['$stock', '$lowStockThreshold'] },
    stock: { $gt: 0 },
    isDeleted: false
  });
};

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);