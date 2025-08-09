// services/reviewService.js - Advanced Review Management Service

const Review = require('../models/Review');
const ProductAdvanced = require('../models/ProductAdvanced');
const Order = require('../models/order');
const User = require('../models/User');

class ReviewService {
  constructor() {
    this.moderationKeywords = [
      'fake', 'spam', 'bot', 'paid', 'promotional', 'advertisement',
      'profanity', 'offensive', 'inappropriate', 'misleading'
    ];
    
    this.qualityThresholds = {
      excellent: 80,
      good: 60,
      average: 40,
      poor: 20
    };
  }

  /**
   * Create a new review
   */
  async createReview(reviewData) {
    try {
      const {
        productId,
        userId,
        orderId,
        rating,
        title,
        content,
        media = {},
        categories = [],
        pros = [],
        cons = [],
        purchaseContext = {}
      } = reviewData;

      // Verify user can review this product
      const canReview = await this.canUserReviewProduct(userId, productId, orderId);
      if (!canReview.allowed) {
        throw new Error(canReview.reason);
      }

      // Check for existing review
      const existingReview = await Review.findOne({
        product: productId,
        user: userId,
        order: orderId
      });

      if (existingReview) {
        throw new Error('You have already reviewed this product');
      }

      // Create review
      const review = new Review({
        product: productId,
        user: userId,
        order: orderId,
        rating,
        title,
        content,
        media,
        categories,
        pros,
        cons,
        purchaseContext,
        verification: {
          isVerifiedPurchase: true,
          verificationMethod: 'order_verification',
          verifiedAt: new Date()
        }
      });

      // Auto-moderate review
      const moderationResult = await this.autoModerateReview(review);
      review.status = moderationResult.status;
      review.moderation = moderationResult.moderation;

      // Analyze sentiment
      const sentimentResult = await this.analyzeSentiment(review.content);
      review.sentiment = sentimentResult;

      await review.save();

      // Update product rating
      await this.updateProductRating(productId);

      // Send notifications
      await this.sendReviewNotifications(review);

      return {
        success: true,
        reviewId: review._id,
        status: review.status,
        message: review.status === 'approved' 
          ? 'Review published successfully' 
          : 'Review submitted for moderation'
      };

    } catch (error) {
      console.error('Error creating review:', error);
      throw error;
    }
  }

  /**
   * Get reviews for a product
   */
  async getProductReviews(productId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sort = 'helpful',
        filter = {},
        includeStats = true
      } = options;

      const skip = (page - 1) * limit;
      let sortOptions = {};

      // Build sort options
      switch (sort) {
        case 'helpful':
          sortOptions = { 'helpfulness.helpful': -1, createdAt: -1 };
          break;
        case 'recent':
          sortOptions = { createdAt: -1 };
          break;
        case 'rating_high':
          sortOptions = { 'rating.overall': -1, createdAt: -1 };
          break;
        case 'rating_low':
          sortOptions = { 'rating.overall': 1, createdAt: -1 };
          break;
        case 'verified':
          sortOptions = { 'verification.isVerifiedPurchase': -1, 'helpfulness.helpful': -1 };
          break;
        default:
          sortOptions = { 'helpfulness.helpful': -1, createdAt: -1 };
      }

      // Build query
      const query = {
        product: productId,
        status: 'approved'
      };

      // Apply filters
      if (filter.rating) {
        query['rating.overall'] = filter.rating;
      }
      if (filter.verified) {
        query['verification.isVerifiedPurchase'] = true;
      }
      if (filter.withMedia) {
        query['quality.hasMedia'] = true;
      }
      if (filter.withProsCons) {
        query['quality.hasProsCons'] = true;
      }

      // Get reviews
      const reviews = await Review.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .populate('user', 'name avatar')
        .lean();

      // Get total count
      const totalReviews = await Review.countDocuments(query);

      let result = {
        reviews,
        pagination: {
          current: page,
          total: Math.ceil(totalReviews / limit),
          limit,
          count: reviews.length,
          totalReviews
        }
      };

      // Include statistics if requested
      if (includeStats) {
        const stats = await this.getProductReviewStats(productId);
        result.stats = stats;
      }

      return result;

    } catch (error) {
      console.error('Error getting product reviews:', error);
      throw error;
    }
  }

  /**
   * Get review statistics for a product
   */
  async getProductReviewStats(productId) {
    try {
      const stats = await Review.aggregate([
        { $match: { product: mongoose.Types.ObjectId(productId), status: 'approved' } },
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            averageRating: { $avg: '$rating.overall' },
            verifiedReviews: {
              $sum: { $cond: ['$verification.isVerifiedPurchase', 1, 0] }
            },
            reviewsWithMedia: {
              $sum: { $cond: ['$quality.hasMedia', 1, 0] }
            },
            ratingDistribution: {
              $push: '$rating.overall'
            }
          }
        }
      ]);

      if (stats.length === 0) {
        return {
          totalReviews: 0,
          averageRating: 0,
          verifiedReviews: 0,
          reviewsWithMedia: 0,
          ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          verificationRate: 0,
          mediaRate: 0
        };
      }

      const result = stats[0];
      
      // Calculate rating distribution
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      result.ratingDistribution.forEach(rating => {
        distribution[rating]++;
      });

      return {
        totalReviews: result.totalReviews,
        averageRating: parseFloat(result.averageRating.toFixed(1)),
        verifiedReviews: result.verifiedReviews,
        reviewsWithMedia: result.reviewsWithMedia,
        ratingDistribution: distribution,
        verificationRate: ((result.verifiedReviews / result.totalReviews) * 100).toFixed(1),
        mediaRate: ((result.reviewsWithMedia / result.totalReviews) * 100).toFixed(1)
      };

    } catch (error) {
      console.error('Error getting review stats:', error);
      throw error;
    }
  }

  /**
   * Vote on review helpfulness
   */
  async voteOnReview(reviewId, userId, voteType) {
    try {
      const review = await Review.findById(reviewId);
      if (!review) {
        throw new Error('Review not found');
      }

      // Check if user is the review author
      if (review.user.toString() === userId.toString()) {
        throw new Error('You cannot vote on your own review');
      }

      await review.addHelpfulVote(userId, voteType);

      return {
        success: true,
        helpful: review.helpfulness.helpful,
        notHelpful: review.helpfulness.notHelpful,
        helpfulnessRatio: review.helpfulnessRatio
      };

    } catch (error) {
      console.error('Error voting on review:', error);
      throw error;
    }
  }

  /**
   * Add seller response to review
   */
  async addSellerResponse(reviewId, sellerId, content) {
    try {
      const review = await Review.findById(reviewId).populate('product');
      if (!review) {
        throw new Error('Review not found');
      }

      // Verify seller owns the product
      if (review.product.seller.toString() !== sellerId.toString()) {
        throw new Error('You can only respond to reviews of your products');
      }

      await review.addSellerResponse(content, sellerId);

      // Notify review author
      await this.notifyReviewAuthor(review, 'seller_response');

      return {
        success: true,
        message: 'Response added successfully'
      };

    } catch (error) {
      console.error('Error adding seller response:', error);
      throw error;
    }
  }

  /**
   * Flag a review
   */
  async flagReview(reviewId, userId, reason) {
    try {
      const review = await Review.findById(reviewId);
      if (!review) {
        throw new Error('Review not found');
      }

      await review.flagReview(reason, userId);

      // If review gets too many flags, notify moderators
      if (review.moderation.flagCount >= 3) {
        await this.notifyModerators(review, 'flagged');
      }

      return {
        success: true,
        message: 'Review flagged for moderation'
      };

    } catch (error) {
      console.error('Error flagging review:', error);
      throw error;
    }
  }

  /**
   * Get featured reviews
   */
  async getFeaturedReviews(productId, limit = 5) {
    try {
      const reviews = await Review.find({
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

      return reviews;

    } catch (error) {
      console.error('Error getting featured reviews:', error);
      throw error;
    }
  }

  /**
   * Check if user can review a product
   */
  async canUserReviewProduct(userId, productId, orderId) {
    try {
      // Check if order exists and belongs to user
      const order = await Order.findOne({
        _id: orderId,
        user: userId,
        'items.product': productId,
        status: { $in: ['delivered', 'completed'] }
      });

      if (!order) {
        return {
          allowed: false,
          reason: 'You can only review products you have purchased and received'
        };
      }

      // Check if already reviewed
      const existingReview = await Review.findOne({
        product: productId,
        user: userId,
        order: orderId
      });

      if (existingReview) {
        return {
          allowed: false,
          reason: 'You have already reviewed this product'
        };
      }

      // Check if enough time has passed since delivery (optional)
      const deliveryDate = order.deliveredAt || order.updatedAt;
      const daysSinceDelivery = (Date.now() - deliveryDate) / (1000 * 60 * 60 * 24);
      
      if (daysSinceDelivery > 365) {
        return {
          allowed: false,
          reason: 'Review period has expired (1 year after delivery)'
        };
      }

      return { allowed: true };

    } catch (error) {
      console.error('Error checking review eligibility:', error);
      return {
        allowed: false,
        reason: 'Unable to verify purchase'
      };
    }
  }

  /**
   * Auto-moderate review
   */
  async autoModerateReview(review) {
    const moderation = {
      autoModerated: true,
      moderationReason: '',
      flagReasons: []
    };

    let status = 'approved';

    // Check for spam keywords
    const content = (review.title + ' ' + review.content).toLowerCase();
    const hasSpamKeywords = this.moderationKeywords.some(keyword => 
      content.includes(keyword)
    );

    if (hasSpamKeywords) {
      status = 'flagged';
      moderation.flagReasons.push('potential_spam');
    }

    // Check review length
    if (review.content.length < 10) {
      status = 'flagged';
      moderation.flagReasons.push('too_short');
    }

    // Check for excessive caps
    const capsRatio = (review.content.match(/[A-Z]/g) || []).length / review.content.length;
    if (capsRatio > 0.5) {
      status = 'flagged';
      moderation.flagReasons.push('excessive_caps');
    }

    // Check for repeated characters
    if (/(.)\1{4,}/.test(review.content)) {
      status = 'flagged';
      moderation.flagReasons.push('repeated_characters');
    }

    return { status, moderation };
  }

  /**
   * Analyze sentiment of review content
   */
  async analyzeSentiment(content) {
    // Simplified sentiment analysis - in production, use services like Google Cloud NLP
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'love', 'perfect', 'recommend'];
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disappointed'];
    
    const words = content.toLowerCase().split(/\s+/);
    let positiveCount = 0;
    let negativeCount = 0;

    words.forEach(word => {
      if (positiveWords.includes(word)) positiveCount++;
      if (negativeWords.includes(word)) negativeCount++;
    });

    const totalSentimentWords = positiveCount + negativeCount;
    let score = 0;
    let classification = 'neutral';

    if (totalSentimentWords > 0) {
      score = (positiveCount - negativeCount) / totalSentimentWords;
      if (score > 0.2) classification = 'positive';
      else if (score < -0.2) classification = 'negative';
    }

    return {
      score: parseFloat(score.toFixed(2)),
      magnitude: totalSentimentWords / words.length,
      classification,
      keywords: [...new Set([...positiveWords.filter(w => words.includes(w)), 
                            ...negativeWords.filter(w => words.includes(w))])],
      analyzedAt: new Date()
    };
  }

  /**
   * Update product rating after review changes
   */
  async updateProductRating(productId) {
    try {
      const stats = await Review.aggregate([
        { $match: { product: mongoose.Types.ObjectId(productId), status: 'approved' } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$rating.overall' },
            totalReviews: { $sum: 1 },
            ratingDistribution: {
              $push: '$rating.overall'
            }
          }
        }
      ]);

      if (stats.length > 0) {
        const result = stats[0];
        
        // Calculate rating distribution
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        result.ratingDistribution.forEach(rating => {
          distribution[rating]++;
        });

        await ProductAdvanced.findByIdAndUpdate(productId, {
          'reviews.averageRating': parseFloat(result.averageRating.toFixed(1)),
          'reviews.totalReviews': result.totalReviews,
          'reviews.ratingDistribution': distribution
        });
      }

    } catch (error) {
      console.error('Error updating product rating:', error);
    }
  }

  /**
   * Send review notifications
   */
  async sendReviewNotifications(review) {
    try {
      // Notify product seller
      const product = await ProductAdvanced.findById(review.product).populate('seller');
      if (product && product.seller) {
        await this.notifyUser(product.seller._id, {
          type: 'new_review',
          title: 'New Review Received',
          message: `You received a ${review.rating.overall}-star review for ${product.title}`,
          data: { reviewId: review._id, productId: product._id }
        });
      }

      // Notify other users who might be interested (followers, wishlist users, etc.)
      // Implementation would depend on your user engagement features

    } catch (error) {
      console.error('Error sending review notifications:', error);
    }
  }

  /**
   * Get user's reviews
   */
  async getUserReviews(userId, options = {}) {
    try {
      const { page = 1, limit = 20, status = 'all' } = options;
      const skip = (page - 1) * limit;

      let query = { user: userId };
      if (status !== 'all') {
        query.status = status;
      }

      const reviews = await Review.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('product', 'title media.images')
        .lean();

      const totalReviews = await Review.countDocuments(query);

      return {
        reviews,
        pagination: {
          current: page,
          total: Math.ceil(totalReviews / limit),
          limit,
          count: reviews.length,
          totalReviews
        }
      };

    } catch (error) {
      console.error('Error getting user reviews:', error);
      throw error;
    }
  }

  // Helper methods
  async notifyUser(userId, notification) {
    // Implementation would use your notification service
    console.log(`Notifying user ${userId}:`, notification);
  }

  async notifyReviewAuthor(review, type) {
    // Implementation would notify the review author
    console.log(`Notifying review author for ${type}:`, review._id);
  }

  async notifyModerators(review, reason) {
    // Implementation would notify moderators
    console.log(`Notifying moderators - ${reason}:`, review._id);
  }
}

module.exports = new ReviewService();
