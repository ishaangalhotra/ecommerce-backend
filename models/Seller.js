// models/Seller.js - Advanced Multi-Vendor Seller System

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const sellerSchema = new mongoose.Schema({
  // Basic Information
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    unique: true
  },
  
  // Business Information
  businessInfo: {
    businessName: { 
      type: String, 
      required: [true, 'Business name is required'],
      trim: true,
      maxlength: [100, 'Business name cannot exceed 100 characters'],
      index: true
    },
    businessType: {
      type: String,
      enum: ['individual', 'proprietorship', 'partnership', 'private_limited', 'public_limited', 'llp'],
      required: true
    },
    businessCategory: {
      type: String,
      required: true,
      enum: ['electronics', 'fashion', 'home_garden', 'sports', 'books', 'health', 'automotive', 'grocery', 'other']
    },
    businessDescription: {
      type: String,
      maxlength: [1000, 'Business description cannot exceed 1000 characters']
    },
    website: String,
    establishedYear: {
      type: Number,
      min: 1900,
      max: new Date().getFullYear()
    },
    employeeCount: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '500+']
    }
  },

  // Contact Information
  contactInfo: {
    primaryPhone: { 
      type: String, 
      required: true,
      validate: {
        validator: function(v) {
          return /^\+?[\d\s\-\(\)]+$/.test(v);
        },
        message: 'Please enter a valid phone number'
      }
    },
    secondaryPhone: String,
    email: { 
      type: String, 
      required: true,
      lowercase: true,
      validate: {
        validator: function(v) {
          return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
        },
        message: 'Please enter a valid email'
      }
    },
    whatsapp: String,
    supportEmail: String
  },

  // Address Information
  addresses: {
    business: {
      street: { type: String, required: true },
      area: String,
      city: { type: String, required: true, index: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true, index: true },
      country: { type: String, default: 'India' },
      landmark: String,
      coordinates: {
        type: [Number], // [longitude, latitude]
        validate: {
          validator: function(coords) {
            return coords.length === 2 && 
                   coords[0] >= -180 && coords[0] <= 180 &&
                   coords[1] >= -90 && coords[1] <= 90;
          },
          message: 'Invalid coordinates'
        }
      }
    },
    pickup: {
      street: String,
      area: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' },
      landmark: String,
      coordinates: [Number],
      isSameAsBusiness: { type: Boolean, default: true }
    },
    billing: {
      street: String,
      area: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' },
      landmark: String,
      isSameAsBusiness: { type: Boolean, default: true }
    }
  },

  // Legal & Tax Information
  legalInfo: {
    pan: {
      type: String,
      required: true,
      uppercase: true,
      validate: {
        validator: function(v) {
          return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v);
        },
        message: 'Please enter a valid PAN number'
      }
    },
    gstin: {
      type: String,
      uppercase: true,
      validate: {
        validator: function(v) {
          return !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
        },
        message: 'Please enter a valid GSTIN'
      }
    },
    cin: String, // Corporate Identification Number
    udyamNumber: String, // MSME Registration
    fssaiLicense: String, // For food businesses
    drugLicense: String, // For pharmaceutical businesses
    tradeLicense: String,
    shopEstablishmentLicense: String
  },

  // Bank Information
  bankInfo: {
    accountHolderName: { type: String, required: true },
    accountNumber: { 
      type: String, 
      required: true,
      validate: {
        validator: function(v) {
          return /^[0-9]{9,18}$/.test(v);
        },
        message: 'Please enter a valid account number'
      }
    },
    ifscCode: {
      type: String,
      required: true,
      uppercase: true,
      validate: {
        validator: function(v) {
          return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v);
        },
        message: 'Please enter a valid IFSC code'
      }
    },
    bankName: { type: String, required: true },
    branchName: String,
    accountType: {
      type: String,
      enum: ['savings', 'current', 'business'],
      required: true
    },
    upiId: String
  },

  // KYC & Verification
  kyc: {
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'verified', 'rejected', 'expired'],
      default: 'pending',
      index: true
    },
    documents: [{
      type: {
        type: String,
        enum: ['pan_card', 'aadhar_card', 'business_registration', 'gst_certificate', 'bank_statement', 'address_proof', 'identity_proof', 'other'],
        required: true
      },
      url: { type: String, required: true },
      filename: String,
      uploadedAt: { type: Date, default: Date.now },
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      rejectionReason: String,
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      verifiedAt: Date
    }],
    verificationLevel: {
      type: String,
      enum: ['basic', 'standard', 'premium'],
      default: 'basic'
    },
    verifiedAt: Date,
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: String,
    lastVerificationAttempt: Date
  },

  // Seller Performance Metrics
  performance: {
    rating: {
      average: { type: Number, default: 5.0, min: 0, max: 5, index: true },
      count: { type: Number, default: 0, min: 0 },
      distribution: {
        1: { type: Number, default: 0 },
        2: { type: Number, default: 0 },
        3: { type: Number, default: 0 },
        4: { type: Number, default: 0 },
        5: { type: Number, default: 0 }
      }
    },
    sales: {
      totalOrders: { type: Number, default: 0, min: 0 },
      totalRevenue: { type: Number, default: 0, min: 0 },
      thisMonthOrders: { type: Number, default: 0, min: 0 },
      thisMonthRevenue: { type: Number, default: 0, min: 0 },
      averageOrderValue: { type: Number, default: 0, min: 0 },
      conversionRate: { type: Number, default: 0, min: 0, max: 100 }
    },
    fulfillment: {
      onTimeDeliveryRate: { type: Number, default: 100, min: 0, max: 100 },
      cancellationRate: { type: Number, default: 0, min: 0, max: 100 },
      returnRate: { type: Number, default: 0, min: 0, max: 100 },
      averageProcessingTime: { type: Number, default: 24 }, // hours
      responseTime: { type: Number, default: 2 } // hours
    },
    quality: {
      productQualityScore: { type: Number, default: 5.0, min: 0, max: 5 },
      customerServiceScore: { type: Number, default: 5.0, min: 0, max: 5 },
      policyComplianceScore: { type: Number, default: 100, min: 0, max: 100 }
    }
  },

  // Business Settings
  businessSettings: {
    operatingHours: [{
      day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        required: true
      },
      isOpen: { type: Boolean, default: true },
      openTime: { type: String, default: '09:00' },
      closeTime: { type: String, default: '21:00' },
      breakStart: String,
      breakEnd: String
    }],
    holidays: [{
      date: { type: Date, required: true },
      reason: String,
      isRecurring: { type: Boolean, default: false }
    }],
    processingTime: {
      standard: { type: Number, default: 24 }, // hours
      express: { type: Number, default: 12 } // hours
    },
    autoAcceptOrders: { type: Boolean, default: true },
    maxOrdersPerDay: { type: Number, default: 100 },
    minOrderValue: { type: Number, default: 0 }
  },

  // Shipping & Delivery
  shipping: {
    methods: [{
      name: { type: String, required: true },
      type: { type: String, enum: ['standard', 'express', 'same_day', 'pickup'], required: true },
      cost: { type: Number, required: true, min: 0 },
      freeShippingThreshold: { type: Number, default: 0 },
      estimatedDays: { type: Number, required: true, min: 0 },
      isActive: { type: Boolean, default: true },
      serviceProvider: String,
      zones: [String] // Serviceable areas
    }],
    returnPolicy: {
      isReturnable: { type: Boolean, default: true },
      returnWindow: { type: Number, default: 7 }, // days
      returnShippingFee: { type: Number, default: 0 },
      conditions: [String],
      instructions: String
    },
    replacementPolicy: {
      isReplaceable: { type: Boolean, default: true },
      replacementWindow: { type: Number, default: 7 }, // days
      conditions: [String]
    }
  },

  // Commission & Payments
  commission: {
    rate: { type: Number, default: 10, min: 0, max: 50 }, // percentage
    model: { type: String, enum: ['percentage', 'fixed', 'tiered'], default: 'percentage' },
    fixedAmount: { type: Number, default: 0 },
    tierRates: [{
      minRevenue: Number,
      maxRevenue: Number,
      rate: Number
    }]
  },

  // Subscription & Plans
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'basic', 'premium', 'enterprise'],
      default: 'free'
    },
    startDate: Date,
    endDate: Date,
    isActive: { type: Boolean, default: true },
    features: [String],
    limitations: {
      maxProducts: { type: Number, default: 10 },
      maxImages: { type: Number, default: 5 },
      maxCategories: { type: Number, default: 3 },
      supportLevel: { type: String, enum: ['basic', 'priority', 'dedicated'], default: 'basic' }
    }
  },

  // Seller Status
  status: {
    type: String,
    enum: ['pending', 'active', 'inactive', 'suspended', 'blocked', 'rejected'],
    default: 'pending',
    index: true
  },

  // Flags & Badges
  badges: [{
    type: {
      type: String,
      enum: ['verified', 'top_seller', 'fast_shipping', 'quality_assured', 'eco_friendly', 'local_business']
    },
    earnedAt: { type: Date, default: Date.now },
    validUntil: Date
  }],

  // Seller Preferences
  preferences: {
    language: { type: String, default: 'en' },
    currency: { type: String, default: 'INR' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      orderUpdates: { type: Boolean, default: true },
      paymentUpdates: { type: Boolean, default: true },
      promotionalOffers: { type: Boolean, default: false }
    },
    dashboard: {
      defaultView: { type: String, enum: ['overview', 'orders', 'products', 'analytics'], default: 'overview' },
      chartsType: { type: String, enum: ['line', 'bar', 'pie'], default: 'line' }
    }
  },

  // Analytics & Insights
  analytics: {
    profileViews: { type: Number, default: 0 },
    productViews: { type: Number, default: 0 },
    searchAppearances: { type: Number, default: 0 },
    clickThroughRate: { type: Number, default: 0 },
    conversionFunnel: {
      views: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      cartAdds: { type: Number, default: 0 },
      purchases: { type: Number, default: 0 }
    }
  },

  // Social Media & Marketing
  socialMedia: {
    facebook: String,
    instagram: String,
    twitter: String,
    youtube: String,
    linkedin: String
  },

  // Audit Trail
  audit: {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    lastLoginAt: Date,
    lastActiveAt: Date,
    suspensionHistory: [{
      suspendedAt: Date,
      suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      duration: Number, // days
      reactivatedAt: Date
    }]
  }

}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      delete ret.bankInfo.accountNumber; // Hide sensitive info
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for performance
sellerSchema.index({ 'businessInfo.businessName': 'text' });
sellerSchema.index({ 'addresses.business.city': 1, 'addresses.business.pincode': 1 });
sellerSchema.index({ 'performance.rating.average': -1 });
sellerSchema.index({ 'performance.sales.totalRevenue': -1 });
sellerSchema.index({ 'kyc.status': 1, status: 1 });
sellerSchema.index({ 'businessInfo.businessCategory': 1 });
sellerSchema.index({ createdAt: -1 });
sellerSchema.index({ 'addresses.business.coordinates': '2dsphere' });

// Virtuals
sellerSchema.virtual('isVerified').get(function() {
  return this.kyc.status === 'verified';
});

sellerSchema.virtual('isActive').get(function() {
  return this.status === 'active' && this.kyc.status === 'verified';
});

sellerSchema.virtual('overallScore').get(function() {
  const weights = {
    rating: 0.3,
    onTimeDelivery: 0.25,
    customerService: 0.2,
    qualityScore: 0.15,
    compliance: 0.1
  };
  
  return (
    this.performance.rating.average * weights.rating +
    this.performance.fulfillment.onTimeDeliveryRate / 20 * weights.onTimeDelivery +
    this.performance.quality.customerServiceScore * weights.customerService +
    this.performance.quality.productQualityScore * weights.qualityScore +
    this.performance.quality.policyComplianceScore / 20 * weights.compliance
  ).toFixed(2);
});

sellerSchema.virtual('sellerLevel').get(function() {
  const score = parseFloat(this.overallScore);
  if (score >= 4.5) return 'platinum';
  if (score >= 4.0) return 'gold';
  if (score >= 3.5) return 'silver';
  return 'bronze';
});

sellerSchema.virtual('totalProducts').get(function() {
  // This would be calculated via aggregation in practice
  return 0;
});

// Middleware
sellerSchema.pre('save', async function(next) {
  // Auto-populate pickup address if same as business
  if (this.addresses.pickup.isSameAsBusiness) {
    this.addresses.pickup = {
      ...this.addresses.business,
      isSameAsBusiness: true
    };
  }
  
  // Auto-populate billing address if same as business
  if (this.addresses.billing.isSameAsBusiness) {
    this.addresses.billing = {
      ...this.addresses.business,
      isSameAsBusiness: true
    };
  }
  
  // Update last active timestamp
  this.audit.lastActiveAt = new Date();
  
  next();
});

// Instance Methods
sellerSchema.methods.updateRating = function(newRating, oldRating = null) {
  if (oldRating) {
    this.performance.rating.distribution[oldRating]--;
    this.performance.rating.distribution[newRating]++;
  } else {
    this.performance.rating.distribution[newRating]++;
    this.performance.rating.count++;
  }
  
  // Recalculate average
  const totalRatings = Object.keys(this.performance.rating.distribution).reduce((sum, star) => {
    return sum + (parseInt(star) * this.performance.rating.distribution[star]);
  }, 0);
  
  this.performance.rating.average = (totalRatings / this.performance.rating.count).toFixed(1);
  return this.save();
};

sellerSchema.methods.updateSalesMetrics = function(orderValue) {
  this.performance.sales.totalOrders++;
  this.performance.sales.totalRevenue += orderValue;
  this.performance.sales.averageOrderValue = this.performance.sales.totalRevenue / this.performance.sales.totalOrders;
  
  // Update monthly metrics (would need more sophisticated logic)
  const currentMonth = new Date().getMonth();
  // Simplified - in practice, you'd track monthly data separately
  this.performance.sales.thisMonthOrders++;
  this.performance.sales.thisMonthRevenue += orderValue;
  
  return this.save();
};

sellerSchema.methods.addBadge = function(badgeType, validityDays = null) {
  const existingBadge = this.badges.find(badge => badge.type === badgeType);
  
  if (existingBadge) {
    existingBadge.earnedAt = new Date();
    if (validityDays) {
      existingBadge.validUntil = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
    }
  } else {
    const newBadge = {
      type: badgeType,
      earnedAt: new Date()
    };
    
    if (validityDays) {
      newBadge.validUntil = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
    }
    
    this.badges.push(newBadge);
  }
  
  return this.save();
};

sellerSchema.methods.isOperatingNow = function() {
  const now = new Date();
  const currentDay = now.toLocaleLowerCase().slice(0, 3); // mon, tue, etc.
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM
  
  const todayHours = this.businessSettings.operatingHours.find(
    hours => hours.day.startsWith(currentDay)
  );
  
  if (!todayHours || !todayHours.isOpen) return false;
  
  return currentTime >= todayHours.openTime && currentTime <= todayHours.closeTime;
};

// Static Methods
sellerSchema.statics.findByLocation = function(coordinates, radius = 10000) {
  return this.find({
    'addresses.business.coordinates': {
      $near: {
        $geometry: { type: 'Point', coordinates },
        $maxDistance: radius
      }
    },
    status: 'active',
    'kyc.status': 'verified'
  });
};

sellerSchema.statics.findTopRated = function(limit = 10) {
  return this.find({
    status: 'active',
    'kyc.status': 'verified',
    'performance.rating.count': { $gte: 10 }
  })
  .sort({ 'performance.rating.average': -1, 'performance.rating.count': -1 })
  .limit(limit);
};

sellerSchema.statics.findByCategory = function(category, limit = 50) {
  return this.find({
    'businessInfo.businessCategory': category,
    status: 'active',
    'kyc.status': 'verified'
  })
  .sort({ 'performance.rating.average': -1 })
  .limit(limit);
};

module.exports = mongoose.models.Seller || mongoose.model('Seller', sellerSchema);
