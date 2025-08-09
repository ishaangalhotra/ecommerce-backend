// services/searchService.js - Advanced Search & Recommendation Engine

const mongoose = require('mongoose');
const ProductAdvanced = require('../models/ProductAdvanced');
const User = require('../models/User');
const Order = require('../models/order');

class SearchService {
  constructor() {
    this.popularityWeights = {
      views: 0.1,
      purchases: 0.4,
      cartAdds: 0.2,
      rating: 0.3
    };
  }

  /**
   * Advanced Product Search with AI-powered features
   */
  async searchProducts(query, options = {}) {
    const {
      page = 1,
      limit = 20,
      sort = 'relevance',
      filters = {},
      userId = null,
      location = null
    } = options;

    const skip = (page - 1) * limit;
    let searchQuery = {};
    let sortOptions = {};

    // Build base query
    searchQuery = {
      status: 'active',
      visibility: 'public',
      isDeleted: false
    };

    // Text search
    if (query && query.trim()) {
      searchQuery.$text = { $search: query };
    }

    // Apply filters
    this.applyFilters(searchQuery, filters);

    // Apply sorting
    sortOptions = this.getSortOptions(sort, query);

    // Execute search
    const products = await ProductAdvanced.find(searchQuery, 
      query ? { score: { $meta: 'textScore' } } : {}
    )
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .populate('brand', 'name logo')
    .populate('category', 'name')
    .populate('seller', 'name businessName rating')
    .lean();

    // Get total count
    const total = await ProductAdvanced.countDocuments(searchQuery);

    // Enhance results with personalization
    const enhancedProducts = await this.enhanceSearchResults(products, userId, location);

    // Get search suggestions and related terms
    const suggestions = await this.getSearchSuggestions(query);
    const relatedTerms = await this.getRelatedSearchTerms(query);

    return {
      products: enhancedProducts,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        limit,
        count: products.length,
        totalProducts: total
      },
      filters: await this.getAvailableFilters(searchQuery, query),
      suggestions,
      relatedTerms,
      searchInfo: {
        query,
        resultsFound: total,
        searchTime: Date.now(),
        appliedFilters: Object.keys(filters).length
      }
    };
  }

  /**
   * Apply various filters to search query
   */
  applyFilters(searchQuery, filters) {
    // Category filter
    if (filters.category) {
      if (Array.isArray(filters.category)) {
        searchQuery.$or = [
          { category: { $in: filters.category } },
          { subcategories: { $in: filters.category } }
        ];
      } else {
        searchQuery.$or = [
          { category: filters.category },
          { subcategories: filters.category }
        ];
      }
    }

    // Brand filter
    if (filters.brand) {
      searchQuery.brand = Array.isArray(filters.brand) 
        ? { $in: filters.brand } 
        : filters.brand;
    }

    // Price range filter
    if (filters.minPrice || filters.maxPrice) {
      searchQuery.basePrice = {};
      if (filters.minPrice) searchQuery.basePrice.$gte = parseFloat(filters.minPrice);
      if (filters.maxPrice) searchQuery.basePrice.$lte = parseFloat(filters.maxPrice);
    }

    // Rating filter
    if (filters.minRating) {
      searchQuery['reviews.averageRating'] = { $gte: parseFloat(filters.minRating) };
    }

    // Availability filter
    if (filters.inStock) {
      searchQuery['inventory.stockStatus'] = 'in_stock';
    }

    // Discount filter
    if (filters.onSale) {
      searchQuery['promotion.isOnSale'] = true;
    }

    // Free shipping filter
    if (filters.freeShipping) {
      searchQuery['shipping.freeShipping'] = true;
    }

    // Product type filter
    if (filters.productType) {
      searchQuery.productType = filters.productType;
    }

    // Tags filter
    if (filters.tags) {
      searchQuery['promotion.tags'] = { $in: Array.isArray(filters.tags) ? filters.tags : [filters.tags] };
    }

    // Location-based filter (for local delivery)
    if (filters.location && filters.location.coordinates) {
      searchQuery.sellerLocation = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: filters.location.coordinates
          },
          $maxDistance: filters.location.radius || 10000 // 10km default
        }
      };
    }
  }

  /**
   * Get sort options based on sort parameter
   */
  getSortOptions(sort, query) {
    switch (sort) {
      case 'relevance':
        return query ? { score: { $meta: 'textScore' } } : { 'analytics.views': -1 };
      
      case 'price_low_high':
        return { basePrice: 1 };
      
      case 'price_high_low':
        return { basePrice: -1 };
      
      case 'rating':
        return { 'reviews.averageRating': -1, 'reviews.totalReviews': -1 };
      
      case 'popularity':
        return { 'analytics.purchases': -1, 'analytics.views': -1 };
      
      case 'newest':
        return { createdAt: -1 };
      
      case 'bestseller':
        return { 'analytics.purchases': -1 };
      
      case 'discount':
        return { 'promotion.isOnSale': -1, basePrice: 1 };
      
      default:
        return { 'analytics.views': -1 };
    }
  }

  /**
   * Enhance search results with personalization
   */
  async enhanceSearchResults(products, userId, location) {
    if (!userId) return products;

    try {
      // Get user preferences and history
      const user = await User.findById(userId).lean();
      const userOrders = await Order.find({ user: userId })
        .populate('items.product')
        .lean();

      // Calculate personalization scores
      return products.map(product => {
        let personalScore = 0;

        // Category preference
        if (user.preferences && user.preferences.categories) {
          if (user.preferences.categories.includes(product.category.toString())) {
            personalScore += 0.3;
          }
        }

        // Brand preference (from purchase history)
        const purchasedBrands = userOrders.flatMap(order => 
          order.items.map(item => item.product?.brand?.toString())
        ).filter(Boolean);
        
        if (purchasedBrands.includes(product.brand.toString())) {
          personalScore += 0.2;
        }

        // Price range preference
        const avgOrderValue = userOrders.length > 0 
          ? userOrders.reduce((sum, order) => sum + order.totalAmount, 0) / userOrders.length 
          : 0;
        
        if (avgOrderValue > 0) {
          const priceDiff = Math.abs(product.basePrice - avgOrderValue) / avgOrderValue;
          if (priceDiff < 0.5) personalScore += 0.1;
        }

        return {
          ...product,
          personalScore,
          isPersonalized: personalScore > 0
        };
      });
    } catch (error) {
      console.error('Error enhancing search results:', error);
      return products;
    }
  }

  /**
   * Get search suggestions based on query
   */
  async getSearchSuggestions(query) {
    if (!query || query.length < 2) return [];

    try {
      // Get suggestions from product titles and brands
      const titleSuggestions = await ProductAdvanced.aggregate([
        {
          $match: {
            title: { $regex: query, $options: 'i' },
            status: 'active',
            isDeleted: false
          }
        },
        {
          $group: {
            _id: '$title',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]);

      // Get brand suggestions
      const brandSuggestions = await ProductAdvanced.aggregate([
        {
          $lookup: {
            from: 'brands',
            localField: 'brand',
            foreignField: '_id',
            as: 'brandInfo'
          }
        },
        {
          $match: {
            'brandInfo.name': { $regex: query, $options: 'i' },
            status: 'active',
            isDeleted: false
          }
        },
        {
          $group: {
            _id: '$brandInfo.name',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 3 }
      ]);

      return [
        ...titleSuggestions.map(s => ({ text: s._id, type: 'product', count: s.count })),
        ...brandSuggestions.map(s => ({ text: s._id[0], type: 'brand', count: s.count }))
      ];
    } catch (error) {
      console.error('Error getting search suggestions:', error);
      return [];
    }
  }

  /**
   * Get related search terms
   */
  async getRelatedSearchTerms(query) {
    if (!query) return [];

    try {
      // This is a simplified version - in production, you'd use ML models
      const relatedTerms = await ProductAdvanced.aggregate([
        {
          $match: {
            $text: { $search: query },
            status: 'active',
            isDeleted: false
          }
        },
        { $unwind: '$promotion.tags' },
        {
          $group: {
            _id: '$promotion.tags',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 8 }
      ]);

      return relatedTerms.map(term => term._id);
    } catch (error) {
      console.error('Error getting related terms:', error);
      return [];
    }
  }

  /**
   * Get available filters for current search
   */
  async getAvailableFilters(baseQuery, searchQuery) {
    try {
      const filters = {};

      // Categories
      const categories = await ProductAdvanced.aggregate([
        { $match: baseQuery },
        {
          $lookup: {
            from: 'categories',
            localField: 'category',
            foreignField: '_id',
            as: 'categoryInfo'
          }
        },
        {
          $group: {
            _id: '$category',
            name: { $first: '$categoryInfo.name' },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      // Brands
      const brands = await ProductAdvanced.aggregate([
        { $match: baseQuery },
        {
          $lookup: {
            from: 'brands',
            localField: 'brand',
            foreignField: '_id',
            as: 'brandInfo'
          }
        },
        {
          $group: {
            _id: '$brand',
            name: { $first: '$brandInfo.name' },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 15 }
      ]);

      // Price ranges
      const priceRanges = await ProductAdvanced.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: null,
            minPrice: { $min: '$basePrice' },
            maxPrice: { $max: '$basePrice' },
            avgPrice: { $avg: '$basePrice' }
          }
        }
      ]);

      // Rating distribution
      const ratings = await ProductAdvanced.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: { $floor: '$reviews.averageRating' },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: -1 } }
      ]);

      return {
        categories: categories.map(c => ({
          id: c._id,
          name: c.name?.[0] || 'Unknown',
          count: c.count
        })),
        brands: brands.map(b => ({
          id: b._id,
          name: b.name?.[0] || 'Unknown',
          count: b.count
        })),
        priceRange: priceRanges[0] || { minPrice: 0, maxPrice: 10000, avgPrice: 500 },
        ratings: ratings.map(r => ({
          rating: r._id,
          count: r.count
        }))
      };
    } catch (error) {
      console.error('Error getting available filters:', error);
      return {};
    }
  }

  /**
   * Get trending searches
   */
  async getTrendingSearches(limit = 10) {
    try {
      // This would typically come from search analytics
      // For now, return popular product categories and brands
      const trending = await ProductAdvanced.aggregate([
        {
          $match: {
            status: 'active',
            isDeleted: false,
            'analytics.views': { $gt: 100 }
          }
        },
        { $unwind: '$promotion.tags' },
        {
          $group: {
            _id: '$promotion.tags',
            totalViews: { $sum: '$analytics.views' },
            productCount: { $sum: 1 }
          }
        },
        { $sort: { totalViews: -1 } },
        { $limit: limit }
      ]);

      return trending.map(item => ({
        term: item._id,
        popularity: item.totalViews,
        productCount: item.productCount
      }));
    } catch (error) {
      console.error('Error getting trending searches:', error);
      return [];
    }
  }

  /**
   * Smart search with typo tolerance and fuzzy matching
   */
  async smartSearch(query, options = {}) {
    // First try exact search
    let results = await this.searchProducts(query, options);
    
    if (results.products.length === 0 && query.length > 3) {
      // Try fuzzy search for typos
      const fuzzyQuery = this.generateFuzzyQuery(query);
      results = await this.searchProducts(fuzzyQuery, options);
      
      if (results.products.length > 0) {
        results.searchInfo.didYouMean = query;
        results.searchInfo.correctedQuery = fuzzyQuery;
      }
    }
    
    return results;
  }

  /**
   * Generate fuzzy query for typo tolerance
   */
  generateFuzzyQuery(query) {
    // Simple implementation - in production, use libraries like fuse.js or elasticsearch
    return query.split(' ').map(word => {
      if (word.length > 4) {
        return `${word}~1`; // MongoDB fuzzy search with edit distance 1
      }
      return word;
    }).join(' ');
  }

  /**
   * Get product recommendations based on user behavior
   */
  async getRecommendations(userId, type = 'general', options = {}) {
    const limit = options.limit || 20;
    
    switch (type) {
      case 'viewed':
        return this.getViewedRecommendations(userId, limit);
      
      case 'purchased':
        return this.getPurchaseRecommendations(userId, limit);
      
      case 'similar':
        return this.getSimilarProducts(options.productId, limit);
      
      case 'trending':
        return this.getTrendingProducts(limit);
      
      case 'personalized':
        return this.getPersonalizedRecommendations(userId, limit);
      
      default:
        return this.getGeneralRecommendations(limit);
    }
  }

  /**
   * Get recommendations based on viewed products
   */
  async getViewedRecommendations(userId, limit) {
    try {
      // Get user's viewed products (this would come from analytics service)
      // For now, use order history as proxy
      const userOrders = await Order.find({ user: userId })
        .populate('items.product')
        .lean();

      const viewedCategories = userOrders.flatMap(order =>
        order.items.map(item => item.product?.category)
      ).filter(Boolean);

      if (viewedCategories.length === 0) {
        return this.getGeneralRecommendations(limit);
      }

      const recommendations = await ProductAdvanced.find({
        category: { $in: viewedCategories },
        status: 'active',
        isDeleted: false
      })
      .sort({ 'analytics.views': -1, 'reviews.averageRating': -1 })
      .limit(limit)
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .lean();

      return recommendations;
    } catch (error) {
      console.error('Error getting viewed recommendations:', error);
      return [];
    }
  }

  /**
   * Get general recommendations for all users
   */
  async getGeneralRecommendations(limit) {
    try {
      const recommendations = await ProductAdvanced.find({
        status: 'active',
        isDeleted: false,
        $or: [
          { 'promotion.isFeatured': true },
          { 'promotion.isBestSeller': true },
          { 'reviews.averageRating': { $gte: 4.0 } }
        ]
      })
      .sort({ 'analytics.purchases': -1, 'reviews.averageRating': -1 })
      .limit(limit)
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .lean();

      return recommendations;
    } catch (error) {
      console.error('Error getting general recommendations:', error);
      return [];
    }
  }

  /**
   * Auto-complete search suggestions
   */
  async getAutoComplete(query, limit = 10) {
    if (!query || query.length < 2) return [];

    try {
      const suggestions = await ProductAdvanced.aggregate([
        {
          $match: {
            $or: [
              { title: { $regex: `^${query}`, $options: 'i' } },
              { 'promotion.tags': { $regex: `^${query}`, $options: 'i' } }
            ],
            status: 'active',
            isDeleted: false
          }
        },
        {
          $project: {
            suggestion: '$title',
            type: { $literal: 'product' },
            category: 1,
            image: { $arrayElemAt: ['$media.images.url', 0] }
          }
        },
        { $limit: limit }
      ]);

      return suggestions;
    } catch (error) {
      console.error('Error getting autocomplete suggestions:', error);
      return [];
    }
  }
}

module.exports = new SearchService();
