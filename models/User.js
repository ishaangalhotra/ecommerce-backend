const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

/**
 * Enhanced User Model with Authentication Features
 * Fixed duplicate index warnings
 */

const UserSchema = new mongoose.Schema({
  // Unique Identifiers
  uuid: {
    type: String,
    default: uuidv4,
    immutable: true
  },
  email: {
    type: String,
    required: false, // Made optional
    lowercase: true,
    trim: true,
    sparse: true, // Allow null/undefined values in unique index
    validate: {
      validator: function(v) {
        return !v || validator.isEmail(v);
      },
      message: 'Please provide a valid email'
    }
  },
  phone: {
    type: String,
    // Removed 'sparse: true' since we define the index explicitly below
    validate: {
      validator: function (v) {
        return !v || validator.isMobilePhone(v, 'en-IN');
      },
      message: 'Please provide a valid Indian phone number'
    }
  },

  // Authentication & Security
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'], // <-- FIXED
    select: false
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,

  refreshToken: {
    type: String,
    select: false
  },
  tokenVersion: {
    type: Number,
    default: 0
  },

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
    rememberMe: {
      type: Boolean,
      default: false
    },
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
      validator: function (dob) {
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

  privacy: {
    shareToken: { type: String },
    isProfilePublic: { type: Boolean, default: false },
    allowLocationSharing: { type: Boolean, default: true }
  },

  walletBalance: {
    type: Number,
    default: 0,
    min: 0
  },

  addresses: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address'
  }],

  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false, select: false },
  deletedAt: Date,

  role: {
    type: String,
    enum: ['customer', 'seller', 'admin', 'super_admin', 'delivery_agent'],
    default: 'customer'
  },
  permissions: [{
    type: String,
    enum: ['read', 'write', 'delete', 'manage_users']
  }],

  lastLoginAt: Date,
  lastActiveAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  versionKey: '__v'
});

// Indexes - Fixed duplicate index issue
UserSchema.index({ uuid: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true }); // Keep sparse here in index definition
UserSchema.index({ emailVerificationToken: 1 }, { sparse: true });
UserSchema.index({ passwordResetToken: 1 }, { sparse: true });
UserSchema.index({ 'privacy.shareToken': 1 }, { unique: true, sparse: true });
UserSchema.index({ refreshToken: 1 }, { sparse: true });
UserSchema.index({ tokenVersion: 1 });
UserSchema.index({ lastActiveAt: -1 });
UserSchema.index({ role: 1, isActive: 1, createdAt: -1 });
UserSchema.index({ isActive: 1, isVerified: 1 });
UserSchema.index({ isDeleted: 1 });
UserSchema.index({ role: 1, isVerified: 1, isActive: 1 });
UserSchema.index({ loginAttempts: 1, lockUntil: 1 });
UserSchema.index(
  { name: 'text', email: 'text' },
  { weights: { name: 5, email: 3 }, name: 'user_search_index' }
);

// Validation - ensure either email or phone is provided
UserSchema.pre('save', function(next) {
  if (!this.email && !this.phone) {
    return next(new Error('Either email or phone number must be provided'));
  }
  next();
});

// Middleware
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.passwordChangedAt = Date.now() - 1000;
  next();
});

UserSchema.pre('save', function (next) {
  if (this.isModified('lastLoginAt')) {
    this.lastActiveAt = new Date();
  }
  next();
});

UserSchema.pre('save', function (next) {
  if (!this.privacy.shareToken && this.privacy.isProfilePublic) {
    this.privacy.shareToken = crypto.randomBytes(16).toString('hex');
  }
  next();
});

UserSchema.pre(/^find/, function (next) {
  if (this.getFilter().isDeleted === undefined) {
    this.where({ isDeleted: false });
  }
  next();
});

// Virtuals
UserSchema.virtual('age').get(function () {
  if (!this.dateOfBirth) return null;
  return Math.floor((new Date() - this.dateOfBirth) / (3.15576e+10));
});

UserSchema.virtual('profileCompletion').get(function () {
  const requiredFields = ['name', 'email', 'phone', 'dateOfBirth'];
  const completedFields = requiredFields.filter(field => this[field]);
  return Math.round((completedFields.length / requiredFields.length) * 100);
});

UserSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

UserSchema.virtual('hasActiveSessions').get(function () {
  return !!(this.refreshToken);
});

// Methods
UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign(
    { id: this._id, tokenVersion: this.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '15m' }
  );
};

UserSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    { id: this._id, type: 'refresh', version: this.tokenVersion || 0 },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' }
  );
};

UserSchema.methods.isRefreshTokenValid = function (token) {
  return this.refreshToken === token;
};

UserSchema.methods.invalidateAllTokens = async function () {
  this.tokenVersion = (this.tokenVersion || 0) + 1;
  this.refreshToken = undefined;
  return this.save({ validateBeforeSave: false });
};

UserSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword || this.password);
};

UserSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

UserSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

UserSchema.methods.createEmailVerificationToken = function () {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
  return verificationToken;
};

UserSchema.methods.incLoginAttempts = function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $unset: { lockUntil: 1 }, $set: { loginAttempts: 1 } });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 };
  }
  return this.updateOne(updates);
};

UserSchema.methods.addLoginHistory = function (ip, userAgent, location, rememberMe = false) {
  this.loginHistory.unshift({ ip, userAgent, location, rememberMe, timestamp: new Date() });
  if (this.loginHistory.length > 10) {
    this.loginHistory = this.loginHistory.slice(0, 10);
  }
  return this.save();
};

UserSchema.methods.cleanupExpiredTokens = async function () {
  if (this.passwordResetExpires && this.passwordResetExpires < Date.now()) {
    this.passwordResetToken = undefined;
    this.passwordResetExpires = undefined;
  }
  if (this.emailVerificationExpires && this.emailVerificationExpires < Date.now()) {
    this.emailVerificationToken = undefined;
    this.emailVerificationExpires = undefined;
  }
  return this.save({ validateBeforeSave: false });
};

// Statics
UserSchema.statics.findByEmailOrPhone = async function (identifier) {
  return this.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
};

UserSchema.statics.getUserStats = async function () {
  return this.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        activeUsers: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
        verifiedUsers: { $sum: { $cond: [{ $eq: ['$isVerified', true] }, 1, 0] } }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

UserSchema.statics.getActiveSessionStats = async function () {
  return this.aggregate([
    { $match: { refreshToken: { $exists: true, $ne: null } } },
    { $group: { _id: '$role', activeSessions: { $sum: 1 } } }
  ]);
};

UserSchema.statics.cleanupExpiredTokens = async function () {
  const now = Date.now();
  return this.updateMany(
    {
      $or: [
        { passwordResetExpires: { $lt: now } },
        { emailVerificationExpires: { $lt: now } }
      ]
    },
    {
      $unset: {
        passwordResetToken: 1,
        passwordResetExpires: 1,
        emailVerificationToken: 1,
        emailVerificationExpires: 1
      }
    }
  );
};

// Query Helpers
UserSchema.query.active = function () {
  return this.where({ isActive: true });
};
UserSchema.query.verified = function () {
  return this.where({ isVerified: true });
};
UserSchema.query.byRole = function (role) {
  return this.where({ role });
};
UserSchema.query.notLocked = function () {
  return this.where({ $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lt: Date.now() } }] });
};
UserSchema.query.withActiveSessions = function () {
  return this.where({ refreshToken: { $exists: true, $ne: null } });
};
UserSchema.query.recentlyActive = function (hours = 24) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.where({ lastActiveAt: { $gte: cutoff } });
};

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
