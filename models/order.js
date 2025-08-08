// models/Order.js

const mongoose = require('mongoose');

// 🧾 Enhanced Schema for Order Items
const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product reference is required']
  },
  name: { 
    type: String, 
    required: [true, 'Product name is required'],
    trim: true
  },
  slug: String,
  sku: String,
  qty: { 
    type: Number, 
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1']
  },
  unitPrice: { 
    type: Number, 
    required: [true, 'Unit price is required'],
    min: [0, 'Price must be at least 0']
  },
  totalPrice: {
    type: Number,
    required: true,
    min: [0, 'Total price must be at least 0']
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  image: { 
    type: String, 
    required: [true, 'Product image is required'] 
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  
  // Product variant information
  variant: {
    color: String,
    size: String,
    weight: String,
    specifications: Map
  },
  
  // Item-specific delivery info
  deliveryInfo: {
    estimatedDeliveryTime: Number, // minutes
    preparationTime: Number,
    deliveryFee: { type: Number, default: 0 },
    isExpressDelivery: { type: Boolean, default: false }
  },
  
  // Item status tracking
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled', 'returned'],
    default: 'pending'
  },
  
  // Return/Refund information
  returnInfo: {
    isReturnable: { type: Boolean, default: true },
    returnWindow: { type: Number, default: 7 }, // days
    returnReason: String,
    returnStatus: {
      type: String,
      enum: ['none', 'requested', 'approved', 'rejected', 'completed']
    }
  }
}, { _id: true, timestamps: true });

// 📦 Enhanced Order Schema
const orderSchema = new mongoose.Schema({
  // Order identification
  orderNumber: {
    type: String,
    unique: true,
    uppercase: true
  },
  
  // Customer information
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required'],
    index: true
  },
  customerInfo: {
    name: String,
    email: String,
    phone: String
  },
  
  // Order items
  orderItems: {
    type: [orderItemSchema],
    validate: [arr => arr.length > 0, 'Order must have at least 1 item']
  },
  
  // Enhanced shipping information
  shippingAddress: {
    fullName: { type: String, required: [true, 'Full name is required'] },
    address: { type: String, required: [true, 'Address is required'] },
    locality: String,
    city: { type: String, required: [true, 'City is required'] },
    state: String,
    postalCode: { type: String, required: [true, 'Postal code is required'] },
    country: { type: String, required: [true, 'Country is required'], default: 'India' },
    landmark: String,
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    },
    phoneNumber: String,
    deliveryInstructions: String
  },
  
  // Billing information
  billingAddress: {
    fullName: String,
    address: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
    isSameAsShipping: { type: Boolean, default: true }
  },
  
  // Enhanced payment information
  paymentMethod: {
    type: String,
    required: [true, 'Payment method is required'],
    enum: ['credit_card', 'debit_card', 'upi', 'wallet', 'net_banking', 'cod', 'razorpay', 'stripe'],
    default: 'cod'
  },
  paymentResult: {
    paymentId: String,
    orderId: String,
    signature: String,
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'refunded', 'partially_refunded']
    },
    transactionId: String,
    gateway: String, // razorpay, stripe, etc.
    method: String, // card, upi, wallet, etc.
    amount: Number,
    currency: { type: String, default: 'INR' },
    paidAt: Date,
    failureReason: String
  },
  
  // Pricing breakdown
  pricing: {
    itemsPrice: { type: Number, required: true, default: 0 },
    discountAmount: { type: Number, default: 0 },
    shippingPrice: { type: Number, default: 0 },
    taxPrice: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true, default: 0 },
    refundedAmount: { type: Number, default: 0 }
  },
  
  // Tax information
  taxDetails: {
    gstNumber: String,
    taxBreakdown: [{
      type: { type: String, enum: ['CGST', 'SGST', 'IGST', 'CESS'] },
      rate: Number,
      amount: Number
    }]
  },
  
  // Coupons and discounts
  appliedCoupons: [{
    code: String,
    discountAmount: Number,
    discountType: { type: String, enum: ['percentage', 'fixed'] }
  }],
  
  // Payment status
  isPaid: { type: Boolean, default: false, index: true },
  paidAt: Date,
  
  // Delivery tracking
  deliveryTracking: {
    isDelivered: { type: Boolean, default: false, index: true },
    deliveredAt: Date,
    estimatedDeliveryDate: Date,
    actualDeliveryTime: Number, // minutes
    deliveryPartner: String,
    trackingNumber: String,
    deliveryPersonInfo: {
      name: String,
      phone: String,
      vehicleNumber: String
    },
    deliveryProof: {
      image: String,
      signature: String,
      otp: String,
      verifiedBy: String
    }
  },
  
  // Order status and tracking
  status: {
    type: String,
    enum: [
      'pending', 'confirmed', 'preparing', 'ready_to_ship', 
      'shipped', 'out_for_delivery', 'delivered', 
      'cancelled', 'returned', 'refunded', 'failed'
    ],
    default: 'pending',
    index: true
  },
  
  // Status timeline
  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    note: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  // Cancellation information
  cancellationInfo: {
    reason: String,
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    cancelledAt: Date,
    refundStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed']
    },
    cancellationFee: { type: Number, default: 0 }
  },
  
  // Return information
  returnInfo: {
    isReturned: { type: Boolean, default: false },
    returnReason: String,
    returnRequestedAt: Date,
    returnApprovedAt: Date,
    returnPickedUpAt: Date,
    returnDeliveredAt: Date,
    refundAmount: Number,
    restockingFee: { type: Number, default: 0 }
  },
  
  // Special delivery options
  deliveryOptions: {
    isExpressDelivery: { type: Boolean, default: false },
    deliveryTimeSlot: {
      date: Date,
      startTime: String,
      endTime: String
    },
    specialInstructions: String,
    isContactlessDelivery: { type: Boolean, default: false }
  },
  
  // Communication logs
  communications: [{
    type: { type: String, enum: ['sms', 'email', 'call', 'whatsapp'] },
    message: String,
    sentAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['sent', 'delivered', 'failed'] }
  }],
  
  // Notes and comments
  notes: {
    customerNotes: String,
    adminNotes: String,
    sellerNotes: String
  },
  
  // Ratings and reviews
  feedback: {
    overallRating: { type: Number, min: 1, max: 5 },
    deliveryRating: { type: Number, min: 1, max: 5 },
    packagingRating: { type: Number, min: 1, max: 5 },
    comment: String,
    reviewedAt: Date,
    isReviewPublic: { type: Boolean, default: true }
  },
  
  // Analytics and metrics
  metrics: {
    processingTime: Number, // minutes from order to shipped
    deliveryTime: Number, // minutes from shipped to delivered
    totalOrderValue: Number,
    profitMargin: Number,
    customerSatisfactionScore: Number
  },
  
  // Multi-seller support
  sellers: [{
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    items: [mongoose.Schema.Types.ObjectId],
    subOrderTotal: Number,
    commissionRate: Number,
    commissionAmount: Number
  }],
  
  // Fraud detection
  fraudCheck: {
    riskScore: { type: Number, min: 0, max: 100, default: 0 },
    flags: [String],
    isVerified: { type: Boolean, default: false },
    verificationMethod: String
  }
  
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// 🔍 Indexes for better performance
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'paymentResult.status': 1 });
orderSchema.index({ 'deliveryTracking.isDelivered': 1 });
orderSchema.index({ 'shippingAddress.postalCode': 1 });
orderSchema.index({ 'orderItems.seller': 1, status: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'pricing.totalPrice': 1 });

// 📊 Enhanced Virtuals
orderSchema.virtual('orderAge').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)); // days
});

orderSchema.virtual('isCancelled').get(function() {
  return this.status === 'cancelled';
});

orderSchema.virtual('isReturned').get(function() {
  return this.status === 'returned' || this.returnInfo.isReturned;
});

orderSchema.virtual('canBeCancelled').get(function() {
  return ['pending', 'confirmed', 'preparing'].includes(this.status);
});

orderSchema.virtual('canBeReturned').get(function() {
  const deliveredDate = this.deliveryTracking.deliveredAt;
  if (!deliveredDate) return false;
  
  const daysSinceDelivery = (Date.now() - deliveredDate) / (1000 * 60 * 60 * 24);
  return daysSinceDelivery <= 7 && this.status === 'delivered';
});

orderSchema.virtual('estimatedDeliveryTime').get(function() {
  if (!this.orderItems.length) return 0;
  return Math.max(...this.orderItems.map(item => 
    (item.deliveryInfo?.estimatedDeliveryTime || 0) + (item.deliveryInfo?.preparationTime || 0)
  ));
});

orderSchema.virtual('totalItems').get(function() {
  return this.orderItems.reduce((total, item) => total + item.qty, 0);
});

orderSchema.virtual('uniqueSellers').get(function() {
  return [...new Set(this.orderItems.map(item => item.seller.toString()))];
});

// 📐 Enhanced Middleware
orderSchema.pre('save', async function(next) {
  try {
    // Generate order number for new orders
    if (this.isNew && !this.orderNumber) {
      const count = await this.constructor.countDocuments();
      this.orderNumber = `ORD${Date.now()}${String(count + 1).padStart(4, '0')}`;
    }
    
    // Auto-populate customer info from user
    if (this.isNew && !this.customerInfo.name) {
      const user = await mongoose.model('User').findById(this.user);
      if (user) {
        this.customerInfo = {
          name: user.name,
          email: user.email,
          phone: user.phone
        };
      }
    }
    
    // Calculate total items price
    this.pricing.itemsPrice = this.orderItems.reduce((total, item) => 
      total + (item.totalPrice || item.unitPrice * item.qty), 0
    );
    
    // Update product inventory only for new orders or quantity changes
    if (this.isNew || this.isModified('orderItems')) {
      for (const item of this.orderItems) {
        const Product = mongoose.model('Product');
        const product = await Product.findById(item.product);
        
        if (!product) {
          throw new Error(`Product not found: ${item.product}`);
        }
        
        // Check stock availability
        if (product.stock < item.qty) {
          throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.qty}`);
        }
        
        // Update product metrics only for new orders
        if (this.isNew) {
          product.stock -= item.qty;
          product.totalSales += item.qty;
          product.totalRevenue += item.totalPrice || (item.unitPrice * item.qty);
          await product.save();
        }
      }
    }
    
    // Add status to history
    if (this.isModified('status')) {
      this.statusHistory.push({
        status: this.status,
        timestamp: new Date(),
        note: `Status changed to ${this.status}`
      });
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Post-save middleware for notifications
orderSchema.post('save', async function(doc) {
  // Send notifications for status changes
  if (this.wasModified && this.wasModified('status')) {
    // Implement notification logic here
    console.log(`Order ${doc.orderNumber} status changed to ${doc.status}`);
  }
});

// 🧠 Enhanced Instance Methods
orderSchema.methods.addStatusUpdate = function(status, note, updatedBy) {
  this.status = status;
  this.statusHistory.push({
    status,
    note,
    updatedBy,
    timestamp: new Date()
  });
  return this.save();
};

orderSchema.methods.calculateDeliveryTime = function() {
  if (!this.deliveryTracking.deliveredAt || !this.createdAt) return null;
  return Math.round((this.deliveryTracking.deliveredAt - this.createdAt) / (1000 * 60)); // minutes
};

orderSchema.methods.canBeCancelledByUser = function() {
  const cancelableStatuses = ['pending', 'confirmed', 'preparing'];
  const timeLimitHours = 1; // User can cancel within 1 hour
  
  if (!cancelableStatuses.includes(this.status)) return false;
  
  const hoursSinceOrder = (Date.now() - this.createdAt) / (1000 * 60 * 60);
  return hoursSinceOrder <= timeLimitHours;
};

orderSchema.methods.initiateRefund = async function(amount, reason) {
  this.paymentResult.status = 'refunded';
  this.pricing.refundedAmount = amount || this.pricing.totalPrice;
  this.cancellationInfo = {
    reason,
    cancelledAt: new Date(),
    refundStatus: 'processing'
  };
  
  return this.save();
};

orderSchema.methods.sendNotification = async function(type, message) {
  this.communications.push({
    type,
    message,
    sentAt: new Date(),
    status: 'sent'
  });
  
  // Implement actual notification sending logic here
  console.log(`${type.toUpperCase()}: ${message}`);
  
  return this.save();
};

// 📊 Enhanced Static Methods
orderSchema.statics.getOrdersByUser = function(userId, page = 1, limit = 10) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .populate('orderItems.product', 'name slug images')
    .populate('orderItems.seller', 'name businessName')
    .exec();
};

orderSchema.statics.getOrdersBySeller = function(sellerId, status = null) {
  const query = { 'orderItems.seller': sellerId };
  if (status) query.status = status;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .populate('user', 'name email phone')
    .populate('orderItems.product', 'name slug images')
    .exec();
};

orderSchema.statics.getRevenueByDateRange = function(startDate, endDate, sellerId = null) {
  const match = {
    createdAt: { $gte: startDate, $lte: endDate },
    status: { $nin: ['cancelled', 'failed'] }
  };
  
  if (sellerId) {
    match['orderItems.seller'] = new mongoose.Types.ObjectId(sellerId);
  }
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$pricing.totalPrice' },
        totalOrders: { $sum: 1 },
        averageOrderValue: { $avg: '$pricing.totalPrice' }
      }
    }
  ]);
};

orderSchema.statics.getPopularProducts = function(limit = 10, sellerId = null) {
  const match = { 
    status: { $nin: ['cancelled', 'failed'] } 
  };
  
  if (sellerId) {
    match['orderItems.seller'] = new mongoose.Types.ObjectId(sellerId);
  }
  
  return this.aggregate([
    { $match: match },
    { $unwind: '$orderItems' },
    {
      $group: {
        _id: '$orderItems.product',
        totalQuantity: { $sum: '$orderItems.qty' },
        totalRevenue: { $sum: '$orderItems.totalPrice' },
        orderCount: { $sum: 1 }
      }
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'productInfo'
      }
    }
  ]);
};

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
