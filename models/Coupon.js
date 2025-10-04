const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true
  },
  value: {
    type: Number,
    required: true,
    min: 0
  },
  minimumOrderValue: {
    type: Number,
    default: 0
  },
  maximumDiscount: {
    type: Number,
    default: null
  },
  usageLimit: {
    type: Number,
    default: null // null means unlimited
  },
  usageCount: {
    type: Number,
    default: 0
  },
  userUsageLimit: {
    type: Number,
    default: 1 // How many times a single user can use this coupon
  },
  validFrom: {
    type: Date,
    required: true
  },
  validUntil: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  applicableProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  applicableCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  excludeProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  excludeCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  userRestrictions: {
    type: {
      type: String,
      enum: ['all', 'new', 'existing', 'specific'],
      default: 'all'
    },
    specificUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Indexes
couponSchema.index({ code: 1 });
couponSchema.index({ validFrom: 1, validUntil: 1 });
couponSchema.index({ isActive: 1 });

// Method to check if coupon is valid
couponSchema.methods.isValid = function() {
  const now = new Date();
  return this.isActive && 
         now >= this.validFrom && 
         now <= this.validUntil &&
         (this.usageLimit === null || this.usageCount < this.usageLimit);
};

// Method to check if user can use this coupon
couponSchema.methods.canUserUse = async function(userId) {
  if (!this.isValid()) return false;
  
  // Check user restrictions
  if (this.userRestrictions.type === 'specific') {
    // Normalize types to avoid ObjectId vs string mismatches
    return this.userRestrictions.specificUsers
      .map(id => id.toString())
      .includes(userId.toString());
  }
  
  // Check user usage limit
  const Order = mongoose.model('Order');
  const userUsageCount = await Order.countDocuments({
    user: userId,
    'appliedCoupons.code': this.code, // ✅ FIXED: correct field
    status: { $nin: ['cancelled', 'failed'] }
  });
  
  return userUsageCount < this.userUsageLimit;
};

// Method to calculate discount
couponSchema.methods.calculateDiscount = function(orderValue, applicableAmount = null) {
  if (!this.isValid() || orderValue < this.minimumOrderValue) {
    return 0;
  }
  
  const baseAmount = applicableAmount || orderValue;
  let discount = 0;
  
  if (this.type === 'percentage') {
    discount = (baseAmount * this.value) / 100;
  } else {
    discount = this.value;
  }
  
  // Apply maximum discount limit
  if (this.maximumDiscount && discount > this.maximumDiscount) {
    discount = this.maximumDiscount;
  }
  
  // Ensure discount doesn't exceed order value
  return Math.min(discount, orderValue);
};

module.exports = mongoose.models.coupon || mongoose.model('coupon', couponSchema);
