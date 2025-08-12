const Product = require('../models/Product');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/asyncHandlerHandler');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { createAuditLog } = require('../services/auditService');

// Constants
const COMPARISON_CONFIG = {
  MAX_PRODUCTS: 5,
  MIN_PRODUCTS: 2,
  CACHE_TTL: 600, // 10 minutes
  POPULAR_THRESHOLD: 50, // Minimum reviews to be considered popular
  HIGH_RATING_THRESHOLD: 4.5,
  VALUE_RATING_MULTIPLIER: 200, // Adjusts value rating calculation
  TRENDING_WINDOW: 7 // Days to consider for trending comparisons
};

/**
 * @desc    Compare multiple products with advanced analytics
 * @route   GET /api/v1/compare
 * @access  Public
 * @param   {string[]} ids - Product IDs to compare
 * @param   {string} [category] - Filter by category
 * @param   {boolean} [includeReviews=false] - Include product reviews
 * @param   {string} [sortBy=price] - Sort products by (price|rating|popularity)
 */
exports.compareProducts = asyncHandler(async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors in product comparison', { errors: errors.array() });
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { ids, category, includeReviews = 'false', sortBy = 'price' } = req.query;

    if (!ids) {
      return next(new ErrorResponse('Product IDs are required for comparison', 400));
    }

    const productIds = [...new Set(ids.split(',').filter(id => id.trim()))]; // Remove duplicates

    // Validate product count
    if (productIds.length < COMPARISON_CONFIG.MIN_PRODUCTS) {
      return next(new ErrorResponse(
        `Minimum ${COMPARISON_CONFIG.MIN_PRODUCTS} products required for comparison`, 
        400
      ));
    }

    if (productIds.length > COMPARISON_CONFIG.MAX_PRODUCTS) {
      return next(new ErrorResponse(
        `Maximum ${COMPARISON_CONFIG.MAX_PRODUCTS} products can be compared at once`, 
        400
      ));
    }

    // Check cache first
    const cacheKey = generateCacheKey(productIds, category, includeReviews);
    const cachedResult = await getCachedComparison(cacheKey);
    
    if (cachedResult) {
      logger.info('Comparison served from cache', { 
        productIds, 
        userId: req.user?.id,
        cacheKey 
      });
      return res.status(200).json(cachedResult);
    }

    // Fetch products with comprehensive data
    const products = await fetchProductsForComparison(
      productIds, 
      includeReviews === 'true'
    );

    if (products.length === 0) {
      return next(new ErrorResponse('No valid products found for comparison', 404));
    }

    if (products.length !== productIds.length) {
      logger.warn('Some products not found for comparison', {
        requested: productIds.length,
        found: products.length,
        missingIds: productIds.filter(id => !products.some(p => p._id.toString() === id))
      });
    }

    // Validate products are from same category if specified
    if (category && !validateProductCategories(products, category)) {
      return next(new ErrorResponse(
        'All products must be from the same category for meaningful comparison', 
        400
      ));
    }

    // Sort products based on query parameter
    const sortedProducts = sortProducts(products, sortBy);

    // Generate comprehensive comparison data
    const comparisonData = generateComparisonMatrix(sortedProducts);
    const insights = generateComparisonInsights(sortedProducts);
    const recommendations = generateRecommendations(sortedProducts);

    // Prepare response
    const response = {
      success: true,
      count: sortedProducts.length,
      data: {
        products: enhanceProductsForComparison(sortedProducts),
        comparison: comparisonData,
        insights,
        recommendations,
        metadata: {
          comparedAt: new Date(),
          category: category || 'mixed',
          totalProducts: sortedProducts.length,
          includeReviews: includeReviews === 'true',
          sortBy
        }
      }
    };

    // Cache the result
    await setCachedComparison(cacheKey, response, COMPARISON_CONFIG.CACHE_TTL);

    // Track comparison analytics
    await trackComparisonEvent(productIds, req.user?.id, req.ip);

    // Create audit log if user is authenticated
    if (req.user) {
      await createAuditLog(req.user.id, productIds, category);
    }

    logger.info('Product comparison generated', {
      productIds,
      category,
      userId: req.user?.id,
      productCount: sortedProducts.length
    });

    res.status(200).json(response);

  } catch (error) {
    logger.error('Product comparison error', {
      error: error.message,
      stack: error.stack,
      query: req.query,
      userId: req.user?.id
    });
    next(error);
  }
});

// ... (other controller methods remain similar but would also be enhanced)

// ==================== ENHANCED HELPER FUNCTIONS ====================

/**
 * Generate cache key for comparison results
 */
const generateCacheKey = (productIds, category, includeReviews) => {
  const sortedIds = [...productIds].sort().join(':');
  return `compare:${sortedIds}:${category || 'all'}:${includeReviews}`;
};

/**
 * Fetch products with optimized query and population
 */
const fetchProductsForComparison = async (productIds, includeReviews) => {
  const populateOptions = [
    { path: 'seller', select: 'name rating verified shopName' },
    { path: 'category', select: 'name slug' }
  ];

  if (includeReviews) {
    populateOptions.push({
      path: 'reviews',
      select: 'rating comment user createdAt',
      populate: { path: 'user', select: 'name avatar' },
      options: { limit: 5, sort: { createdAt: -1 } }
    });
  }

  return await Product.find({
    _id: { $in: productIds },
    status: 'active',
    isDeleted: false
  })
  .populate(populateOptions)
  .select('name price comparePrice images specifications features averageRating totalReviews stock brand model availability tags createdAt warranty shippingOptions')
  .lean();
};

/**
 * Validate all products belong to the same category
 */
const validateProductCategories = (products, requestedCategory) => {
  return products.every(p => 
    p.category && 
    (p.category.slug === requestedCategory || p.category.name === requestedCategory)
  );
};

/**
 * Sort products based on criteria
 */
const sortProducts = (products, sortBy) => {
  const sortFunctions = {
    price: (a, b) => a.price - b.price,
    rating: (a, b) => (b.averageRating || 0) - (a.averageRating || 0),
    popularity: (a, b) => (b.totalReviews || 0) - (a.totalReviews || 0),
    value: (a, b) => calculateValueScore(b) - calculateValueScore(a)
  };

  const sortFn = sortFunctions[sortBy] || sortFunctions.price;
  return [...products].sort(sortFn);
};

/**
 * Generate comprehensive comparison matrix with additional metrics
 */
const generateComparisonMatrix = (products) => {
  const matrix = {
    specifications: {},
    features: {},
    pricing: {},
    availability: {},
    shipping: {},
    warranty: {}
  };

  products.forEach(product => {
    // Specifications comparison
    if (product.specifications) {
      Object.entries(product.specifications).forEach(([key, value]) => {
        if (!matrix.specifications[key]) matrix.specifications[key] = {};
        matrix.specifications[key][product._id] = value;
      });
    }

    // Features comparison
    if (product.features) {
      product.features.forEach(feature => {
        if (!matrix.features[feature]) matrix.features[feature] = {};
        matrix.features[feature][product._id] = true;
      });
    }

    // Pricing comparison
    matrix.pricing[product._id] = {
      price: product.price,
      comparePrice: product.comparePrice,
      discount: product.comparePrice ? 
        Math.round(((product.comparePrice - product.price) / product.comparePrice) * 100) : 0,
      pricePerUnit: calculatePricePerUnit(product)
    };

    // Availability
    matrix.availability[product._id] = {
      inStock: product.stock > 0,
      stock: product.stock,
      availability: product.availability
    };

    // Shipping options
    matrix.shipping[product._id] = product.shippingOptions || [];

    // Warranty information
    matrix.warranty[product._id] = product.warranty || 'No warranty';
  });

  return matrix;
};

/**
 * Generate comparison insights with additional metrics
 */
const generateComparisonInsights = (products) => {
  const prices = products.map(p => p.price);
  const ratings = products.map(p => p.averageRating || 0);
  const reviews = products.map(p => p.totalReviews || 0);
  const discounts = products.map(p => 
    p.comparePrice ? Math.round(((p.comparePrice - p.price) / p.comparePrice) * 100 : 0
  );

  return {
    priceAnalysis: {
      min: Math.min(...prices),
      max: Math.max(...prices),
      average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      range: Math.max(...prices) - Math.min(...prices),
      median: calculateMedian(prices)
    },
    ratingAnalysis: {
      min: Math.min(...ratings).toFixed(1),
      max: Math.max(...ratings).toFixed(1),
      average: (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    },
    popularityAnalysis: {
      totalReviews: reviews.reduce((a, b) => a + b, 0),
      averageReviews: Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length),
      mostReviewed: Math.max(...reviews)
    },
    discountAnalysis: {
      averageDiscount: Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length),
      maxDiscount: Math.max(...discounts),
      hasDiscounts: discounts.some(d => d > 0)
    },
    bestValue: findBestValue(products),
    mostPopular: findMostPopular(products),
    pricePerformanceLeaders: {
      budget: products.reduce((prev, curr) => prev.price < curr.price ? prev : curr),
      premium: products.reduce((prev, curr) => prev.price > curr.price ? prev : curr),
      balanced: findBalancedOption(products)
    }
  };
};

/**
 * Generate smart recommendations with scoring
 */
const generateRecommendations = (products) => {
  const recommendations = [];
  const sortedByPrice = [...products].sort((a, b) => a.price - b.price);
  const cheapest = sortedByPrice[0];
  const mostExpensive = sortedByPrice[sortedByPrice.length - 1];

  // Budget recommendation
  if (cheapest.price < mostExpensive.price * 0.7) {
    const savingsPercent = Math.round(
      ((mostExpensive.price - cheapest.price) / mostExpensive.price) * 100
    );
    
    recommendations.push({
      type: 'budget_choice',
      productId: cheapest._id,
      score: calculateRecommendationScore(cheapest, 'budget'),
      reason: `Save ${savingsPercent}% compared to the most expensive option`,
      metrics: {
        price: cheapest.price,
        savings: mostExpensive.price - cheapest.price,
        rating: cheapest.averageRating || 0
      }
    });
  }

  // Premium recommendation
  if (mostExpensive.averageRating >= COMPARISON_CONFIG.HIGH_RATING_THRESHOLD) {
    recommendations.push({
      type: 'premium_choice',
      productId: mostExpensive._id,
      score: calculateRecommendationScore(mostExpensive, 'premium'),
      reason: 'Highest quality option with premium features',
      metrics: {
        price: mostExpensive.price,
        rating: mostExpensive.averageRating || 0,
        features: mostExpensive.features?.length || 0
      }
    });
  }

  // Top rated recommendation
  const topRated = products.reduce((prev, curr) => 
    (prev.averageRating || 0) > (curr.averageRating || 0) ? prev : curr
  );

  if (topRated.averageRating >= 4) {
    recommendations.push({
      type: 'top_rated',
      productId: topRated._id,
      score: calculateRecommendationScore(topRated, 'rating'),
      reason: `Highest customer satisfaction with ${topRated.averageRating}★ rating`,
      metrics: {
        rating: topRated.averageRating || 0,
        reviews: topRated.totalReviews || 0
      }
    });
  }

  // Best value recommendation
  const bestValue = findBestValue(products);
  if (bestValue) {
    recommendations.push({
      type: 'best_value',
      productId: bestValue._id,
      score: calculateRecommendationScore(bestValue, 'value'),
      reason: 'Best balance of price and quality',
      metrics: {
        valueScore: calculateValueScore(bestValue),
        price: bestValue.price,
        rating: bestValue.averageRating || 0
      }
    });
  }

  return recommendations.sort((a, b) => b.score - a.score);
};

/**
 * Calculate recommendation score based on type
 */
const calculateRecommendationScore = (product, type) => {
  const baseScore = calculateComparisonScore(product);
  
  const multipliers = {
    budget: 1.2, // Favor budget options slightly more
    premium: 0.9, // Premium options get a slight penalty
    rating: 1.1,
    value: 1.3  // Value gets the highest multiplier
  };

  return Math.round(baseScore * (multipliers[type] || 1));
};

/**
 * Find balanced option between price and quality
 */
const findBalancedOption = (products) => {
  const priceMean = products.reduce((sum, p) => sum + p.price, 0) / products.length;
  const ratingMean = products.reduce((sum, p) => sum + (p.averageRating || 0), 0) / products.length;
  
  return products.reduce((balanced, current) => {
    const balancedDiff = Math.abs(balanced.price - priceMean) + 
                         Math.abs((balanced.averageRating || 0) - ratingMean);
    const currentDiff = Math.abs(current.price - priceMean) + 
                        Math.abs((current.averageRating || 0) - ratingMean);
    return currentDiff < balancedDiff ? current : balanced;
  });
};

/**
 * Calculate price per unit for products sold in quantities
 */
const calculatePricePerUnit = (product) => {
  if (!product.specifications?.unitQuantity) return null;
  
  const quantity = parseInt(product.specifications.unitQuantity) || 1;
  return product.price / quantity;
};

/**
 * Calculate median value from array of numbers
 */
const calculateMedian = (values) => {
  if (!values.length) return 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 
    ? (sorted[middle - 1] + sorted[middle]) / 2 
    : sorted[middle];
};

/**
 * Create audit log entry
 */
const createHitLog = async (userId, productIds, category) => {
  await createAuditLog({
    action: 'products_compared',
    userId,
    entity: 'ProductComparison',
    details: { 
      productIds,
      category,
      comparedAt: new Date()
    }
  });
};

// ... (other helper functions would follow the same enhancement pattern)