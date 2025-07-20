const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Item must have a product']
  },
  quantity: {
    type: Number,
    required: [true, 'Item must have a quantity'],
    min: [1, 'Quantity must be at least 1'],
    max: [100, 'Quantity cannot exceed 100 items'],
    validate: {
      validator: Number.isInteger,
      message: 'Quantity must be an integer'
    }
  },
  // Price when item was added to cart (for price change tracking)
  priceAtAddition: {
    type: Number,
    required: true,
    min: [0, 'Price cannot be negative']
  },
  // Variant information (size, color, etc.)
  variant: {
    size: {
      type: String,
      trim: true
    },
    color: {
      type: String,
      trim: true
    },
    style: {
      type: String,
      trim: true
    }
  },
  // Track when item was added
  addedAt: {
    type: Date,
    default: Date.now
  },
  // For promotional offers
  discountApplied: {
    type: Number,
    default: 0,
    min: 0
  },
  // Save for later functionality
  savedForLater: {
    type: Boolean,
    default: false
  }
}, {
  _id: true,
  timestamps: false
});

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Cart must belong to a user'],
    unique: true,
    index: true
  },
  
  items: [cartItemSchema],
  
  // Saved for later items
  savedItems: [cartItemSchema],
  
  // Applied coupons/discounts
  appliedCoupons: [{
    code: {
      type: String,
      uppercase: true,
      trim: true
    },
    discountAmount: {
      type: Number,
      min: 0
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    }
  }],
  
  // Shipping information
  shippingAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User.addresses'
  },
  
  // Cart status
  status: {
    type: String,
    enum: ['active', 'abandoned', 'converted', 'expired'],
    default: 'active',
    index: true
  },
  
  // Session tracking for guest users
  sessionId: {
    type: String,
    sparse: true,
    index: true
  },
  
  // Cart expiration
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    index: { expires: 0 }
  },
  
  // Last activity
  lastModified: {
    type: Date,
    default: Date.now
  },
  
  // Cart metadata
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
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for optimization
cartSchema.index({ user: 1, status: 1 });
cartSchema.index({ sessionId: 1 }, { sparse: true });
cartSchema.index({ lastModified: -1 });
cartSchema.index({ status: 1, lastModified: -1 });

// Compound index for abandoned cart queries
cartSchema.index({ 
  status: 1, 
  lastModified: -1, 
  'metadata.abandonedRemindersSent': 1 
});

// Pre-save middleware
cartSchema.pre('save', async function(next) {
  try {
    const Product = mongoose.model('Product');
    
    // Update last modified timestamp
    this.lastModified = new Date();
    
    // Reset expiration for active carts
    if (this.status === 'active') {
      this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    
    // Validate and update prices for new items
    const newItems = this.items.filter(item => 
      !item.priceAtAddition || item.priceAtAddition === 0
    );
    
    if (newItems.length > 0) {
      const productIds = newItems.map(item => item.product);
      const products = await Product.find({ 
        _id: { $in: productIds },
        isActive: true,
        stock: { $gt: 0 }
      }).select('price stock');
      
      const productMap = new Map();
      products.forEach(product => {
        productMap.set(product._id.toString(), product);
      });
      
      // Update prices and validate stock
      for (let item of this.items) {
        const productId = item.product.toString();
        const product = productMap.get(productId);
        
        if (!item.priceAtAddition && product) {
          item.priceAtAddition = product.price;
        }
        
        // Validate stock availability
        if (product && item.quantity > product.stock) {
          throw new Error(`Insufficient stock for product ${productId}. Available: ${product.stock}, Requested: ${item.quantity}`);
        }
      }
    }
    
    // Remove duplicate items (same product + variant)
    this.removeDuplicateItems();
    
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-find middleware to exclude expired carts
cartSchema.pre(/^find/, function(next) {
  // Only show active carts by default
  if (!this.getQuery().status) {
    this.find({ status: { $in: ['active', 'abandoned'] } });
  }
  next();
});

// Virtual properties
cartSchema.virtual('itemCount').get(function() {
  return this.items.reduce((sum, item) => sum + (item.savedForLater ? 0 : item.quantity), 0);
});

cartSchema.virtual('totalItems').get(function() {
  return this.items.length;
});

cartSchema.virtual('savedItemCount').get(function() {
  return this.savedItems.length;
});

cartSchema.virtual('subtotal').get(function() {
  return this.items
    .filter(item => !item.savedForLater)
    .reduce((sum, item) => {
      const itemTotal = item.quantity * item.priceAtAddition;
      const discount = item.discountApplied || 0;
      return sum + (itemTotal - discount);
    }, 0);
});

cartSchema.virtual('totalDiscount').get(function() {
  const itemDiscounts = this.items.reduce((sum, item) => sum + (item.discountApplied || 0), 0);
  const couponDiscounts = this.appliedCoupons.reduce((sum, coupon) => sum + coupon.discountAmount, 0);
  return itemDiscounts + couponDiscounts;
});

cartSchema.virtual('totalPrice').get(function() {
  return Math.max(0, this.subtotal - this.totalDiscount);
});

cartSchema.virtual('isEmpty').get(function() {
  return this.items.filter(item => !item.savedForLater).length === 0;
});

cartSchema.virtual('isAbandoned').get(function() {
  const daysSinceModified = (Date.now() - this.lastModified) / (1000 * 60 * 60 * 24);
  return daysSinceModified > 1 && this.status === 'active' && !this.isEmpty;
});

// Instance Methods
cartSchema.methods = {
  // Add item to cart
  addItem: async function(productData) {
    const { productId, quantity = 1, variant = {}, priceOverride } = productData;
    
    // Check if item already exists with same variant
    const existingItemIndex = this.items.findIndex(item => 
      item.product.toString() === productId.toString() &&
      JSON.stringify(item.variant) === JSON.stringify(variant)
    );
    
    if (existingItemIndex > -1) {
      // Update quantity of existing item
      this.items[existingItemIndex].quantity += quantity;
      this.items[existingItemIndex].addedAt = new Date();
    } else {
      // Get current product price
      const Product = mongoose.model('Product');
      const product = await Product.findById(productId).select('price stock isActive');
      
      if (!product || !product.isActive) {
        throw new Error('Product not found or inactive');
      }
      
      if (product.stock < quantity) {
        throw new Error(`Insufficient stock. Available: ${product.stock}`);
      }
      
      // Add new item
      this.items.push({
        product: productId,
        quantity,
        variant,
        priceAtAddition: priceOverride || product.price,
        addedAt: new Date()
      });
    }
    
    this.status = 'active';
    return this.save();
  },

  // Remove item from cart
  removeItem: function(itemId) {
    this.items = this.items.filter(item => item._id.toString() !== itemId.toString());
    return this.save();
  },

  // Update item quantity
  updateItemQuantity: async function(itemId, quantity) {
    const item = this.items.id(itemId);
    if (!item) throw new Error('Item not found in cart');
    
    if (quantity <= 0) {
      return this.removeItem(itemId);
    }
    
    // Validate stock
    const Product = mongoose.model('Product');
    const product = await Product.findById(item.product).select('stock');
    
    if (product && quantity > product.stock) {
      throw new Error(`Insufficient stock. Available: ${product.stock}`);
    }
    
    item.quantity = quantity;
    return this.save();
  },

  // Move item to saved for later
  saveForLater: function(itemId) {
    const item = this.items.id(itemId);
    if (!item) throw new Error('Item not found in cart');
    
    // Move to saved items
    this.savedItems.push(item.toObject());
    this.removeItem(itemId);
    return this.save();
  },

  // Move item back to cart from saved
  moveToCart: function(savedItemId) {
    const savedItem = this.savedItems.id(savedItemId);
    if (!savedItem) throw new Error('Saved item not found');
    
    // Move back to cart items
    this.items.push(savedItem.toObject());
    this.savedItems = this.savedItems.filter(item => 
      item._id.toString() !== savedItemId.toString()
    );
    return this.save();
  },

  // Apply coupon
  applyCoupon: function(couponCode, discountAmount, discountType = 'percentage') {
    // Check if coupon already applied
    const existingCoupon = this.appliedCoupons.find(c => c.code === couponCode.toUpperCase());
    if (existingCoupon) {
      throw new Error('Coupon already applied');
    }
    
    this.appliedCoupons.push({
      code: couponCode.toUpperCase(),
      discountAmount,
      discountType
    });
    
    return this.save();
  },

  // Remove coupon
  removeCoupon: function(couponCode) {
    this.appliedCoupons = this.appliedCoupons.filter(c => 
      c.code !== couponCode.toUpperCase()
    );
    return this.save();
  },

  // Clear cart
  clear: function() {
    this.items = [];
    this.appliedCoupons = [];
    this.status = 'active';
    return this.save();
  },

  // Mark as abandoned
  markAbandoned: function() {
    this.status = 'abandoned';
    return this.save();
  },

  // Convert to order (mark as converted)
  markConverted: function() {
    this.status = 'converted';
    return this.save();
  },

  // Remove duplicate items
  removeDuplicateItems: function() {
    const uniqueItems = new Map();
    
    this.items.forEach(item => {
      const key = `${item.product}-${JSON.stringify(item.variant)}`;
      if (uniqueItems.has(key)) {
        // Merge quantities
        uniqueItems.get(key).quantity += item.quantity;
      } else {
        uniqueItems.set(key, item);
      }
    });
    
    this.items = Array.from(uniqueItems.values());
  },

  // Validate cart items against current product data
  validateItems: async function() {
    const Product = mongoose.model('Product');
    const productIds = this.items.map(item => item.product);
    const products = await Product.find({ 
      _id: { $in: productIds } 
    }).select('price stock isActive');
    
    const productMap = new Map();
    products.forEach(p => productMap.set(p._id.toString(), p));
    
    const validationResults = {
      valid: true,
      issues: []
    };
    
    for (let item of this.items) {
      const product = productMap.get(item.product.toString());
      
      if (!product || !product.isActive) {
        validationResults.valid = false;
        validationResults.issues.push({
          type: 'unavailable',
          itemId: item._id,
          message: 'Product is no longer available'
        });
        continue;
      }
      
      if (item.quantity > product.stock) {
        validationResults.valid = false;
        validationResults.issues.push({
          type: 'insufficient_stock',
          itemId: item._id,
          available: product.stock,
          requested: item.quantity
        });
      }
      
      if (item.priceAtAddition !== product.price) {
        validationResults.issues.push({
          type: 'price_change',
          itemId: item._id,
          oldPrice: item.priceAtAddition,
          newPrice: product.price
        });
      }
    }
    
    return validationResults;
  }
};

// Static Methods
cartSchema.statics = {
  // Find or create cart for user
  findOrCreate: async function(userId, sessionId = null) {
    let cart = await this.findOne({ user: userId });
    
    if (!cart) {
      cart = new this({
        user: userId,
        sessionId,
        items: []
      });
      await cart.save();
    }
    
    return cart;
  },

  // Get abandoned carts for email campaigns
  getAbandonedCarts: function(daysSince = 1) {
    const cutoffDate = new Date(Date.now() - daysSince * 24 * 60 * 60 * 1000);
    
    return this.find({
      status: 'active',
      lastModified: { $lt: cutoffDate },
      'items.0': { $exists: true }, // Has items
      'metadata.abandonedRemindersSent': { $lt: 3 }
    }).populate('user', 'name email');
  },

  // Get cart statistics
  getCartStats: async function() {
    return await this.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgItemCount: { $avg: { $size: '$items' } }
        }
      }
    ]);
  },

  // Clean expired carts
  cleanExpiredCarts: function() {
    return this.deleteMany({
      expiresAt: { $lt: new Date() }
    });
  }
};

module.exports = mongoose.model('Cart', cartSchema);
