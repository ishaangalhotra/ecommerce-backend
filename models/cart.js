const mongoose = require('mongoose');

// ==================== CART ITEM SUBDOCUMENT SCHEMA ====================
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
    min: 1,
    default: 1
  },
  priceAtAdd: {
    type: Number,
    required: false, // Made optional to handle frontend issues gracefully
    default: 0
  },
  discountAtAdd: {
    type: Number,
    default: 0,
    min: 0
  },
  selectedVariant: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  customizations: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  giftWrap: {
    type: Boolean,
    default: false
  },
  giftMessage: {
    type: String,
    default: '',
    maxlength: 200
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// ==================== MAIN CART SCHEMA ====================
const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Cart must belong to a user'],
    index: true
  },

  items: [cartItemSchema],

  savedItems: [cartItemSchema],

  appliedCoupons: [{
    code: { 
      type: String, 
      uppercase: true, 
      trim: true 
    },
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    },
    value: { 
      type: Number, 
      min: 0 
    },
    discountAmount: { 
      type: Number, 
      min: 0,
      default: 0
    },
    appliedAt: { 
      type: Date, 
      default: Date.now 
    }
  }],

  shippingAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User.addresses'
  },

  status: {
    type: String,
    enum: ['active', 'abandoned', 'converted', 'expired'],
    default: 'active',
    index: true
  },

  sessionId: {
    type: String,
    index: { sparse: true }
  },

  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    index: true
  },

  lastModified: {
    type: Date,
    default: Date.now,
    index: true
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
      max: 3,
      min: 0
    },
    lastReminderSent: Date,
    ipAddress: String,
    userAgent: String
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
  toObject: { 
    virtuals: true 
  }
});

// ==================== INDEXES ====================
cartSchema.index({ user: 1, status: 1 });
cartSchema.index({ sessionId: 1 }, { sparse: true });
cartSchema.index({ lastModified: -1 });
cartSchema.index({ status: 1, lastModified: -1 });
cartSchema.index({ status: 1, lastModified: -1, 'metadata.abandonedRemindersSent': 1 });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup

// ==================== VIRTUAL PROPERTIES ====================

// Total number of items (sum of quantities)
cartSchema.virtual('itemCount').get(function() {
  if (!this.items || this.items.length === 0) return 0;
  return this.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
});

// Cart subtotal (sum of item prices × quantities)
cartSchema.virtual('subtotal').get(function() {
  if (!this.items || this.items.length === 0) return 0;
  return this.items.reduce((sum, item) => {
    // Try to get price from populated product first, fallback to priceAtAdd
    const price = item.product?.price || item.priceAtAdd || 0;
    return sum + (price * (item.quantity || 0));
  }, 0);
});

// Total discount from coupons
cartSchema.virtual('discount').get(function() {
  if (!this.appliedCoupons || this.appliedCoupons.length === 0) return 0;
  return this.appliedCoupons.reduce((sum, coupon) => {
    return sum + (coupon.discountAmount || 0);
  }, 0);
});

// Estimated tax (can be customized based on location)
cartSchema.virtual('tax').get(function() {
  const subtotal = this.subtotal || 0;
  const taxRate = 0.05; // 5% tax rate (customize as needed)
  return Math.round(subtotal * taxRate * 100) / 100;
});

// Estimated delivery fee (can be customized based on location/cart value)
cartSchema.virtual('deliveryFee').get(function() {
  const subtotal = this.subtotal || 0;
  // Free delivery for orders above 500
  return subtotal >= 500 ? 0 : 50;
});

// Cart total after discounts, tax, and delivery
cartSchema.virtual('total').get(function() {
  const subtotal = this.subtotal || 0;
  const discount = this.discount || 0;
  const tax = this.tax || 0;
  const deliveryFee = this.deliveryFee || 0;
  
  return Math.max(0, Math.round((subtotal - discount + tax + deliveryFee) * 100) / 100);
});

// Check if cart is empty
cartSchema.virtual('isEmpty').get(function() {
  return !this.items || this.items.length === 0;
});

// ==================== MIDDLEWARE ====================

// Update lastModified before saving
cartSchema.pre('save', function(next) {
  this.lastModified = new Date();
  next();
});

// Update item updatedAt timestamps when items are modified
cartSchema.pre('save', function(next) {
  if (this.isModified('items')) {
    const now = new Date();
    this.items.forEach(item => {
      if (!item.updatedAt || this.isModified('items')) {
        item.updatedAt = now;
      }
    });
  }
  next();
});

// Validate product references before saving
cartSchema.pre('save', async function(next) {
  if (this.isModified('items') && this.items.length > 0) {
    try {
      const Product = mongoose.model('Product');
      const productIds = this.items.map(item => item.product);
      const products = await Product.find({ _id: { $in: productIds } }).select('_id');
      
      const validProductIds = new Set(products.map(p => p._id.toString()));
      
      // Remove items with invalid product references
      this.items = this.items.filter(item => 
        validProductIds.has(item.product.toString())
      );
    } catch (error) {
      console.warn('Product validation error in cart:', error);
    }
  }
  next();
});

// ==================== STATIC METHODS ====================

/**
 * Find or create a cart for a user
 * @param {ObjectId} userId - User ID
 * @returns {Promise<Cart>} Cart document
 */
cartSchema.statics.findOrCreate = async function(userId) {
  let cart = await this.findOne({ 
    user: userId, 
    status: 'active' 
  });
  
  if (!cart) {
    cart = await this.create({
      user: userId,
      items: [],
      appliedCoupons: [],
      status: 'active'
    });
  }
  
  return cart;
};

/**
 * Get cart with populated product details
 * @param {ObjectId} userId - User ID
 * @returns {Promise<Cart>} Populated cart document
 */
cartSchema.statics.getPopulatedCart = async function(userId) {
  return this.findOne({ 
    user: userId, 
    status: 'active' 
  })
  .populate({
    path: 'items.product',
    select: 'name price images stock status seller category discountPercentage maxQuantityPerOrder',
    populate: {
      path: 'seller',
      select: 'name rating verified shopName'
    }
  })
  .populate('shippingAddress')
  .lean();
};

/**
 * Clean up old abandoned/expired carts
 * @param {Number} daysOld - Number of days to keep (default: 30)
 * @returns {Promise<Object>} Deletion result
 */
cartSchema.statics.cleanupOldCarts = async function(daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  return this.deleteMany({
    status: { $in: ['abandoned', 'expired'] },
    lastModified: { $lt: cutoffDate }
  });
};

/**
 * Get abandoned carts for reminder emails
 * @param {Number} hoursAgo - Hours since last modification
 * @returns {Promise<Array>} Array of abandoned carts
 */
cartSchema.statics.getAbandonedCarts = async function(hoursAgo = 24) {
  const cutoffDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  
  return this.find({
    status: 'active',
    lastModified: { $lt: cutoffDate },
    'items.0': { $exists: true }, // Has at least one item
    'metadata.abandonedRemindersSent': { $lt: 3 } // Max 3 reminders
  })
  .populate('user', 'name email')
  .populate('items.product', 'name price images');
};

// ==================== INSTANCE METHODS ====================

/**
 * Add item to cart
 * @param {ObjectId} productId - Product ID
 * @param {Number} quantity - Quantity to add
 * @param {Object} options - Additional options
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.addItem = async function(productId, quantity = 1, options = {}) {
  const Product = mongoose.model('Product');
  const product = await Product.findById(productId)
    .select('price stock status maxQuantityPerOrder')
    .lean();
  
  if (!product || product.status !== 'active') {
    throw new Error('Product not available');
  }
  
  if (product.stock < quantity) {
    throw new Error(`Only ${product.stock} items in stock`);
  }
  
  const existingItemIndex = this.items.findIndex(
    item => item.product.toString() === productId
  );
  
  if (existingItemIndex > -1) {
    const existingItem = this.items[existingItemIndex];
    const newQuantity = existingItem.quantity + quantity;
    
    if (newQuantity > product.stock) {
      throw new Error(`Cannot add ${quantity} more. Only ${product.stock - existingItem.quantity} available`);
    }
    
    const maxQuantity = product.maxQuantityPerOrder || 100;
    if (newQuantity > maxQuantity) {
      throw new Error(`Maximum ${maxQuantity} items allowed per order`);
    }
    
    existingItem.quantity = newQuantity;
    existingItem.updatedAt = new Date();
  } else {
    this.items.push({
      product: productId,
      quantity,
      priceAtAdd: product.price,
      selectedVariant: options.selectedVariant || null,
      customizations: options.customizations || [],
      giftWrap: options.giftWrap || false,
      giftMessage: options.giftMessage || '',
      addedAt: new Date(),
      updatedAt: new Date()
    });
  }
  
  return this.save();
};

/**
 * Remove item from cart
 * @param {ObjectId} productId - Product ID
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.removeItem = function(productId) {
  this.items = this.items.filter(
    item => item.product.toString() !== productId
  );
  return this.save();
};

/**
 * Update item quantity
 * @param {ObjectId} productId - Product ID
 * @param {Number} quantity - New quantity
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.updateItemQuantity = async function(productId, quantity) {
  if (quantity <= 0) {
    return this.removeItem(productId);
  }
  
  const itemIndex = this.items.findIndex(
    item => item.product.toString() === productId
  );
  
  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }
  
  // Validate stock
  const Product = mongoose.model('Product');
  const product = await Product.findById(productId)
    .select('stock maxQuantityPerOrder status')
    .lean();
  
  if (!product || product.status !== 'active') {
    throw new Error('Product is no longer available');
  }
  
  if (product.stock < quantity) {
    throw new Error(`Only ${product.stock} items in stock`);
  }
  
  const maxQuantity = product.maxQuantityPerOrder || 100;
  if (quantity > maxQuantity) {
    throw new Error(`Maximum ${maxQuantity} items allowed per order`);
  }
  
  this.items[itemIndex].quantity = quantity;
  this.items[itemIndex].updatedAt = new Date();
  
  return this.save();
};

/**
 * Clear all items from cart
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.clearCart = function() {
  this.items = [];
  this.appliedCoupons = [];
  return this.save();
};

/**
 * Apply coupon to cart
 * @param {String} couponCode - Coupon code
 * @param {Number} discountAmount - Calculated discount amount
 * @param {String} couponType - Coupon type (percentage/fixed)
 * @param {Number} couponValue - Coupon value
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.applyCoupon = function(couponCode, discountAmount, couponType = 'percentage', couponValue = 0) {
  const existingCoupon = this.appliedCoupons.find(
    c => c.code.toUpperCase() === couponCode.toUpperCase()
  );
  
  if (existingCoupon) {
    throw new Error('Coupon already applied');
  }
  
  this.appliedCoupons.push({
    code: couponCode.toUpperCase(),
    type: couponType,
    value: couponValue,
    discountAmount,
    appliedAt: new Date()
  });
  
  return this.save();
};

/**
 * Remove coupon from cart
 * @param {String} couponCode - Coupon code
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.removeCoupon = function(couponCode) {
  this.appliedCoupons = this.appliedCoupons.filter(
    c => c.code.toUpperCase() !== couponCode.toUpperCase()
  );
  return this.save();
};

/**
 * Move item to saved items
 * @param {ObjectId} productId - Product ID
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.saveForLater = function(productId) {
  const itemIndex = this.items.findIndex(
    item => item.product.toString() === productId
  );
  
  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }
  
  const item = this.items.splice(itemIndex, 1)[0];
  this.savedItems.push(item);
  
  return this.save();
};

/**
 * Move item back to cart from saved items
 * @param {ObjectId} productId - Product ID
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.moveToCart = function(productId) {
  const itemIndex = this.savedItems.findIndex(
    item => item.product.toString() === productId
  );
  
  if (itemIndex === -1) {
    throw new Error('Item not found in saved items');
  }
  
  const item = this.savedItems.splice(itemIndex, 1)[0];
  this.items.push(item);
  
  return this.save();
};

/**
 * Mark cart as abandoned
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.markAsAbandoned = function() {
  this.status = 'abandoned';
  return this.save();
};

/**
 * Mark cart as converted (order placed)
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.markAsConverted = function() {
  this.status = 'converted';
  return this.save();
};

/**
 * Increment abandoned reminder count
 * @returns {Promise<Cart>} Updated cart
 */
cartSchema.methods.incrementReminderCount = function() {
  this.metadata.abandonedRemindersSent = (this.metadata.abandonedRemindersSent || 0) + 1;
  this.metadata.lastReminderSent = new Date();
  return this.save();
};

// ==================== EXPORT ====================
module.exports = mongoose.models.Cart || mongoose.model('Cart', cartSchema);