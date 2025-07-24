const mongoose = require('mongoose');

// Wishlist item schema for detailed tracking
const wishlistItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productSnapshot: {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, required: true },
    availability: {
      type: String,
      enum: ['in_stock', 'out_of_stock', 'discontinued'],
      default: 'in_stock'
    }
  },
  preferredVariant: {
    size: { type: String, trim: true },
    color: { type: String, trim: true },
    style: { type: String, trim: true }
  },
  priceHistory: [{
    price: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  priceAlert: {
    enabled: { type: Boolean, default: false },
    targetPrice: { type: Number, min: 0 },
    notified: { type: Boolean, default: false }
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 200
  },
  addedAt: { type: Date, default: Date.now },
  lastViewed: { type: Date, default: Date.now },
  viewCount: { type: Number, default: 1, min: 0 }
}, { _id: true, timestamps: false });

const wishlistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required']
  },
  items: {
    type: [wishlistItemSchema],
    validate: {
      validator: function (items) {
        return items.length <= 100;
      },
      message: 'Wishlist cannot exceed 100 products'
    }
  },
  collections: [{
    name: { type: String, required: true, trim: true, maxlength: 50 },
    description: { type: String, trim: true, maxlength: 200 },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    isPublic: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  privacy: {
    isPublic: { type: Boolean, default: false },
    shareToken: { type: String, unique: true, sparse: true },
    allowSharing: { type: Boolean, default: true }
  },
  preferences: {
    emailNotifications: {
      priceDrops: { type: Boolean, default: true },
      backInStock: { type: Boolean, default: true },
      recommendations: { type: Boolean, default: false }
    },
    autoRemove: {
      outOfStock: { type: Boolean, default: false },
      afterDays: { type: Number, default: 30, min: 1, max: 365 }
    }
  },
  analytics: {
    totalViews: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0, min: 0, max: 100 },
    averagePrice: { type: Number, default: 0, min: 0 }
  },
  lastActivity: { type: Date, default: Date.now },
  shareHistory: [{
    sharedWith: { type: String, required: true },
    sharedAt: { type: Date, default: Date.now },
    shareType: {
      type: String,
      enum: ['email', 'sms', 'link', 'social'],
      required: true
    }
  }]
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret) => { delete ret.__v; return ret; }
  },
  toObject: { virtuals: true }
});

// Indexes
wishlistSchema.index({ user: 1 }, { unique: true });
wishlistSchema.index({ 'items.product': 1 });
wishlistSchema.index({ 'items.addedAt': -1 });
wishlistSchema.index({ 'items.priority': 1 });
wishlistSchema.index({ 'privacy.shareToken': 1 }, { sparse: true });
wishlistSchema.index({ lastActivity: -1 });
wishlistSchema.index({
  user: 1,
  'items.priority': -1,
  'items.addedAt': -1
});

// Pre-save middleware
wishlistSchema.pre('save', async function (next) {
  try {
    this.lastActivity = new Date();
    this.updateAnalytics();
    if (this.privacy.isPublic && !this.privacy.shareToken) {
      this.privacy.shareToken = this.generateShareToken();
    }
    await this.updateProductSnapshots();
    this.removeDuplicateItems();
    next();
  } catch (error) {
    next(error);
  }
});

// Virtuals
wishlistSchema.virtual('itemCount').get(function () {
  return this.items.length;
});
wishlistSchema.virtual('totalValue').get(function () {
  return this.items.reduce((sum, item) => sum + item.productSnapshot.price, 0);
});
wishlistSchema.virtual('averageItemPrice').get(function () {
  return this.itemCount > 0 ? this.totalValue / this.itemCount : 0;
});
wishlistSchema.virtual('highPriorityItems').get(function () {
  return this.items.filter(i => i.priority === 'high');
});
wishlistSchema.virtual('availableItems').get(function () {
  return this.items.filter(i => i.productSnapshot.availability === 'in_stock');
});
wishlistSchema.virtual('outOfStockItems').get(function () {
  return this.items.filter(i => i.productSnapshot.availability === 'out_of_stock');
});
wishlistSchema.virtual('shareUrl').get(function () {
  return this.privacy.shareToken ? `/wishlist/shared/${this.privacy.shareToken}` : null;
});

// Instance methods
wishlistSchema.methods = {
  addProduct: async function ({ productId, variant = {}, priority = 'medium', notes = '' }) {
    const existing = this.items.find(i =>
      i.product.toString() === productId.toString() &&
      JSON.stringify(i.preferredVariant) === JSON.stringify(variant)
    );
    const Product = mongoose.model('Product');
    const product = await Product.findById(productId).select('name pricing.basePrice pricing.salePrice images inventory.stock status');
    if (!product) throw new Error('Product not found');
    const price = product.pricing.salePrice || product.pricing.basePrice;
    const availability = product.inventory.stock > 0 && product.status === 'active' ? 'in_stock' : 'out_of_stock';

    if (existing) {
      existing.lastViewed = new Date();
      existing.viewCount++;
      existing.priority = priority;
      if (notes) existing.notes = notes;
    } else {
      this.items.push({
        product: productId,
        productSnapshot: {
          name: product.name,
          price,
          image: product.images[0]?.url || '',
          availability
        },
        preferredVariant: variant,
        priority,
        notes,
        priceHistory: [{ price }]
      });
    }
    return this.save();
  },

  removeProduct: function (productId, variant = null) {
    this.items = this.items.filter(item =>
      !(item.product.toString() === productId.toString() &&
        (!variant || JSON.stringify(item.preferredVariant) === JSON.stringify(variant)))
    );
    return this.save();
  },

  moveToCart: async function (itemId, quantity = 1) {
    const item = this.items.id(itemId);
    if (!item) throw new Error('Item not found in wishlist');
    const Cart = mongoose.model('Cart');
    const cart = await Cart.findOrCreate(this.user);
    await cart.addItem({ productId: item.product, quantity, variant: item.preferredVariant });
    this.items = this.items.filter(i => i._id.toString() !== itemId.toString());
    return this.save();
  },

  updateItemPriority: function (itemId, priority) {
    const item = this.items.id(itemId);
    if (!item) throw new Error('Item not found');
    item.priority = priority;
    return this.save();
  },

  setPriceAlert: function (itemId, targetPrice) {
    const item = this.items.id(itemId);
    if (!item) throw new Error('Item not found');
    item.priceAlert = { enabled: true, targetPrice, notified: false };
    return this.save();
  },

  createCollection: function (name, description = '', productIds = [], isPublic = false) {
    if (this.collections.find(c => c.name === name)) {
      throw new Error('Collection already exists');
    }
    this.collections.push({ name, description, productIds, isPublic });
    return this.save();
  },

  addToCollection: function (collectionName, productIds) {
    const collection = this.collections.find(c => c.name === collectionName);
    if (!collection) throw new Error('Collection not found');
    productIds.forEach(id => {
      if (!collection.productIds.includes(id)) {
        collection.productIds.push(id);
      }
    });
    return this.save();
  },

  shareWishlist: async function (shareWith, shareType = 'email') {
    if (!this.privacy.allowSharing) throw new Error('Sharing disabled');
    if (!this.privacy.shareToken) {
      this.privacy.shareToken = this.generateShareToken();
    }
    this.shareHistory.push({ sharedWith: shareWith, shareType, sharedAt: new Date() });
    this.analytics.totalShares++;
    return this.save();
  },

  updateProductSnapshots: async function () {
    const Product = mongoose.model('Product');
    const products = await Product.find({
      _id: { $in: this.items.map(i => i.product) }
    }).select('name pricing.basePrice pricing.salePrice images inventory.stock status');

    const map = new Map();
    products.forEach(p => map.set(p._id.toString(), p));

    this.items.forEach(item => {
      const product = map.get(item.product.toString());
      if (!product) return;
      const price = product.pricing.salePrice || product.pricing.basePrice;
      const availability = product.inventory.stock > 0 && product.status === 'active' ? 'in_stock' : 'out_of_stock';
      item.productSnapshot.name = product.name;
      item.productSnapshot.image = product.images[0]?.url || '';
      item.productSnapshot.availability = availability;
      if (item.productSnapshot.price !== price) {
        item.priceHistory.push({ price });
        item.productSnapshot.price = price;
        if (item.priceAlert.enabled && price <= item.priceAlert.targetPrice && !item.priceAlert.notified) {
          item.priceAlert.notified = true;
        }
      }
    });
  },

  removeDuplicateItems: function () {
    const map = new Map();
    this.items.forEach(item => {
      const key = `${item.product}-${JSON.stringify(item.preferredVariant)}`;
      if (!map.has(key) || map.get(key).addedAt > item.addedAt) {
        map.set(key, item);
      }
    });
    this.items = Array.from(map.values());
  },

  generateShareToken: function () {
    return require('crypto').randomBytes(16).toString('hex');
  },

  updateAnalytics: function () {
    if (this.items.length) {
      this.analytics.averagePrice = this.averageItemPrice;
    }
  }
};

// Static methods
wishlistSchema.statics = {
  findOrCreate: async function (userId) {
    let wishlist = await this.findOne({ user: userId });
    if (!wishlist) {
      wishlist = new this({ user: userId, items: [] });
      await wishlist.save();
    }
    return wishlist;
  },

  findPublicWishlists: function (limit = 20) {
    return this.find({ 'privacy.isPublic': true })
      .populate('user', 'name')
      .sort({ 'analytics.totalViews': -1 })
      .limit(limit);
  },

  findByShareToken: function (token) {
    return this.findOne({ 'privacy.shareToken': token }).populate('user', 'name');
  },

  getAnalytics: async function (userId = null) {
    const match = userId ? { user: mongoose.Types.ObjectId(userId) } : {};
    return await this.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: null,
          totalWishlists: { $addToSet: '$_id' },
          totalItems: { $sum: 1 },
          avgItemsPerWishlist: { $avg: '$itemCount' },
          totalValue: { $sum: '$items.productSnapshot.price' },
          popularPriority: { $addToSet: '$items.priority' }
        }
      },
      {
        $project: {
          totalWishlists: { $size: '$totalWishlists' },
          totalItems: 1,
          avgItemsPerWishlist: 1,
          totalValue: 1,
          popularPriority: 1
        }
      }
    ]);
  },

  cleanInactiveWishlists: function (daysSince = 180) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);
    return this.deleteMany({ lastActivity: { $lt: cutoff }, 'items.0': { $exists: false } });
  }
};

module.exports = mongoose.model('Wishlist', wishlistSchema);
