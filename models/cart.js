const mongoose = require('mongoose');

// Embedded subdocument schema for individual cart items
const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductVariant'
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  priceAtAdd: {
    type: Number,
    required: true
  },
  discountAtAdd: {
    type: Number,
    default: 0
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Main cart schema
const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Cart must belong to a user']
  },

  items: [cartItemSchema],

  savedItems: [cartItemSchema],

  appliedCoupons: [{
    code: { type: String, uppercase: true, trim: true },
    discountAmount: { type: Number, min: 0 },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    }
  }],

  shippingAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User.addresses'
  },

  status: {
    type: String,
    enum: ['active', 'abandoned', 'converted', 'expired'],
    default: 'active'
  },

  sessionId: {
    type: String
  },

  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  },

  lastModified: {
    type: Date,
    default: Date.now
  },

  metadata: {
    deviceType: {
      type: String,
      enum: ['mobile', 'tablet', 'desktop'],
      default: 'desktop'
    },
    platform: {
      type: String,
      enum: ['web', 'android', 'ios'],
      default: 'web'
    },
    abandonedRemindersSent: {
      type: Number,
      default: 0,
      max: 3
    },
    lastReminderSent: Date
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret) => {
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// ✅ SCHEMA-LEVEL INDEXES (only keep these)
cartSchema.index({ user: 1, status: 1 });
cartSchema.index({ sessionId: 1 }, { sparse: true });
cartSchema.index({ lastModified: -1 });
cartSchema.index({ status: 1, lastModified: -1 });
cartSchema.index({ status: 1, lastModified: -1, 'metadata.abandonedRemindersSent': 1 });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-delete

module.exports = mongoose.model('Cart', cartSchema);
