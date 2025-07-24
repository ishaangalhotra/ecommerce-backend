const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

/**
 * FIXED User Model - No Duplicate Indexes
 */

const UserSchema = new mongoose.Schema({
  // Unique Identifiers - REMOVED index definitions from field level
  uuid: {
    type: String,
    default: uuidv4,
    // REMOVED: index: true, unique: true (will be defined in schema.index())
    immutable: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    // REMOVED: unique: true, index: true (will be defined in schema.index())
    lowercase: true,
    trim: true,
    validate: {
      validator: validator.isEmail,
      message: 'Please provide a valid email'
    }
  },
  phone: {
    type: String,
    // REMOVED: unique: true (will be defined in schema.index())
    sparse: true,
    validate: {
      validator: function(v) {
        return !v || validator.isMobilePhone(v, 'en-IN');
      },
      message: 'Please provide a valid Indian phone number'
    }
  },

  // Authentication & Security
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [12, 'Password must be at least 12 characters'],
    select: false
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  
  // Email Verification
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  verifiedAt: Date,
  
  // Security tracking
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: Date,
  loginHistory: [{
    ip: String,
    userAgent: String,
    location: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],

  // Personal Information
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters'],
    minlength: [2, 'Name must be at least 2 characters']
  },
  dateOfBirth: {
    type: Date,
    validate: {
      validator: function(dob) {
        if (!dob) return true;
        const age = (new Date() - dob) / (365.25 * 24 * 60 * 60 * 1000);
        return age >= 13 && age <= 120;
      },
      message: 'Must be between 13-120 years old'
    }
  },
  gender: {
    type: String,
    enum: {
      values: ['male', 'female', 'other', 'prefer_not_to_say'],
      message: 'Gender must be male, female, other, or prefer_not_to_say'
    }
  },

  // Wallet & Finance
  walletBalance: {
    type: Number,
    default: 0,
    min: 0
  },

  // Addresses
  addresses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address'
  }],

  // Account Status
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false,
    select: false
  },
  deletedAt: Date,

  // Roles and Permissions
  role: {
    type: String,
    enum: ['customer', 'seller', 'admin', 'super_admin', 'delivery_agent'],
    default: 'customer'
  },
  permissions: [{
    type: String,
    enum: ['read', 'write', 'delete', 'manage_users']
  }],

  // Timestamps
  lastLoginAt: Date,
  lastActiveAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  versionKey: '__v'
});

// ==================== FIXED INDEXES (No Duplicates) ====================

// Core unique indexes
UserSchema.index({ uuid: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });

// Security-related indexes
UserSchema.index({ emailVerificationToken: 1 });
UserSchema.index({ passwordResetToken: 1 });

// Query optimization indexes
UserSchema.index({ role: 1, isActive: 1, createdAt: -1 });
UserSchema.index({ isActive: 1, isVerified: 1 });
UserSchema.index({ isDeleted: 1 });

// Text search index
UserSchema.index({
  name: 'text',
  email: 'text'
}, {
  weights: {
    name: 5,
    email: 3
  },
  name: 'user_search_index'
});

// ==================== MIDDLEWARE ====================

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    this.password = await bcrypt.hash(this.password, 12);
    if (!this.isNew) this.passwordChangedAt = Date.now() - 1000;
    next();
  } catch (err) {
    next(err);
  }
});

UserSchema.pre(/^find/, function(next) {
  if (this.getFilter().isDeleted === undefined) {
    this.where({ isDeleted: false });
  }
  next();
});

// ==================== VIRTUAL PROPERTIES ====================

UserSchema.virtual('age').get(function() {
  if (!this.dateOfBirth) return null;
  return Math.floor((new Date() - this.dateOfBirth) / (3.15576e+10));
});

UserSchema.virtual('profileCompletion').get(function() {
  const requiredFields = ['name', 'email', 'phone', 'dateOfBirth'];
  const completedFields = requiredFields.filter(field => this[field]);
  return Math.round((completedFields.length / requiredFields.length) * 100);
});

UserSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ==================== INSTANCE METHODS ====================

UserSchema.methods.getSignedJwtToken = function() {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

UserSchema.methods.correctPassword = async function(candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword || this.password);
};

UserSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

UserSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

UserSchema.methods.createEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
  return verificationToken;
};

UserSchema.methods.incLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
  }
  
  return this.updateOne(updates);
};

UserSchema.methods.addLoginHistory = function(ip, userAgent, location) {
  this.loginHistory.unshift({
    ip,
    userAgent,
    location,
    timestamp: new Date()
  });
  
  if (this.loginHistory.length > 10) {
    this.loginHistory = this.loginHistory.slice(0, 10);
  }
  
  return this.save();
};

// ==================== STATIC METHODS ====================

UserSchema.statics.findByEmailOrPhone = async function(identifier) {
  return this.findOne({
    $or: [
      { email: identifier },
      { phone: identifier }
    ]
  });
};

UserSchema.statics.getUserStats = async function() {
  return this.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        activeUsers: {
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
        },
        verifiedUsers: {
          $sum: { $cond: [{ $eq: ['$isVerified', true] }, 1, 0] }
        }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

// ==================== QUERY HELPERS ====================

UserSchema.query.active = function() {
  return this.where({ isActive: true });
};

UserSchema.query.verified = function() {
  return this.where({ isVerified: true });
};

UserSchema.query.byRole = function(role) {
  return this.where({ role });
};

UserSchema.query.notLocked = function() {
  return this.where({
    $or: [
      { lockUntil: { $exists: false } },
      { lockUntil: { $lt: Date.now() } }
    ]
  });
};
module.exports = mongoose.models.User || mongoose.model('User', UserSchema);