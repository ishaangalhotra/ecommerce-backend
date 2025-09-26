// models/Payment.js
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  paymentGateway: {
    type: String,
    required: true,
    enum: ['razorpay', 'stripe', 'paypal', 'cash'],
    index: true
  },
  gatewayOrderId: {
    type: String,
    required: function() {
      return this.paymentGateway !== 'cash';
    },
    index: true
  },
  gatewayPaymentId: {
    type: String,
    index: true
  },
  gatewaySignature: {
    type: String
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'INR',
    enum: ['INR', 'USD', 'EUR', 'GBP']
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pending',
    index: true
  },
  paidAt: {
    type: Date,
    index: true
  },
  // Refund related fields
  refundAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  refundStatus: {
    type: String,
    enum: ['none', 'pending', 'completed', 'failed'],
    default: 'none'
  },
  refundId: {
    type: String
  },
  refundedAt: {
    type: Date
  },
  refundReason: {
    type: String
  },
  // Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Payment method details
  paymentMethod: {
    type: String, // card, upi, netbanking, wallet, etc.
  },
  // Customer details
  customerDetails: {
    name: String,
    email: String,
    phone: String
  },
  // Transaction fees
  platformFee: {
    type: Number,
    default: 0
  },
  gatewayFee: {
    type: Number,
    default: 0
  },
  // Error handling
  errorCode: String,
  errorMessage: String,
  // Webhook data
  webhookData: {
    type: mongoose.Schema.Types.Mixed
  },
  webhookVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
paymentSchema.index({ orderId: 1, status: 1 });
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ paymentGateway: 1, status: 1 });
paymentSchema.index({ paidAt: 1 }, { sparse: true });
paymentSchema.index({ refundedAt: 1 }, { sparse: true });

// Virtual for net amount (amount - refundAmount)
paymentSchema.virtual('netAmount').get(function() {
  return this.amount - this.refundAmount;
});

// Virtual for payment gateway display name
paymentSchema.virtual('gatewayDisplayName').get(function() {
  const names = {
    razorpay: 'Razorpay',
    stripe: 'Stripe',
    paypal: 'PayPal',
    cash: 'Cash on Delivery'
  };
  return names[this.paymentGateway] || this.paymentGateway;
});

// Methods
paymentSchema.methods.markAsPaid = function() {
  this.status = 'completed';
  this.paidAt = new Date();
  return this.save();
};

paymentSchema.methods.markAsFailed = function(errorCode, errorMessage) {
  this.status = 'failed';
  this.errorCode = errorCode;
  this.errorMessage = errorMessage;
  return this.save();
};

paymentSchema.methods.processRefund = function(amount, reason) {
  this.refundAmount = amount;
  this.refundStatus = 'pending';
  this.refundReason = reason;
  if (amount >= this.amount) {
    this.status = 'refunded';
  }
  return this.save();
};

// Static methods
paymentSchema.statics.findByOrder = function(orderId) {
  return this.findOne({ orderId, status: { $ne: 'failed' } })
    .populate('orderId')
    .populate('userId', 'name email');
};

paymentSchema.statics.getRevenueByDateRange = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        status: 'completed',
        paidAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$paidAt' },
          month: { $month: '$paidAt' },
          day: { $dayOfMonth: '$paidAt' }
        },
        totalRevenue: { $sum: '$amount' },
        totalTransactions: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
    }
  ]);
};

// Pre-save middleware
paymentSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status === 'completed' && !this.paidAt) {
    this.paidAt = new Date();
  }
  next();
});

// Post-save middleware for logging
paymentSchema.post('save', function(doc) {
  console.log(`Payment ${doc._id} updated - Status: ${doc.status}, Amount: ${doc.amount}`);
});

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;