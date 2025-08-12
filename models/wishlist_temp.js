// models/Wishlist.js
const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
    // Removed unique: true here — uniqueness now handled by .index() below
  },
  items: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  allowSharing: {
    type: Boolean,
    default: false
  },
  shareId: {
    type: String
    // Removed sparse: true here — sparsity now handled by .index() below
  }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes for performance and constraints
wishlistSchema.index({ userId: 1 }, { unique: true });
wishlistSchema.index({ shareId: 1 }, { sparse: true });
wishlistSchema.index({ 'items.productId': 1 });

// Virtual for item count
wishlistSchema.virtual('itemCount').get(function() {
  return this.items.length;
});

// Check if product exists in wishlist
wishlistSchema.methods.hasProduct = function(productId) {
  return this.items.some(item => 
    item.productId.toString() === productId.toString()
  );
};

// Add product to wishlist
wishlistSchema.methods.addProduct = function(productId) {
  if (!this.hasProduct(productId)) {
    this.items.push({
      productId: productId,
      addedAt: new Date()
    });
  }
  return this;
};

// Remove product from wishlist
wishlistSchema.methods.removeProduct = function(productId) {
  this.items = this.items.filter(item => 
    item.productId.toString() !== productId.toString()
  );
  return this;
};

// Pre-save: generate shareId if sharing enabled
wishlistSchema.pre('save', function(next) {
  if (this.allowSharing && !this.shareId) {
    const crypto = require('crypto');
    this.shareId = crypto.randomBytes(16).toString('hex');
  }
  next();
});

// Find user's wishlist with populated products
wishlistSchema.statics.findUserWishlist = function(userId, populateProducts = true) {
  const query = this.findOne({ userId });
  
  if (populateProducts) {
    return query.populate({
      path: 'items.productId',
      select: 'name price images category seller stock isActive',
      populate: {
        path: 'seller',
        select: 'storeName rating'
      }
    });
  }
  
  return query;
};

// Post-save cleanup (optional)
wishlistSchema.post('save', async function(doc) {
  if (doc.items.length === 0 && !doc.allowSharing) {
    // Optionally remove empty wishlists
    // await doc.deleteOne();
  }
});

module.exports = mongoose.model('Wishlist', wishlistSchema);
