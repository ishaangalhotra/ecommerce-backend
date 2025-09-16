const mongoose = require('mongoose');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');

/**
 * QuickLocal User Profile Model
 * This model stores user data not handled by Supabase Auth.
 */

const UserSchema = new mongoose.Schema({
  // Link to Supabase Auth user record
  supabaseId: {
    type: String,
    required: true,
    index: true,
    unique: true
  },

  // Unique Identifiers
  email: {
    type: String,
    required: false,
    lowercase: true,
    trim: true,
    sparse: true,
    validate: {
      validator: function(v) {
        return !v || validator.isEmail(v);
      },
      message: 'Please provide a valid email'
    }
  },
  phone: {
    type: String,
    sparse: true,
    validate: {
      validator: function (v) {
        return !v || validator.isMobilePhone(v, 'en-IN');
      },
      message: 'Please provide a valid Indian phone number'
    }
  },

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
  profilePicture: {
    type: String
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters']
  },

  // Other data
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

// Indexes
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });
UserSchema.index({ lastActiveAt: -1 });
UserSchema.index({ role: 1, isActive: 1, createdAt: -1 });
UserSchema.index({ isActive: 1, isVerified: 1 });
UserSchema.index({ isDeleted: 1 });
UserSchema.index({ role: 1, isVerified: 1, isActive: 1 });
UserSchema.index({ name: 'text', email: 'text' }, { weights: { name: 5, email: 3 }, name: 'user_search_index' });

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
UserSchema.query.notDeleted = function () {
  return this.where({ isDeleted: false });
};

const User = mongoose.model('User', UserSchema);

module.exports = User;