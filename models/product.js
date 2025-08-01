const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters'],
    index: true
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
    set: val => Math.round(val * 100) / 100,
    index: true
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
    alt: { type: String, default: function () { return this.parent().name; } }
  }],
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
    index: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  stock: {
    type: Number,
    default: 0,
    min: 0
  },
  lowStockThreshold: {
    type: Number,
    default: 10,
    min: 0
  },
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
  slug: { type: String, unique: true, lowercase: true, index: true },
  tags: {
    type: [String],
    validate: [v => v.length <= 10, 'Cannot have more than 10 tags']
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending', 'rejected', 'out_of_stock'],
    default: 'pending',
    index: true
  },
  isDeleted: { type: Boolean, default: false, index: true },
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
        validator: function(coords) {
          return coords.length === 2 && 
            coords[0] >= -180 && coords[0] <= 180 && 
            coords[1] >= -90 && coords[1] <= 90;
        }
      }
    },
    address: { type: String, default: '' },
    locality: { type: String, default: '' },
    city: { type: String, default: '' },
    pincode: { type: String, default: '', index: true },
    landmark: { type: String, default: '' }
  },
  deliveryConfig: {
    isLocalDeliveryEnabled: { type: Boolean, default: false },
    maxDeliveryRadius: { type: Number, default: 5000, min: 500, max: 20000 },
    preparationTime: { type: Number, default: 10, min: 5, max: 60 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    freeDeliveryThreshold: { type: Number, default: 500 },
    availableTimeSlots: [{
      day: { type: String, enum: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] },
      startTime: { type: String, default: '09:00' },
      endTime: { type: String, default: '21:00' },
      isAvailable: { type: Boolean, default: true },
      maxOrdersPerHour: { type: Number, default: 10 }
    }],
    expressDeliveryAvailable: { type: Boolean, default: true },
    expressDeliveryFee: { type: Number, default: 20 }
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

// 🌐 Indexes
productSchema.index({ sellerLocation: "2dsphere" });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ seller: 1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ price: 1 });
productSchema.index({ averageRating: -1 });
productSchema.index({ views: -1 });
productSchema.index({ brand: 1 });
productSchema.index({ 'deliveryConfig.isLocalDeliveryEnabled': 1 });

// 🧠 Virtuals
productSchema.virtual('finalPrice').get(function () {
  return this.discountPercentage ? 
    Math.round((this.price * (1 - this.discountPercentage / 100)) * 100) / 100 : 
    this.price;
});

productSchema.virtual('isInStock').get(function () {
  return this.stock > 0 && this.status === 'active';
});

// 📦 Middleware
productSchema.pre('save', async function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  if (!this.sku) {
    this.sku = `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }

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

  next();
});

// 📐 Methods
productSchema.methods.calculateDistance = function ([lng1, lat1], [lng2, lat2]) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180, Δλ = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

productSchema.methods.calculateDeliveryDetails = function(userLocation) {
  if (!this.deliveryConfig.isLocalDeliveryEnabled) {
    return { canDeliver: false, reason: 'Local delivery not available' };
  }
  const distance = this.calculateDistance(userLocation, this.sellerLocation.coordinates);
  if (distance > this.deliveryConfig.maxDeliveryRadius) {
    return { canDeliver: false, reason: 'Outside delivery radius', distance };
  }
  const travelTime = Math.ceil(distance / 250);
  const totalTime = this.deliveryConfig.preparationTime + travelTime;
  const deliveryFee = distance > 2000 ? (this.deliveryConfig.deliveryFee || 25) : 0;

  return {
    canDeliver: true,
    distance: Math.round(distance),
    estimatedTime: totalTime,
    deliveryFee,
    preparationTime: this.deliveryConfig.preparationTime,
    travelTime
  };
};

module.exports = mongoose.models.product || mongoose.model('product', productSchema);


