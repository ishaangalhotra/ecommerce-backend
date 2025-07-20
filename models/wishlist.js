const mongoose = require('mongoose');

// Wishlist item schema for detailed tracking
const wishlistItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  // Snapshot data to preserve information if product changes
  productSnapshot: {
    name: {
      type: String,
      required: true,
      trim: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    image: {
      type: String,
      required: true
    },
    availability: {
      type: String,
      enum: ['in_stock', 'out_of_stock', 'discontinued'],
      default: 'in_stock'
    }
  },
  // Variant preferences (size, color, etc.)
  preferredVariant: {
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
  // Price tracking
  priceHistory: [{
    price: {
      type: Number,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  // Notifications
  priceAlert: {
    enabled: {
      type: Boolean,
      default: false
    },
    targetPrice: {
      type: Number,
      min: 0
    },
    notified: {
      type: Boolean,
      default: false
    }
  },
  // Metadata
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [200, 'Notes cannot exceed 200 characters']
  },
  // Tracking
  addedAt: {
    type: Date,
    default: Date.now
  },
  lastViewed: {
    type: Date,
    default: Date.now
  },
  viewCount: {
    type: Number,
    default: 1,
    min: 0
  }
}, {
  _id: true,
  timestamps: false
});

const wishlistSchema = new mongoose.Schema({
  // User reference
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required'],
    unique: true,
    index: true
  },
  
  // Enhanced items array
  items: {
    type: [wishlistItemSchema],
    validate: {
      validator: function(items) {
        return items.length <= 100; // Increased limit
      },
      message: 'Wishlist cannot exceed 100 products'
    }
  },
  
  // Wishlist categories/collections
  collections: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [50, 'Collection name cannot exceed 50 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, 'Description cannot exceed 200 characters']
    },
    productIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    }],
    isPublic: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Privacy settings
  privacy: {
    isPublic: {
      type: Boolean,
      default: false
    },
    shareToken: {
      type: String,
      unique: true,
      sparse: true
    },
    allowSharing: {
      type: Boolean,
      default: true
    }
  },
  
  // Preferences
  preferences: {
    emailNotifications: {
      priceDrops: {
        type: Boolean,
        default: true
      },
      backInStock: {
        type: Boolean,
        default: true
      },
      recommendations: {
        type: Boolean,
        default: false
      }
    },
    autoRemove: {
      outOfStock: {
        type: Boolean,
        default: false
      },
      afterDays: {
        type: Number,
        default: 30,
        min: 1,
        max: 365
      }
    }
  },
  
  // Analytics
  analytics: {
    totalViews: {
      type: Number,
      default: 0
    },
    totalShares: {
      type: Number,
      default: 0
    },
    conversionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    averagePrice: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // Metadata
  lastActivity: {
    type: Date,
    default: Date.now
  },
  
  // Share history
  shareHistory: [{
    sharedWith: {
      type: String, // email or phone
      required: true
    },
    sharedAt: {
      type: Date,
      default: Date.now
    },
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
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for optimization
wishlistSchema.index({ user: 1 });
wishlistSchema.index({ 'items.product': 1 });
wishlistSchema.index({ 'items.addedAt': -1 });
wishlistSchema.index({ 'items.priority': 1 });
wishlistSchema.index({ 'privacy.shareToken': 1 }, { sparse: true });
wishlistSchema.index({ lastActivity: -1 });

// Compound index for user queries
wishlistSchema.index({ 
  user: 1, 
  'items.priority': -1, 
  'items.addedAt': -1 
});

// Pre-save middleware
wishlistSchema.pre('save', async function(next) {
  try {
    // Update last activity timestamp
    this.lastActivity = new Date();
    
    // Update analytics
    this.updateAnalytics();
    
    // Generate share token if privacy is public and token doesn't exist
    if (this.privacy.isPublic && !this.privacy.shareToken) {
      this.privacy.shareToken = this.generateShareToken();
    }
    
    // Update product snapshots for new items
    await this.updateProductSnapshots();
    
    // Remove duplicates
    this.removeDuplicateItems();
    
    next();
  } catch (error) {
    next(error);
  }
});

// Virtual properties
wishlistSchema.virtual('itemCount').get(function() {
  return this.items.length;
});

wishlistSchema.virtual('totalValue').get(function() {
  return this.items.reduce((sum, item) => sum + item.productSnapshot.price, 0);
});

wishlistSchema.virtual('averageItemPrice').get(function() {
  return this.itemCount > 0 ? this.totalValue / this.itemCount : 0;
});

wishlistSchema.virtual('highPriorityItems').get(function() {
  return this.items.filter(item => item.priority === 'high');
});

wishlistSchema.virtual('availableItems').get(function() {
  return this.items.filter(item => item.productSnapshot.availability === 'in_stock');
});

wishlistSchema.virtual('outOfStockItems').get(function() {
  return this.items.filter(item => item.productSnapshot.availability === 'out_of_stock');
});

wishlistSchema.virtual('shareUrl').get(function() {
  return this.privacy.shareToken ? `/wishlist/shared/${this.privacy.shareToken}` : null;
});

// Instance Methods
wishlistSchema.methods = {
  // Add product to wishlist
  addProduct: async function(productData) {
    const { productId, variant = {}, priority = 'medium', notes = '' } = productData;
    
    // Check if product already exists
    const existingItem = this.items.find(item => 
      item.product.toString() === productId.toString() &&
      JSON.stringify(item.preferredVariant) === JSON.stringify(variant)
    );
    
    if (existingItem) {
      // Update existing item
      existingItem.lastViewed = new Date();
      existingItem.viewCount++;
      existingItem.priority = priority;
      if (notes) existingItem.notes = notes;
    } else {
      // Add new item
      const Product = mongoose.model('Product');
      const product = await Product.findById(productId)
        .select('name pricing.basePrice pricing.salePrice images inventory.stock status');
      
      if (!product) {
        throw new Error('Product not found');
      }
      
      const currentPrice = product.pricing.salePrice || product.pricing.basePrice;
      const availability = product.inventory.stock > 0 && product.status === 'active' 
        ? 'in_stock' : 'out_of_stock';
      
      this.items.push({
        product: productId,
        productSnapshot: {
          name: product.name,
          price: currentPrice,
          image: product.images[0]?.url || '',
          availability
        },
        preferredVariant: variant,
        priority,
        notes,
        priceHistory: [{ price: currentPrice }]
      });
    }
    
    return this.save();
  },

  // Remove product from wishlist
  removeProduct: function(productId, variant = null) {
    if (variant) {
      // Remove specific variant
      this.items = this.items.filter(item => 
        !(item.product.toString() === productId.toString() &&
          JSON.stringify(item.preferredVariant) === JSON.stringify(variant))
      );
    } else {
      // Remove all instances of the product
      this.items = this.items.filter(item => 
        item.product.toString() !== productId.toString()
      );
    }
    
    return this.save();
  },

  // Move item to cart
  moveToCart: async function(itemId, quantity = 1) {
    const item = this.items.id(itemId);
    if (!item) throw new Error('Item not found in wishlist');
    
    const Cart = mongoose.model('Cart');
    const cart = await Cart.findOrCreate(this.user);
    
    await cart.addItem({
      productId: item.product,
      quantity,
      variant: item.preferredVariant
    });
    
    // Remove from wishlist
    this.items = this.items.filter(i => i._id.toString() !== itemId.toString());
    return this.save();
  },

  // Update item priority
  updateItemPriority: function(itemId, priority) {
    const item = this.items.id(itemId);
    if (!item) throw new Error('Item not found in wishlist');
    
    item.priority = priority;
    return this.save();
  },

  // Set price alert
  setPriceAlert: function(itemId, targetPrice) {
    const item = this.items.id(itemId);
    if (!item) throw new Error('Item not found in wishlist');
    
    item.priceAlert = {
      enabled: true,
      targetPrice,
      notified: false
    };
    
    return this.save();
  },

  // Create collection
  createCollection: function(name, description = '', productIds = [], isPublic = false) {
    // Check if collection exists
    const existingCollection = this.collections.find(c => c.name === name);
    if (existingCollection) {
      throw new Error('Collection with this name already exists');
    }
    
    this.collections.push({
      name,
      description,
      productIds,
      isPublic
    });
    
    return this.save();
  },

  // Add products to collection
  addToCollection: function(collectionName, productIds) {
    const collection = this.collections.find(c => c.name === collectionName);
    if (!collection) throw new Error('Collection not found');
    
    productIds.forEach(productId => {
      if (!collection.productIds.includes(productId)) {
        collection.productIds.push(productId);
      }
    });
    
    return this.save();
  },

  // Share wishlist
  shareWishlist: async function(shareWith, shareType = 'email') {
    if (!this.privacy.allowSharing) {
      throw new Error('Sharing is disabled for this wishlist');
    }
    
    // Generate share token if not exists
    if (!this.privacy.shareToken) {
      this.privacy.shareToken = this.generateShareToken();
    }
    
    this.shareHistory.push({
      sharedWith: shareWith,
      shareType,
      sharedAt: new Date()
    });
    
    this.analytics.totalShares++;
    
    return this.save();
  },

  // Update product snapshots
  updateProductSnapshots: async function() {
    const Product = mongoose.model('Product');
    const productIds = this.items.map(item => item.product);
    
    if (productIds.length === 0) return;
    
    const products = await Product.find({ _id: { $in: productIds } })
      .select('name pricing.basePrice pricing.salePrice images inventory.stock status');
    
    const productMap = new Map();
    products.forEach(product => {
      productMap.set(product._id.toString(), product);
    });
    
    this.items.forEach(item => {
      const product = productMap.get(item.product.toString());
      if (product) {
        const currentPrice = product.pricing.salePrice || product.pricing.basePrice;
        const availability = product.inventory.stock > 0 && product.status === 'active' 
          ? 'in_stock' : 'out_of_stock';
        
        // Update snapshot
        item.productSnapshot.name = product.name;
        item.productSnapshot.image = product.images[0]?.url || item.productSnapshot.image;
        item.productSnapshot.availability = availability;
        
        // Track price changes
        if (item.productSnapshot.price !== currentPrice) {
          item.priceHistory.push({ price: currentPrice });
          item.productSnapshot.price = currentPrice;
          
          // Check price alert
          if (item.priceAlert.enabled && 
              currentPrice <= item.priceAlert.targetPrice && 
              !item.priceAlert.notified) {
            item.priceAlert.notified = true;
            // Trigger price alert notification (implement separately)
          }
        }
      }
    });
  },

  // Remove duplicate items
  removeDuplicateItems: function() {
    const uniqueItems = new Map();
    
    this.items.forEach(item => {
      const key = `${item.product}-${JSON.stringify(item.preferredVariant)}`;
      if (!uniqueItems.has(key) || 
          uniqueItems.get(key).addedAt > item.addedAt) {
        uniqueItems.set(key, item);
      }
    });
    
    this.items = Array.from(uniqueItems.values());
  },

  // Generate share token
  generateShareToken: function() {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('hex');
  },

  // Update analytics
  updateAnalytics: function() {
    if (this.items.length > 0) {
      this.analytics.averagePrice = this.averageItemPrice;
    }
    
    // Calculate conversion rate (items moved to cart / total items added)
    // This would need to be calculated based on order history
  },

  // Clean old items
  cleanOldItems: function() {
    if (!this.preferences.autoRemove.outOfStock) return;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.preferences.autoRemove.afterDays);
    
    this.items = this.items.filter(item => 
      !(item.productSnapshot.availability === 'out_of_stock' && 
        item.addedAt < cutoffDate)
    );
    
    return this.save();
  },

  // Get recommendations based on wishlist
  getRecommendations: async function(limit = 10) {
    if (this.items.length === 0) return [];
    
    const Product = mongoose.model('Product');
    const categories = [...new Set(this.items.map(item => item.productSnapshot.category))];
    
    return await Product.find({
      'category.main': { $in: categories },
      _id: { $nin: this.items.map(item => item.product) },
      isPublished: true,
      status: 'active'
    })
    .sort({ 'rating.average': -1 })
    .limit(limit)
    .select('name slug pricing images rating');
  }
};

// Static Methods
wishlistSchema.statics = {
  // Find or create wishlist for user
  findOrCreate: async function(userId) {
    let wishlist = await this.findOne({ user: userId });
    
    if (!wishlist) {
      wishlist = new this({
        user: userId,
        items: []
      });
      await wishlist.save();
    }
    
    return wishlist;
  },

  // Find public wishlists
  findPublicWishlists: function(limit = 20) {
    return this.find({ 'privacy.isPublic': true })
      .populate('user', 'name')
      .sort({ 'analytics.totalViews': -1 })
      .limit(limit);
  },

  // Find wishlist by share token
  findByShareToken: function(token) {
    return this.findOne({ 'privacy.shareToken': token })
      .populate('user', 'name');
  },

  // Get wishlist analytics
  getAnalytics: async function(userId = null) {
    const matchStage = userId ? { user: mongoose.Types.ObjectId(userId) } : {};
    
    return await this.aggregate([
      { $match: matchStage },
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

  // Clean inactive wishlists
  cleanInactiveWishlists: function(daysSince = 180) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSince);
    
    return this.deleteMany({
      lastActivity: { $lt: cutoffDate },
      'items.0': { $exists: false } // Empty wishlists
    });
  }
};

module.exports = mongoose.model('Wishlist', wishlistSchema);
