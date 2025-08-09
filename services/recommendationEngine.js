// services/recommendationEngine.js - AI-Powered Recommendation System

const mongoose = require('mongoose');
const ProductAdvanced = require('../models/ProductAdvanced');
const User = require('../models/User');
const Order = require('../models/order');

class RecommendationEngine {
  constructor() {
    this.algorithms = {
      collaborative: 'collaborative_filtering',
      content: 'content_based',
      hybrid: 'hybrid_approach',
      trending: 'trending_algorithm',
      behavioral: 'behavioral_analysis'
    };
    
    this.weights = {
      purchase: 1.0,
      view: 0.3,
      cart_add: 0.6,
      wishlist: 0.4,
      rating: 0.8,
      search: 0.2
    };
  }

  /**
   * Get personalized recommendations for a user
   */
  async getPersonalizedRecommendations(userId, options = {}) {
    const {
      limit = 20,
      algorithm = 'hybrid',
      excludeViewed = true,
      categories = null,
      priceRange = null
    } = options;

    try {
      const user = await User.findById(userId).lean();
      if (!user) {
        return this.getFallbackRecommendations(limit);
      }

      let recommendations = [];

      switch (algorithm) {
        case 'collaborative':
          recommendations = await this.collaborativeFiltering(userId, limit);
          break;
        
        case 'content':
          recommendations = await this.contentBasedFiltering(userId, limit);
          break;
        
        case 'behavioral':
          recommendations = await this.behavioralRecommendations(userId, limit);
          break;
        
        case 'hybrid':
        default:
          recommendations = await this.hybridRecommendations(userId, limit);
          break;
      }

      // Apply filters
      if (categories) {
        recommendations = recommendations.filter(product => 
          categories.includes(product.category.toString())
        );
      }

      if (priceRange) {
        recommendations = recommendations.filter(product => 
          product.basePrice >= priceRange.min && product.basePrice <= priceRange.max
        );
      }

      // Add recommendation scores and reasons
      return recommendations.map(product => ({
        ...product,
        recommendationScore: this.calculateRecommendationScore(product, user),
        recommendationReason: this.getRecommendationReason(product, user)
      }));

    } catch (error) {
      console.error('Error getting personalized recommendations:', error);
      return this.getFallbackRecommendations(limit);
    }
  }

  /**
   * Collaborative Filtering - "Users like you also bought"
   */
  async collaborativeFiltering(userId, limit) {
    try {
      // Find users with similar purchase behavior
      const userOrders = await Order.find({ user: userId })
        .populate('items.product')
        .lean();

      if (userOrders.length === 0) {
        return this.getTrendingProducts(limit);
      }

      const userProductIds = userOrders.flatMap(order => 
        order.items.map(item => item.product?._id)
      ).filter(Boolean);

      // Find similar users who bought the same products
      const similarUsers = await Order.aggregate([
        {
          $match: {
            'items.product': { $in: userProductIds },
            user: { $ne: mongoose.Types.ObjectId(userId) }
          }
        },
        {
          $group: {
            _id: '$user',
            commonProducts: { $sum: 1 },
            totalSpent: { $sum: '$totalAmount' }
          }
        },
        { $sort: { commonProducts: -1, totalSpent: -1 } },
        { $limit: 50 }
      ]);

      if (similarUsers.length === 0) {
        return this.getTrendingProducts(limit);
      }

      const similarUserIds = similarUsers.map(user => user._id);

      // Get products bought by similar users but not by current user
      const recommendations = await Order.aggregate([
        {
          $match: {
            user: { $in: similarUserIds }
          }
        },
        { $unwind: '$items' },
        {
          $match: {
            'items.product': { $nin: userProductIds }
          }
        },
        {
          $group: {
            _id: '$items.product',
            purchaseCount: { $sum: 1 },
            avgQuantity: { $avg: '$items.quantity' },
            totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        },
        { $sort: { purchaseCount: -1, totalRevenue: -1 } },
        { $limit: limit * 2 }
      ]);

      const productIds = recommendations.map(rec => rec._id);
      const products = await ProductAdvanced.find({
        _id: { $in: productIds },
        status: 'active',
        isDeleted: false
      })
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .limit(limit)
      .lean();

      return products;

    } catch (error) {
      console.error('Error in collaborative filtering:', error);
      return [];
    }
  }

  /**
   * Content-Based Filtering - Based on product attributes
   */
  async contentBasedFiltering(userId, limit) {
    try {
      const userOrders = await Order.find({ user: userId })
        .populate('items.product')
        .lean();

      if (userOrders.length === 0) {
        return this.getTrendingProducts(limit);
      }

      // Analyze user's product preferences
      const preferences = this.analyzeUserPreferences(userOrders);

      // Find similar products based on attributes
      const recommendations = await ProductAdvanced.find({
        $or: [
          { category: { $in: preferences.categories } },
          { brand: { $in: preferences.brands } },
          { 'promotion.tags': { $in: preferences.tags } }
        ],
        status: 'active',
        isDeleted: false,
        basePrice: {
          $gte: preferences.priceRange.min * 0.8,
          $lte: preferences.priceRange.max * 1.2
        }
      })
      .sort({ 'reviews.averageRating': -1, 'analytics.purchases': -1 })
      .limit(limit)
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .lean();

      return recommendations;

    } catch (error) {
      console.error('Error in content-based filtering:', error);
      return [];
    }
  }

  /**
   * Behavioral Recommendations - Based on user actions
   */
  async behavioralRecommendations(userId, limit) {
    try {
      // This would typically use real user behavior data
      // For now, we'll simulate based on order patterns
      
      const user = await User.findById(userId).lean();
      const userOrders = await Order.find({ user: userId })
        .populate('items.product')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      if (userOrders.length === 0) {
        return this.getNewUserRecommendations(user, limit);
      }

      // Analyze behavioral patterns
      const patterns = this.analyzeBehavioralPatterns(userOrders);

      let query = {
        status: 'active',
        isDeleted: false
      };

      // Time-based patterns
      if (patterns.preferredTimeOfDay) {
        // Products popular at similar times
        query['analytics.views'] = { $gt: 100 };
      }

      // Category switching patterns
      if (patterns.categoryDiversity > 0.5) {
        // User likes variety - recommend from different categories
        query.category = { $nin: patterns.recentCategories };
      } else {
        // User is focused - recommend from same categories
        query.category = { $in: patterns.recentCategories };
      }

      // Price sensitivity
      if (patterns.priceSensitive) {
        query.$or = [
          { 'promotion.isOnSale': true },
          { 'shipping.freeShipping': true }
        ];
      }

      const recommendations = await ProductAdvanced.find(query)
        .sort(this.getBehavioralSortCriteria(patterns))
        .limit(limit)
        .populate('brand', 'name logo')
        .populate('category', 'name')
        .lean();

      return recommendations;

    } catch (error) {
      console.error('Error in behavioral recommendations:', error);
      return [];
    }
  }

  /**
   * Hybrid Approach - Combines multiple algorithms
   */
  async hybridRecommendations(userId, limit) {
    try {
      const batchSize = Math.ceil(limit / 3);
      
      // Get recommendations from different algorithms
      const [collaborative, contentBased, behavioral] = await Promise.all([
        this.collaborativeFiltering(userId, batchSize),
        this.contentBasedFiltering(userId, batchSize),
        this.behavioralRecommendations(userId, batchSize)
      ]);

      // Combine and deduplicate
      const combined = new Map();
      
      // Add collaborative filtering results (highest weight)
      collaborative.forEach((product, index) => {
        const score = (batchSize - index) / batchSize * 0.4;
        combined.set(product._id.toString(), { ...product, hybridScore: score });
      });

      // Add content-based results
      contentBased.forEach((product, index) => {
        const productId = product._id.toString();
        const score = (batchSize - index) / batchSize * 0.35;
        
        if (combined.has(productId)) {
          combined.get(productId).hybridScore += score;
        } else {
          combined.set(productId, { ...product, hybridScore: score });
        }
      });

      // Add behavioral results
      behavioral.forEach((product, index) => {
        const productId = product._id.toString();
        const score = (batchSize - index) / batchSize * 0.25;
        
        if (combined.has(productId)) {
          combined.get(productId).hybridScore += score;
        } else {
          combined.set(productId, { ...product, hybridScore: score });
        }
      });

      // Sort by hybrid score and return top results
      return Array.from(combined.values())
        .sort((a, b) => b.hybridScore - a.hybridScore)
        .slice(0, limit);

    } catch (error) {
      console.error('Error in hybrid recommendations:', error);
      return this.getFallbackRecommendations(limit);
    }
  }

  /**
   * Trending Products Algorithm
   */
  async getTrendingProducts(limit) {
    try {
      const timeWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days

      const trending = await ProductAdvanced.aggregate([
        {
          $match: {
            status: 'active',
            isDeleted: false,
            createdAt: { $gte: timeWindow }
          }
        },
        {
          $addFields: {
            trendingScore: {
              $add: [
                { $multiply: ['$analytics.views', 0.1] },
                { $multiply: ['$analytics.purchases', 0.4] },
                { $multiply: ['$analytics.cartAdds', 0.2] },
                { $multiply: ['$reviews.averageRating', 0.3] }
              ]
            }
          }
        },
        { $sort: { trendingScore: -1, createdAt: -1 } },
        { $limit: limit }
      ]);

      await ProductAdvanced.populate(trending, [
        { path: 'brand', select: 'name logo' },
        { path: 'category', select: 'name' }
      ]);

      return trending;

    } catch (error) {
      console.error('Error getting trending products:', error);
      return [];
    }
  }

  /**
   * Similar Products - "Customers who viewed this also viewed"
   */
  async getSimilarProducts(productId, limit) {
    try {
      const product = await ProductAdvanced.findById(productId).lean();
      if (!product) return [];

      // Find products in same category with similar attributes
      const similar = await ProductAdvanced.find({
        _id: { $ne: productId },
        category: product.category,
        status: 'active',
        isDeleted: false,
        basePrice: {
          $gte: product.basePrice * 0.7,
          $lte: product.basePrice * 1.3
        }
      })
      .sort({ 'reviews.averageRating': -1, 'analytics.views': -1 })
      .limit(limit)
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .lean();

      // If not enough similar products, expand to same brand
      if (similar.length < limit) {
        const brandSimilar = await ProductAdvanced.find({
          _id: { $ne: productId, $nin: similar.map(p => p._id) },
          brand: product.brand,
          status: 'active',
          isDeleted: false
        })
        .sort({ 'reviews.averageRating': -1 })
        .limit(limit - similar.length)
        .populate('brand', 'name logo')
        .populate('category', 'name')
        .lean();

        similar.push(...brandSimilar);
      }

      return similar;

    } catch (error) {
      console.error('Error getting similar products:', error);
      return [];
    }
  }

  /**
   * Frequently Bought Together
   */
  async getFrequentlyBoughtTogether(productId, limit = 5) {
    try {
      // Find orders that contain this product
      const ordersWithProduct = await Order.aggregate([
        { $unwind: '$items' },
        { $match: { 'items.product': mongoose.Types.ObjectId(productId) } },
        { $group: { _id: '$_id', items: { $push: '$items' } } }
      ]);

      if (ordersWithProduct.length === 0) return [];

      // Find products frequently bought with this product
      const frequentlyBought = await Order.aggregate([
        { $match: { _id: { $in: ordersWithProduct.map(o => o._id) } } },
        { $unwind: '$items' },
        { $match: { 'items.product': { $ne: mongoose.Types.ObjectId(productId) } } },
        {
          $group: {
            _id: '$items.product',
            frequency: { $sum: 1 },
            totalQuantity: { $sum: '$items.quantity' }
          }
        },
        { $sort: { frequency: -1, totalQuantity: -1 } },
        { $limit: limit }
      ]);

      const productIds = frequentlyBought.map(item => item._id);
      const products = await ProductAdvanced.find({
        _id: { $in: productIds },
        status: 'active',
        isDeleted: false
      })
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .lean();

      // Add frequency data to products
      return products.map(product => {
        const freqData = frequentlyBought.find(f => f._id.toString() === product._id.toString());
        return {
          ...product,
          frequency: freqData.frequency,
          bundleDiscount: this.calculateBundleDiscount(product.basePrice)
        };
      });

    } catch (error) {
      console.error('Error getting frequently bought together:', error);
      return [];
    }
  }

  /**
   * Cross-sell Recommendations
   */
  async getCrossSellRecommendations(cartItems, limit = 10) {
    try {
      const cartProductIds = cartItems.map(item => item.productId);
      const cartCategories = [];
      
      // Get categories of cart items
      const cartProducts = await ProductAdvanced.find({
        _id: { $in: cartProductIds }
      }).select('category').lean();
      
      cartProducts.forEach(product => {
        if (!cartCategories.includes(product.category.toString())) {
          cartCategories.push(product.category.toString());
        }
      });

      // Find complementary products
      const crossSells = await ProductAdvanced.find({
        _id: { $nin: cartProductIds },
        $or: [
          { category: { $in: cartCategories } },
          { 'related.crossSells': { $in: cartProductIds } }
        ],
        status: 'active',
        isDeleted: false
      })
      .sort({ 'analytics.purchases': -1, 'reviews.averageRating': -1 })
      .limit(limit)
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .lean();

      return crossSells.map(product => ({
        ...product,
        crossSellReason: this.getCrossSellReason(product, cartProducts)
      }));

    } catch (error) {
      console.error('Error getting cross-sell recommendations:', error);
      return [];
    }
  }

  /**
   * Up-sell Recommendations
   */
  async getUpSellRecommendations(productId, limit = 5) {
    try {
      const product = await ProductAdvanced.findById(productId).lean();
      if (!product) return [];

      // Find higher-priced products in same category
      const upSells = await ProductAdvanced.find({
        _id: { $ne: productId },
        category: product.category,
        basePrice: { $gt: product.basePrice },
        status: 'active',
        isDeleted: false
      })
      .sort({ basePrice: 1, 'reviews.averageRating': -1 })
      .limit(limit)
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .lean();

      return upSells.map(upSell => ({
        ...upSell,
        priceDifference: upSell.basePrice - product.basePrice,
        upgradeValue: this.calculateUpgradeValue(product, upSell)
      }));

    } catch (error) {
      console.error('Error getting up-sell recommendations:', error);
      return [];
    }
  }

  // Helper Methods

  analyzeUserPreferences(userOrders) {
    const categories = new Set();
    const brands = new Set();
    const tags = new Set();
    let totalSpent = 0;
    let itemCount = 0;

    userOrders.forEach(order => {
      order.items.forEach(item => {
        if (item.product) {
          categories.add(item.product.category);
          brands.add(item.product.brand);
          if (item.product.promotion && item.product.promotion.tags) {
            item.product.promotion.tags.forEach(tag => tags.add(tag));
          }
          totalSpent += item.price * item.quantity;
          itemCount++;
        }
      });
    });

    return {
      categories: Array.from(categories),
      brands: Array.from(brands),
      tags: Array.from(tags),
      priceRange: {
        min: Math.max(0, (totalSpent / itemCount) * 0.5),
        max: (totalSpent / itemCount) * 1.5
      },
      averageOrderValue: totalSpent / userOrders.length
    };
  }

  analyzeBehavioralPatterns(userOrders) {
    const categories = new Set();
    let totalSpent = 0;
    let discountedPurchases = 0;
    
    userOrders.forEach(order => {
      order.items.forEach(item => {
        if (item.product) {
          categories.add(item.product.category.toString());
          totalSpent += item.price * item.quantity;
          
          if (item.product.promotion && item.product.promotion.isOnSale) {
            discountedPurchases++;
          }
        }
      });
    });

    return {
      categoryDiversity: categories.size / Math.max(1, userOrders.length),
      recentCategories: Array.from(categories),
      priceSensitive: discountedPurchases / userOrders.length > 0.3,
      averageOrderValue: totalSpent / userOrders.length
    };
  }

  getBehavioralSortCriteria(patterns) {
    if (patterns.priceSensitive) {
      return { basePrice: 1, 'reviews.averageRating': -1 };
    }
    return { 'reviews.averageRating': -1, 'analytics.purchases': -1 };
  }

  calculateRecommendationScore(product, user) {
    let score = 0;
    
    // Base score from product metrics
    score += product.reviews.averageRating * 0.2;
    score += Math.min(product.analytics.purchases / 100, 1) * 0.3;
    score += Math.min(product.analytics.views / 1000, 1) * 0.1;
    
    // User preference alignment
    if (user.preferences && user.preferences.categories) {
      if (user.preferences.categories.includes(product.category.toString())) {
        score += 0.4;
      }
    }
    
    return Math.min(score, 5.0);
  }

  getRecommendationReason(product, user) {
    const reasons = [];
    
    if (product.reviews.averageRating >= 4.5) {
      reasons.push('Highly rated');
    }
    
    if (product.promotion && product.promotion.isBestSeller) {
      reasons.push('Best seller');
    }
    
    if (product.promotion && product.promotion.isOnSale) {
      reasons.push('On sale');
    }
    
    return reasons.join(', ') || 'Recommended for you';
  }

  getCrossSellReason(product, cartProducts) {
    // Simple logic - in production, use ML models
    return 'Customers also bought';
  }

  calculateUpgradeValue(baseProduct, upSellProduct) {
    const priceDiff = upSellProduct.basePrice - baseProduct.basePrice;
    const ratingDiff = upSellProduct.reviews.averageRating - baseProduct.reviews.averageRating;
    
    return {
      priceIncrease: priceDiff,
      ratingImprovement: ratingDiff,
      worthUpgrade: ratingDiff > 0.5 && priceDiff < baseProduct.basePrice * 0.5
    };
  }

  calculateBundleDiscount(price) {
    // Simple bundle discount calculation
    if (price > 1000) return 0.1; // 10%
    if (price > 500) return 0.05;  // 5%
    return 0.02; // 2%
  }

  async getFallbackRecommendations(limit) {
    return this.getTrendingProducts(limit);
  }

  async getNewUserRecommendations(user, limit) {
    // For new users, show popular and trending products
    return this.getTrendingProducts(limit);
  }
}

module.exports = new RecommendationEngine();
