const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Please tell us your name'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters'],
    minlength: [2, 'Name must be at least 2 characters']
  },
  
  email: {
    type: String,
    required: [true, 'Please provide your email'],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email'],
    index: true
  },
  
  phone: {
    type: String,
    validate: {
      validator: function(v) {
        return !v || validator.isMobilePhone(v);
      },
      message: 'Please provide a valid phone number'
    },
    sparse: true
  },

  // Authentication
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
    validate: {
      validator: function(pass) {
        return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(pass);
      },
      message: 'Password must contain uppercase, lowercase, number, and special character'
    }
  },

  // User Role & Status
  role: {
    type: String,
    enum: {
      values: ['user', 'seller', 'admin'],
      message: 'Role must be either user, seller, or admin'
    },
    default: 'user'
  },

  active: {
    type: Boolean,
    default: true,
    select: false
  },

  isVerified: {
    type: Boolean,
    default: false
  },

  // Profile Information
  avatar: {
    public_id: {
      type: String,
      default: null
    },
    url: {
      type: String,
      default: null
    }
  },

  // Address Information
  addresses: [{
    type: {
      type: String,
      enum: ['home', 'work', 'other'],
      default: 'home'
    },
    street: {
      type: String,
      required: true,
      trim: true
    },
    city: {
      type: String,
      required: true,
      trim: true
    },
    state: {
      type: String,
      required: true,
      trim: true
    },
    zipCode: {
      type: String,
      required: true,
      trim: true
    },
    country: {
      type: String,
      required: true,
      trim: true,
      default: 'India'
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  }],

  // Security & Authentication
  passwordChangedAt: {
    type: Date,
    select: false
  },
  
  passwordResetToken: {
    type: String,
    select: false
  },
  
  passwordResetExpires: {
    type: Date,
    select: false
  },
  
  refreshToken: {
    type: String,
    select: false
  },

  // Email Verification
  emailVerificationToken: {
    type: String,
    select: false
  },
  
  emailVerificationExpires: {
    type: Date,
    select: false
  },

  // OAuth Integration
  googleId: {
    type: String,
    sparse: true,
    select: false
  },
  
  facebookId: {
    type: String,
    sparse: true,
    select: false
  },

  // User Activity
  lastLoginAt: {
    type: Date
  },
  
  loginCount: {
    type: Number,
    default: 0
  },

  // Seller-specific fields (populated when role is 'seller')
  sellerInfo: {
    businessName: {
      type: String,
      trim: true
    },
    businessType: {
      type: String,
      enum: ['individual', 'company', 'partnership'],
    },
    gstNumber: {
      type: String,
      uppercase: true,
      validate: {
        validator: function(v) {
          return !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
        },
        message: 'Please provide a valid GST number'
      }
    },
    panNumber: {
      type: String,
      uppercase: true,
      validate: {
        validator: function(v) {
          return !v || /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v);
        },
        message: 'Please provide a valid PAN number'
      }
    },
    bankDetails: {
      accountNumber: String,
      ifscCode: String,
      accountHolderName: String,
      bankName: String
    },
    isApproved: {
      type: Boolean,
      default: false
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    totalSales: {
      type: Number,
      default: 0
    }
  },

  // User Preferences
  preferences: {
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      sms: {
        type: Boolean,
        default: false
      },
      push: {
        type: Boolean,
        default: true
      }
    },
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'hi', 'te', 'ta', 'bn']
    },
    currency: {
      type: String,
      default: 'INR',
      enum: ['INR', 'USD', 'EUR']
    }
  },

  // Wishlist and Cart
  wishlist: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],

  // Account Security
  twoFactorAuth: {
    enabled: {
      type: Boolean,
      default: false
    },
    secret: {
      type: String,
      select: false
    }
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.__v;
      delete ret.passwordResetToken;
      delete ret.emailVerificationToken;
      delete ret.refreshToken;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for better performance
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ phone: 1 }, { sparse: true });
userSchema.index({ role: 1 });
userSchema.index({ 'sellerInfo.isApproved': 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ lastLoginAt: -1 });

// Virtual for full name display
userSchema.virtual('displayName').get(function() {
  return this.name;
});

// Virtual for seller status
userSchema.virtual('isApprovedSeller').get(function() {
  return this.role === 'seller' && this.sellerInfo?.isApproved;
});

// Pre-save hooks
userSchema.pre('save', async function(next) {
  // Hash password if modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
    if (!this.isNew) {
      this.passwordChangedAt = Date.now() - 1000;
    }
  }

  // Ensure only one default address
  if (this.isModified('addresses')) {
    const defaultAddresses = this.addresses.filter(addr => addr.isDefault);
    if (defaultAddresses.length > 1) {
      // Keep only the last one as default
      this.addresses.forEach((addr, index) => {
        addr.isDefault = index === this.addresses.length - 1 && addr.isDefault;
      });
    }
  }

  next();
});

// Pre-find hooks
userSchema.pre(/^find/, function(next) {
  this.find({ active: { $ne: false } });
  next();
});

// Methods
userSchema.methods = {
  // Password verification
  matchPassword: async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  },

  // Check if password changed after JWT issued
  changedPasswordAfter: function(JWTTimestamp) {
    if (this.passwordChangedAt) {
      const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
      return JWTTimestamp < changedTimestamp;
    }
    return false;
  },

  // Create password reset token
  createPasswordResetToken: function() {
    const resetToken = crypto.randomBytes(32).toString('hex');
    this.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    return resetToken;
  },

  // Create email verification token
  createEmailVerificationToken: function() {
    const verificationToken = crypto.randomBytes(32).toString('hex');
    this.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
    this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    return verificationToken;
  },

  // Update last login
  updateLastLogin: function() {
    this.lastLoginAt = new Date();
    this.loginCount += 1;
    return this.save({ validateBeforeSave: false });
  },

  // Get default address
  getDefaultAddress: function() {
    return this.addresses.find(addr => addr.isDefault) || this.addresses[0];
  },

  // Add to wishlist
  addToWishlist: function(productId) {
    if (!this.wishlist.includes(productId)) {
      this.wishlist.push(productId);
    }
    return this.save();
  },

  // Remove from wishlist
  removeFromWishlist: function(productId) {
    this.wishlist = this.wishlist.filter(id => !id.equals(productId));
    return this.save();
  },

  // Check if user is approved seller
  isApprovedSeller: function() {
    return this.role === 'seller' && this.sellerInfo?.isApproved === true;
  }
};

// Static methods
userSchema.statics = {
  // Find by email
  findByEmail: function(email) {
    return this.findOne({ email: email.toLowerCase() });
  },

  // Get approved sellers
  getApprovedSellers: function() {
    return this.find({
      role: 'seller',
      'sellerInfo.isApproved': true
    });
  },

  // Get user statistics
  getUserStats: async function() {
    return await this.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);
  }
};

module.exports = mongoose.model('User', userSchema);
