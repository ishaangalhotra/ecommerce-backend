const mongoose = require('mongoose');
const crypto = require('crypto');

// Geo schema for location tracking
const geoSchema = new mongoose.Schema({
  type: {
    type: String,
    default: 'Point',
    enum: ['Point']
  },
  coordinates: {
    type: [Number], // [lng, lat] - REMOVED index from here
    validate: {
      validator: function(coords) {
        return coords.length === 2 && 
               coords[0] >= -180 && coords[0] <= 180 && // longitude
               coords[1] >= -90 && coords[1] <= 90;     // latitude
      },
      message: 'Invalid coordinates format'
    }
  },
  address: {
    type: String,
    trim: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Product schema for order items
const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  // Snapshot data at order time (prevents data loss if product is deleted/modified)
  productSnapshot: {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: String,
    image: String,
    sku: String,
    category: String,
    brand: String
  },
  // Variant information
  variant: {
    size: String,
    color: String,
    style: String,
    weight: String
  },
  // Pricing information
  price: {
    type: Number,
    required: true,
    min: [0, 'Price cannot be negative']
  },
  originalPrice: {
    type: Number,
    min: [0, 'Original price cannot be negative']
  },
  discount: {
    amount: {
      type: Number,
      default: 0,
      min: 0
    },
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'fixed'
    }
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
    max: [1000, 'Quantity cannot exceed 1000'],
    validate: {
      validator: Number.isInteger,
      message: 'Quantity must be an integer'
    }
  },
  // Item status (for partial fulfillment)
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'],
    default: 'pending'
  },
  // Tax information
  tax: {
    rate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    amount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  // Seller information for marketplace
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { _id: true });

const orderSchema = new mongoose.Schema({
  // Order Identification
  orderNumber: {
    type: String,
    required: true,
  },
  
  // Customer Information
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Guest order support
  guestInfo: {
    name: String,
    email: {
      type: String,
      lowercase: true,
      validate: {
        validator: function(email) {
          return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        },
        message: 'Invalid email format'
      }
    },
    phone: String
  },
  
  // Order Items
  items: {
    type: [orderItemSchema],
    validate: {
      validator: function(items) {
        return items && items.length > 0;
      },
      message: 'Order must have at least one item'
    }
  },
  
  // Shipping Information
  shipping: {
    address: {
      type: {
        type: String,
        enum: ['home', 'work', 'other'],
        default: 'home'
      },
      name: {
        type: String,
        required: true,
        trim: true
      },
      phone: {
        type: String,
        required: true
      },
      street: {
        type: String,
        required: true,
        trim: true
      },
      landmark: {
        type: String,
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
        default: 'India',
        trim: true
      },
      coordinates: {
        type: [Number] // [lng, lat] - REMOVED index from here
      }
    },
    method: {
      type: String,
      enum: ['standard', 'express', 'priority', 'same-day'],
      default: 'standard'
    },
    cost: {
      type: Number,
      default: 0,
      min: 0
    },
    estimatedDelivery: Date,
    actualDelivery: Date,
    trackingNumber: {
      type: String,
      sparse: true
    },
    carrier: {
      type: String,
      enum: ['bluedart', 'delhivery', 'fedex', 'dtdc', 'ekart', 'xpressbees'],
      trim: true
    }
  },
  
  // Payment Information
  payment: {
    method: {
      type: String,
      required: true,
      enum: ['COD', 'card', 'upi', 'netbanking', 'wallet', 'emi'],
      default: 'COD'
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending'
    },
    transactionId: {
      type: String,
      sparse: true
    },
    gateway: {
      type: String,
      enum: ['razorpay', 'stripe', 'paytm', 'phonepe', 'gpay'],
      trim: true
    },
    paidAt: Date,
    failureReason: String
  },
  
  // Order Totals
  pricing: {
    subtotal: {
      type: Number,
      required: true,
      min: 0
    },
    shippingCost: {
      type: Number,
      default: 0,
      min: 0
    },
    tax: {
      type: Number,
      default: 0,
      min: 0
    },
    discount: {
      amount: {
        type: Number,
        default: 0,
        min: 0
      },
      coupons: [{
        code: {
          type: String,
          uppercase: true
        },
        discount: Number,
        type: {
          type: String,
          enum: ['percentage', 'fixed']
        }
      }]
    },
    total: {
      type: Number,
      required: true,
      min: 0
    }
  },
  
  // Order Status
  status: {
    type: String,
    enum: [
      'pending',           // Order placed, awaiting confirmation
      'confirmed',         // Order confirmed, processing started
      'processing',        // Items being prepared
      'packed',           // Items packed, ready for pickup
      'shipped',          // Order shipped
      'out_for_delivery', // Out for delivery
      'delivered',        // Successfully delivered
      'cancelled',        // Order cancelled
      'returned',         // Order returned
      'refunded',         // Order refunded
      'failed'            // Order failed
    ],
    default: 'pending'
  },
  
  // Status History
  statusHistory: [{
    status: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    reason: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: String,
    location: geoSchema
  }],
  
  // Delivery Information
  delivery: {
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'assigned', 'picked', 'enroute', 'delivered', 'failed', 'returned'],
      default: 'pending'
    },
    assignedAt: Date,
    pickedAt: Date,
    deliveredAt: Date,
    attempts: {
      type: Number,
      default: 0,
      max: 3
    },
    instructions: String,
    otp: {
      type: String,
      select: false
    },
    // Real-time tracking
    tracking: [{
      status: String,
      timestamp: {
        type: Date,
        default: Date.now
      },
      location: geoSchema,
      notes: String,
      photo: String // Delivery proof
    }],
    // Distance and time estimates
    distance: Number, // in meters
    estimatedTime: Number, // in minutes
    actualTime: Number
  },
  
  // Returns and Refunds
  returns: {
    requested: {
      type: Boolean,
      default: false
    },
    requestDate: Date,
    reason: {
      type: String,
      enum: [
        'damaged',
        'defective',
        'wrong_item',
        'not_as_described',
        'size_issue',
        'quality_issue',
        'changed_mind',
        'other'
      ]
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'picked', 'received', 'refunded'],
      default: 'pending'
    },
    refundAmount: {
      type: Number,
      min: 0
    },
    processedAt: Date,
    notes: String
  },
  
  // Customer Communication
  customerNotes: String,
  internalNotes: String,
  
  // Rating and Reviews
  rating: {
    overall: {
      type: Number,
      min: 1,
      max: 5
    },
    delivery: {
      type: Number,
      min: 1,
      max: 5
    },
    ratedAt: Date,
    review: {
      type: String,
      maxlength: 1000
    }
  },
  
  // Notifications
  notifications: {
    sms: {
      sent: {
        type: Boolean,
        default: false
      },
      lastSent: Date
    },
    email: {
      sent: {
        type: Boolean,
        default: false
      },
      lastSent: Date
    },
    push: {
      sent: {
        type: Boolean,
        default: false
      },
      lastSent: Date
    }
  },
  
  // Metadata - ADDED sessionId field to fix warning
  metadata: {
    source: {
      type: String,
      enum: ['web', 'mobile_app', 'api', 'admin'],
      default: 'web'
    },
    device: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet'],
      default: 'desktop'
    },
    userAgent: String,
    ipAddress: String,
    sessionId: String, // ADDED this field
    cartId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cart'
    }
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

// FIXED: Single index definitions (no duplicates)
orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ user: 1, status: 1 });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'delivery.agent': 1, 'delivery.status': 1 });
orderSchema.index({ 'shipping.address.coordinates': '2dsphere' });
orderSchema.index({ 'metadata.sessionId': 1 }); // FIXED: Added missing sessionId index

// Text search index
orderSchema.index({
  orderNumber: 'text',
  'items.productSnapshot.name': 'text',
  'shipping.address.name': 'text'
});

// Compound indexes for better performance
orderSchema.index({ user: 1, 'payment.status': 1, createdAt: -1 });
orderSchema.index({ 'delivery.agent': 1, createdAt: -1 });
orderSchema.index({ status: 1, 'payment.status': 1 });

// Pre-save middleware
orderSchema.pre('save', async function(next) {
  try {
    // Generate order number if new
    if (this.isNew && !this.orderNumber) {
      this.orderNumber = await this.constructor.generateOrderNumber();
    }
    
    // Calculate totals
    this.calculateTotals();
    
    // Update status history
    if (this.isModified('status')) {
      this.statusHistory.push({
        status: this.status,
        timestamp: new Date(),
        reason: 'Status updated'
      });
    }
    
    // Generate delivery OTP for COD orders
    if (this.payment.method === 'COD' && this.status === 'out_for_delivery' && !this.delivery.otp) {
      this.delivery.otp = crypto.randomInt(100000, 999999).toString();
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Virtual properties
orderSchema.virtual('itemCount').get(function() {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

orderSchema.virtual('canBeCancelled').get(function() {
  return ['pending', 'confirmed', 'processing'].includes(this.status);
});

orderSchema.virtual('canBeReturned').get(function() {
  const deliveredDate = this.delivery.deliveredAt || this.statusHistory.find(h => h.status === 'delivered')?.timestamp;
  if (!deliveredDate) return false;
  
  const daysSinceDelivery = (Date.now() - deliveredDate) / (1000 * 60 * 60 * 24);
  return daysSinceDelivery <= 7; // 7 days return policy
});

orderSchema.virtual('isDelivered').get(function() {
  return this.status === 'delivered';
});

orderSchema.virtual('estimatedDeliveryDate').get(function() {
  if (this.shipping.estimatedDelivery) return this.shipping.estimatedDelivery;
  
  // Calculate based on shipping method
  const deliveryDays = {
    'same-day': 0,
    'express': 1,
    'priority': 2,
    'standard': 3
  };
  
  const days = deliveryDays[this.shipping.method] || 3;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
});

// Instance Methods
orderSchema.methods = {
  // Calculate order totals
  calculateTotals: function() {
    // Calculate subtotal
    this.pricing.subtotal = this.items.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);
    
    // Calculate tax
    this.pricing.tax = this.items.reduce((sum, item) => {
      return sum + (item.tax?.amount || 0);
    }, 0);
    
    // Calculate total
    this.pricing.total = this.pricing.subtotal + 
                        this.pricing.shippingCost + 
                        this.pricing.tax - 
                        this.pricing.discount.amount;
    
    return this.pricing.total;
  },

  // Update order status
  updateStatus: function(newStatus, reason = '', updatedBy = null, notes = '') {
    const oldStatus = this.status;
    this.status = newStatus;
    
    // Add to status history
    this.statusHistory.push({
      status: newStatus,
      timestamp: new Date(),
      reason: reason || `Status changed from ${oldStatus} to ${newStatus}`,
      updatedBy,
      notes
    });
    
    // Update delivery status accordingly
    const statusMapping = {
      'packed': 'picked',
      'shipped': 'enroute',
      'out_for_delivery': 'enroute',
      'delivered': 'delivered',
      'cancelled': 'failed'
    };
    
    if (statusMapping[newStatus]) {
      this.delivery.status = statusMapping[newStatus];
    }
    
    return this.save();
  },

  // Add tracking update
  addTrackingUpdate: function(status, location, notes = '', photo = '') {
    this.delivery.tracking.push({
      status,
      timestamp: new Date(),
      location,
      notes,
      photo
    });
    
    return this.save();
  },

  // Cancel order
  cancel: function(reason = 'Customer request', cancelledBy = null) {
    if (!this.canBeCancelled) {
      throw new Error('Order cannot be cancelled at this stage');
    }
    
    return this.updateStatus('cancelled', reason, cancelledBy);
  },

  // Request return
  requestReturn: function(reason, notes = '') {
    if (!this.canBeReturned) {
      throw new Error('Return period has expired');
    }
    
    this.returns = {
      requested: true,
      requestDate: new Date(),
      reason,
      status: 'pending',
      notes
    };
    
    return this.save();
  },

  // Generate invoice data
  getInvoiceData: function() {
    return {
      orderNumber: this.orderNumber,
      orderDate: this.createdAt,
      items: this.items,
      pricing: this.pricing,
      shipping: this.shipping.address,
      customer: this.guestInfo || 'User data'
    };
  },

  // Get order summary
  getSummary: function() {
    return {
      orderNumber: this.orderNumber,
      status: this.status,
      itemCount: this.itemCount,
      total: this.pricing.total,
      estimatedDelivery: this.estimatedDeliveryDate,
      canCancel: this.canBeCancelled,
      canReturn: this.canBeReturned
    };
  }
};

// Static Methods
orderSchema.statics = {
  // Generate unique order number
  generateOrderNumber: async function() {
    const prefix = 'ORD';
    const timestamp = Date.now().toString().slice(-8);
    const random = crypto.randomInt(1000, 9999);
    
    let orderNumber;
    let attempts = 0;
    
    do {
      orderNumber = `${prefix}${timestamp}${random + attempts}`;
      attempts++;
      
      const exists = await this.findOne({ orderNumber });
      if (!exists) break;
      
      if (attempts > 10) {
        throw new Error('Unable to generate unique order number');
      }
    } while (true);
    
    return orderNumber;
  },

  // Find orders by status
  findByStatus: function(status) {
    return this.find({ status }).sort({ createdAt: -1 });
  },

  // Find orders by date range
  findByDateRange: function(startDate, endDate) {
    return this.find({
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    }).sort({ createdAt: -1 });
  },

  // Get order statistics
  getOrderStats: async function(dateRange = {}) {
    const matchStage = {};
    if (dateRange.start && dateRange.end) {
      matchStage.createdAt = {
        $gte: dateRange.start,
        $lte: dateRange.end
      };
    }
    
    return await this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$pricing.total' },
          avgOrderValue: { $avg: '$pricing.total' }
        }
      },
      { $sort: { count: -1 } }
    ]);
  },

  // Find orders needing delivery
  findPendingDeliveries: function(agentId = null) {
    const query = {
      status: { $in: ['packed', 'shipped', 'out_for_delivery'] },
      'delivery.status': { $in: ['pending', 'assigned', 'picked', 'enroute'] }
    };
    
    if (agentId) {
      query['delivery.agent'] = agentId;
    }
    
    return this.find(query).populate('delivery.agent user');
  },

  // Search orders
  searchOrders: function(searchTerm, options = {}) {
    const query = {
      $text: { $search: searchTerm }
    };
    
    if (options.status) {
      query.status = options.status;
    }
    
    if (options.userId) {
      query.user = options.userId;
    }
    
    return this.find(query)
      .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
      .limit(options.limit || 20);
  }
};

module.exports = mongoose.model('Order', orderSchema);