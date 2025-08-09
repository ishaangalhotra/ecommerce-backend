const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  comment: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    publicId: {
      type: String,
      required: true
    }
  }],
  verified: {
    type: Boolean,
    default: false
  },
  helpful: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  unhelpful: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  reported: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: {
      type: String,
      enum: ['spam', 'inappropriate', 'fake', 'offensive', 'other'],
      required: true
    },
    comment: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  sellerResponse: {
    message: String,
    createdAt: Date,
    updatedAt: Date
  },
  status: {
    type: String,
    enum: ['active', 'hidden', 'removed'],
    default: 'active'
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceInfo: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
reviewSchema.index({ product: 1, createdAt: -1 });
reviewSchema.index({ user: 1, createdAt: -1 });
reviewSchema.index({ seller: 1, createdAt: -1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ verified: 1 });
reviewSchema.index({ status: 1 });

// Compound index for product reviews with rating
reviewSchema.index({ product: 1, rating: -1, createdAt: -1 });

// Ensure one review per user per product
reviewSchema.index({ user: 1, product: 1 }, { unique: true });

// Virtual for helpfulness score
reviewSchema.virtual('helpfulnessScore').get(function() {
  return this.helpful.length - this.unhelpful.length;
});

// Virtual for total helpfulness votes
reviewSchema.virtual('totalHelpfulnessVotes').get(function() {
  return this.helpful.length + this.unhelpful.length;
});

// Static method to get average rating for a product
reviewSchema.statics.getProductAverageRating = async function(productId) {
  const result = await this.aggregate([
    { $match: { product: mongoose.Types.ObjectId(productId), status: 'active' } },
    { $group: {
      _id: null,
      averageRating: { $avg: '$rating' },
      totalReviews: { $sum: 1 },
      ratingDistribution: {
        $push: '$rating'
      }
    }}
  ]);

  if (result.length === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  }

  const data = result[0];
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  
  data.ratingDistribution.forEach(rating => {
    distribution[rating]++;
  });

  return {
    averageRating: Math.round(data.averageRating * 10) / 10,
    totalReviews: data.totalReviews,
    ratingDistribution: distribution
  };
};

// Static method to get seller average rating
reviewSchema.statics.getSellerAverageRating = async function(sellerId) {
  const result = await this.aggregate([
    { $match: { seller: mongoose.Types.ObjectId(sellerId), status: 'active' } },
    { $group: {
      _id: null,
      averageRating: { $avg: '$rating' },
      totalReviews: { $sum: 1 }
    }}
  ]);

  if (result.length === 0) {
    return { averageRating: 0, totalReviews: 0 };
  }

  return {
    averageRating: Math.round(result[0].averageRating * 10) / 10,
    totalReviews: result[0].totalReviews
  };
};

// Instance method to check if user found review helpful
reviewSchema.methods.isHelpfulToUser = function(userId) {
  return this.helpful.some(h => h.user.toString() === userId.toString());
};

// Instance method to check if user found review unhelpful
reviewSchema.methods.isUnhelpfulToUser = function(userId) {
  return this.unhelpful.some(h => h.user.toString() === userId.toString());
};

// Instance method to toggle helpfulness
reviewSchema.methods.toggleHelpfulness = function(userId, isHelpful) {
  const userIdStr = userId.toString();
  
  // Remove from both arrays first
  this.helpful = this.helpful.filter(h => h.user.toString() !== userIdStr);
  this.unhelpful = this.unhelpful.filter(h => h.user.toString() !== userIdStr);
  
  // Add to appropriate array
  if (isHelpful) {
    this.helpful.push({ user: userId });
  } else {
    this.unhelpful.push({ user: userId });
  }
  
  return this.save();
};

// Pre-save middleware to validate verified status
reviewSchema.pre('save', function(next) {
  if (this.verified && !this.order) {
    this.verified = false;
  }
  next();
});

// Post-save middleware to update product rating
reviewSchema.post('save', async function(doc) {
  try {
    const Product = mongoose.model('Product');
    const stats = await this.constructor.getProductAverageRating(doc.product);
    
    await Product.findByIdAndUpdate(doc.product, {
      'rating.average': stats.averageRating,
      'rating.count': stats.totalReviews,
      'rating.distribution': stats.ratingDistribution
    });
  } catch (error) {
    console.error('Error updating product rating:', error);
  }
});

// Post-remove middleware to update product rating
reviewSchema.post('remove', async function(doc) {
  try {
    const Product = mongoose.model('Product');
    const stats = await this.constructor.getProductAverageRating(doc.product);
    
    await Product.findByIdAndUpdate(doc.product, {
      'rating.average': stats.averageRating,
      'rating.count': stats.totalReviews,
      'rating.distribution': stats.ratingDistribution
    });
  } catch (error) {
    console.error('Error updating product rating after review removal:', error);
  }
});

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;