// models/Review.js - Advanced Review & Rating System

const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // Basic Information
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductAdvanced',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true
  },
  
  // Rating & Review Content
  rating: {
    overall: { type: Number, required: true, min: 1, max: 5 },
    quality: { type: Number, min: 1, max: 5 },
    value: { type: Number, min: 1, max: 5 },
    delivery: { type: Number, min: 1, max: 5 },
    service: { type: Number, min: 1, max: 5 }
  },
  
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [100, 'Review title cannot exceed 100 characters']
  },
  
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: [2000, 'Review content cannot exceed 2000 characters']
  },
  
  // Media Attachments
  media: {
  images: [{
      url: { type: String, required: true },
      alt: String,
      caption: String,
      isVerified: { type: Boolean, default: false }
    }],
    videos: [{
      url: { type: String, required: true },
      thumbnail: String,
      duration: Number,
      caption: String,
      isVerified: { type: Boolean, default: false }
    }]
  },
  
  // Review Categories & Tags
  categories: [{
    type: String,
    enum: [
      'quality', 'design', 'value_for_money', 'durability', 
      'ease_of_use', 'packaging', 'delivery', 'customer_service',
      'size_fit', 'color_accuracy', 'performance', 'features'
    ]
  }],
  
  tags: [String], // User-generated tags
  
  // Pros & Cons
  pros: [String],
  cons: [String],
  
  // Verification Status
  verification: {
    isVerifiedPurchase: { type: Boolean, default: false },
    verificationMethod: {
      type: String,
      enum: ['order_verification', 'email_verification', 'manual_verification'],
      default: 'order_verification'
    },
    verifiedAt: Date,
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  
  // Helpfulness Metrics
  helpfulness: {
    helpful: { type: Number, default: 0 },
    notHelpful: { type: Number, default: 0 },
    totalVotes: { type: Number, default: 0 },
    helpfulnessScore: { type: Number, default: 0 }
  },
  
  // User Interaction
  votedUsers: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    vote: { type: String, enum: ['helpful', 'not_helpful'] },
    votedAt: { type: Date, default: Date.now }
  }],
  
  // Seller Response
  sellerResponse: {
    content: String,
    respondedAt: Date,
    respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  
  // Review Status & Moderation
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'flagged', 'hidden'],
    default: 'pending',
    index: true
  },
  
  moderation: {
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    moderatedAt: Date,
    moderationReason: String,
    autoModerated: { type: Boolean, default: false },
    flagReasons: [String],
    flagCount: { type: Number, default: 0 }
  },
  
  // Review Quality Metrics
  quality: {
    wordCount: { type: Number, default: 0 },
    hasMedia: { type: Boolean, default: false },
    hasProsCons: { type: Boolean, default: false },
    detailLevel: { type: String, enum: ['basic', 'detailed', 'comprehensive'], default: 'basic' },
    qualityScore: { type: Number, default: 0, min: 0, max: 100 }
  },
  
  // Sentiment Analysis
  sentiment: {
    score: { type: Number, min: -1, max: 1 }, // -1 (negative) to 1 (positive)
    magnitude: { type: Number, min: 0, max: 1 }, // Strength of sentiment
    classification: { type: String, enum: ['positive', 'negative', 'neutral'] },
    keywords: [String],
    analyzedAt: Date
  },
  
  // Purchase Context
  purchaseContext: {
    variant: String, // Which product variant was purchased
    purchasePrice: Number,
    purchaseDate: Date,
    deliveryDate: Date,
    usageDuration: String, // How long user used before reviewing
    isGift: { type: Boolean, default: false },
    occasion: String
  },
  
  // Review Incentives
  incentive: {
    hasIncentive: { type: Boolean, default: false },
    incentiveType: { type: String, enum: ['points', 'discount', 'cashback', 'none'], default: 'none' },
    incentiveValue: Number,
    earnedAt: Date
  },
  
  // Geographic & Demographic Context
  context: {
    location: {
      city: String,
      state: String,
      country: String
    },
    device: String, // Device used to write review
    platform: { type: String, enum: ['web', 'mobile_app', 'mobile_web'], default: 'web' }
  },
  
  // Review Updates
  updates: [{
    updatedAt: { type: Date, default: Date.now },
    changes: [String], // What was changed
    reason: String
  }],
  
  // Featured Review
  isFeatured: { type: Boolean, default: false },
  featuredAt: Date,
  featuredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Review Metrics
  metrics: {
    views: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    reports: { type: Number, default: 0 }
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

// Indexes for performance
reviewSchema.index({ product: 1, status: 1, createdAt: -1 });
reviewSchema.index({ user: 1, createdAt: -1 });
reviewSchema.index({ 'rating.overall': -1, status: 1 });
reviewSchema.index({ 'helpfulness.helpfulnessScore': -1 });
reviewSchema.index({ isFeatured: 1, status: 1 });
reviewSchema.index({ 'verification.isVerifiedPurchase': 1 });
reviewSchema.index({ createdAt: -1 });

// Compound indexes
reviewSchema.index({ product: 1, 'rating.overall': -1, createdAt: -1 });
reviewSchema.index({ product: 1, 'helpfulness.helpful': -1 });

// Unique constraint to prevent duplicate reviews
reviewSchema.index({ product: 1, user: 1, order: 1 }, { unique: true });

// Virtuals
reviewSchema.virtual('helpfulnessRatio').get(function() {
  if (this.helpfulness.totalVotes === 0) return 0;
  return (this.helpfulness.helpful / this.helpfulness.totalVotes * 100).toFixed(1);
});

reviewSchema.virtual('isHelpful').get(function() {
  return this.helpfulness.helpfulnessScore > 0.6;
});

reviewSchema.virtual('reviewAge').get(function() {
  const now = new Date();
  const reviewDate = this.createdAt;
  const diffTime = Math.abs(now - reviewDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
});

reviewSchema.virtual('averageRating').get(function() {
  const ratings = [
    this.rating.overall,
    this.rating.quality,
    this.rating.value,
    this.rating.delivery,
    this.rating.service
  ].filter(r => r > 0);
  
  if (ratings.length === 0) return this.rating.overall;
  return (ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(1);
});

// Middleware
reviewSchema.pre('save', function(next) {
  // Calculate word count
  if (this.isModified('content')) {
    this.quality.wordCount = this.content.split(/\s+/).length;
  }
  
  // Check if has media
  this.quality.hasMedia = this.media.images.length > 0 || this.media.videos.length > 0;
  
  // Check if has pros/cons
  this.quality.hasProsCons = this.pros.length > 0 || this.cons.length > 0;
  
  // Determine detail level
  if (this.quality.wordCount < 20) {
    this.quality.detailLevel = 'basic';
  } else if (this.quality.wordCount < 100) {
    this.quality.detailLevel = 'detailed';
  } else {
    this.quality.detailLevel = 'comprehensive';
  }
  
  // Calculate quality score
  this.quality.qualityScore = this.calculateQualityScore();
  
  // Calculate helpfulness score
  if (this.helpfulness.totalVotes > 0) {
    this.helpfulness.helpfulnessScore = this.helpfulness.helpful / this.helpfulness.totalVotes;
  }
  
  next();
});

// Instance Methods
reviewSchema.methods.calculateQualityScore = function() {
  let score = 0;
  
  // Word count scoring (0-30 points)
  if (this.quality.wordCount >= 50) score += 30;
  else if (this.quality.wordCount >= 20) score += 20;
  else if (this.quality.wordCount >= 10) score += 10;
  
  // Media scoring (0-25 points)
  if (this.media.images.length > 0) score += 15;
  if (this.media.videos.length > 0) score += 10;
  
  // Pros/cons scoring (0-20 points)
  if (this.pros.length > 0 && this.cons.length > 0) score += 20;
  else if (this.pros.length > 0 || this.cons.length > 0) score += 10;
  
  // Detailed ratings scoring (0-15 points)
  const detailedRatings = [this.rating.quality, this.rating.value, this.rating.delivery, this.rating.service]
    .filter(r => r > 0).length;
  score += detailedRatings * 3;
  
  // Verification bonus (0-10 points)
  if (this.verification.isVerifiedPurchase) score += 10;
  
  return Math.min(score, 100);
};

reviewSchema.methods.addHelpfulVote = function(userId, voteType) {
  // Check if user already voted
  const existingVote = this.votedUsers.find(v => v.user.toString() === userId.toString());
  
  if (existingVote) {
    // Update existing vote
    if (existingVote.vote !== voteType) {
      // Remove old vote count
      if (existingVote.vote === 'helpful') {
        this.helpfulness.helpful--;
      } else {
        this.helpfulness.notHelpful--;
      }
      
      // Add new vote count
      if (voteType === 'helpful') {
        this.helpfulness.helpful++;
      } else {
        this.helpfulness.notHelpful++;
      }
      
      existingVote.vote = voteType;
      existingVote.votedAt = new Date();
    }
  } else {
    // Add new vote
    this.votedUsers.push({
      user: userId,
      vote: voteType,
      votedAt: new Date()
    });
    
    if (voteType === 'helpful') {
      this.helpfulness.helpful++;
    } else {
      this.helpfulness.notHelpful++;
    }
    this.helpfulness.totalVotes++;
  }
  
  // Recalculate helpfulness score
  this.helpfulness.helpfulnessScore = this.helpfulness.helpful / this.helpfulness.totalVotes;
  
  return this.save();
};

reviewSchema.methods.addSellerResponse = function(content, sellerId) {
  this.sellerResponse = {
    content: content,
    respondedAt: new Date(),
    respondedBy: sellerId
  };
  
  return this.save();
};

reviewSchema.methods.flagReview = function(reason, userId) {
  if (!this.moderation.flagReasons.includes(reason)) {
    this.moderation.flagReasons.push(reason);
    this.moderation.flagCount++;
    
    // Auto-hide if too many flags
    if (this.moderation.flagCount >= 5) {
      this.status = 'flagged';
    }
  }
  
  return this.save();
};

reviewSchema.methods.incrementView = function() {
  this.metrics.views++;
  return this.save();
};

// Static Methods
reviewSchema.statics.getProductReviewStats = function(productId) {
  return this.aggregate([
    { $match: { product: mongoose.Types.ObjectId(productId), status: 'approved' } },
    {
      $group: {
        _id: '$product',
        totalReviews: { $sum: 1 },
        averageRating: { $avg: '$rating.overall' },
        ratingDistribution: {
          $push: {
            $switch: {
              branches: [
                { case: { $eq: ['$rating.overall', 1] }, then: '1' },
                { case: { $eq: ['$rating.overall', 2] }, then: '2' },
                { case: { $eq: ['$rating.overall', 3] }, then: '3' },
                { case: { $eq: ['$rating.overall', 4] }, then: '4' },
                { case: { $eq: ['$rating.overall', 5] }, then: '5' }
              ]
            }
          }
        },
        verifiedReviews: {
          $sum: { $cond: ['$verification.isVerifiedPurchase', 1, 0] }
        },
        reviewsWithMedia: {
          $sum: { $cond: ['$quality.hasMedia', 1, 0] }
        }
      }
    }
  ]);
};

reviewSchema.statics.getFeaturedReviews = function(productId, limit = 5) {
  return this.find({
    product: productId,
    status: 'approved',
    $or: [
      { isFeatured: true },
      { 'helpfulness.helpfulnessScore': { $gte: 0.8 } },
      { 'quality.qualityScore': { $gte: 80 } }
    ]
  })
  .sort({ isFeatured: -1, 'helpfulness.helpful': -1, 'quality.qualityScore': -1 })
  .limit(limit)
  .populate('user', 'name avatar')
  .lean();
};

reviewSchema.statics.getReviewTrends = function(productId, days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  return this.aggregate([
    {
      $match: {
        product: mongoose.Types.ObjectId(productId),
        status: 'approved',
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
        },
        count: { $sum: 1 },
        averageRating: { $avg: '$rating.overall' }
      }
    },
    { $sort: { '_id': 1 } }
  ]);
};

reviewSchema.statics.findSimilarReviews = function(reviewId, limit = 5) {
  // Find reviews with similar sentiment and keywords
  // This is a simplified version - in production, use ML similarity
  return this.findById(reviewId)
    .then(review => {
      if (!review) return [];
      
      return this.find({
        _id: { $ne: reviewId },
        product: review.product,
        'rating.overall': { $gte: review.rating.overall - 1, $lte: review.rating.overall + 1 },
        status: 'approved'
      })
      .limit(limit)
      .populate('user', 'name avatar')
      .lean();
    });
};

module.exports = mongoose.models.Review || mongoose.model('Review', reviewSchema);