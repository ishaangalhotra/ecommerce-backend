const asyncHandler = require('../middleware/asyncHandler');
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const logger = require('../utils/logger');
const { NotFoundError, ValidationError, ProductValidationError, ProductLimitExceededError } = require('../utils/error');
const { body, query, param, validationResult } = require('express-validator');
const validator = require('validator');
const redis = require('../utils/redis');
const { createAuditLog } = require('../services/auditService');

// Configuration Constants
const PRODUCT_CONFIG = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MIN_PRICE: 1,
  MAX_PRICE: 1000000,
  CACHE_TTL: 300, // 5 minutes
  SEARCH_MIN_LENGTH: 2,
  MAX_SEARCH_LENGTH: 100,
  MAX_PRODUCTS_PER_SELLER: 100,
  MAX_IMAGES_PER_PRODUCT: 10,
  MAX_TAGS_PER_PRODUCT: 10
};

// Enhanced validation middleware
exports.validateProduct = [
  body('name')
    .notEmpty()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Name must be 3-100 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be under 2000 characters'),
  
  body('price')
    .isFloat({ min: PRODUCT_CONFIG.MIN_PRICE, max: PRODUCT_CONFIG.MAX_PRICE })
    .custom((value) => {
      const decimalCount = (value.toString().split('.')[1] || []).length;
      return decimalCount <= 2;
    })
    .withMessage(`Price must be between ₹${PRODUCT_CONFIG.MIN_PRICE} and ₹${PRODUCT_CONFIG.MAX_PRICE} with max 2 decimal places`),
  
  body('category')
    .isMongoId()
    .withMessage('Valid category ID required'),
  
  body('stock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Stock must be a non-negative integer'),
  
  body('tags')
    .optional()
    .isArray({ max: PRODUCT_CONFIG.MAX_TAGS_PER_PRODUCT })
    .withMessage(`Maximum ${PRODUCT_CONFIG.MAX_TAGS_PER_PRODUCT} tags allowed`),
  
  body('images')
    .optional()
    .isArray({ max: PRODUCT_CONFIG.MAX_IMAGES_PER_PRODUCT })
    .withMessage(`Maximum ${PRODUCT_CONFIG.MAX_IMAGES_PER_PRODUCT} images allowed`)
    .custom((images) => {
      return images.every(img => validator.isURL(img, { protocols: ['http', 'https'] }));
    })
    .withMessage('Invalid image URL(s)'),
  
  body('specifications')
    .optional()
    .isObject()
    .withMessage('Specifications must be an object'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Product validation failed', { errors: errors.array() });
      throw new ProductValidationError(errors.array());
    }
    next();
  }
];

// Query validation for product listing
const validateProductQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: PRODUCT_CONFIG.MAX_PAGE_SIZE })
    .withMessage(`Limit must be between 1 and ${PRODUCT_CONFIG.MAX_PAGE_SIZE}`),
  
  query('search')
    .optional()
    .trim()
    .isLength({ min: PRODUCT_CONFIG.SEARCH_MIN_LENGTH, max: PRODUCT_CONFIG.MAX_SEARCH_LENGTH })
    .withMessage(`Search must be ${PRODUCT_CONFIG.SEARCH_MIN_LENGTH}-${PRODUCT_CONFIG.MAX_SEARCH_LENGTH} characters`),
  
  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be positive'),
  
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be positive'),
  
  query('sortBy')
    .optional()
    .isIn(['name', 'price', 'createdAt', 'averageRating', 'popularity'])
    .withMessage('Invalid sort field'),
  
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc'),
  
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
  
  query('nearby')
    .optional()
    .matches(/^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+(,\d+)?$/)
    .withMessage('Invalid nearby format. Use lat,lng,radius')
];

/**
 * @desc    Get all products with advanced filtering and search
 * @route   GET /api/products
 * @access  Public
 */
exports.getProducts = [
  validateProductQuery,
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ProductValidationError(errors.array()));
    }

    try {
      const {
        page = 1,
        limit = PRODUCT_CONFIG.DEFAULT_PAGE_SIZE,
        search,
        category,
        minPrice,
        maxPrice,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        inStock,
        startDate,
        endDate,
        nearby
      } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;

      // Build search query
      const query = buildProductQuery({ 
        search, 
        category, 
        minPrice, 
        maxPrice, 
        inStock,
        startDate,
        endDate,
        nearby
      });

      // Check cache with stampede protection
      const cacheKey = `products:${JSON.stringify(req.query)}`;
      const cachedResult = await getCachedDataWithStampedeProtection(cacheKey);
      
      if (cachedResult) {
        logger.info('Products served from cache', { query: req.query });
        return res.status(200).json(cachedResult);
      }

      // Build sort criteria
      const sort = buildSortCriteria(sortBy, sortOrder);

      // Execute queries in parallel
      const [products, total, categories] = await Promise.all([
        Product.find(query)
          .populate('category', 'name slug')
          .populate('seller', 'name rating verified')
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .select(getProductProjection('list'))
          .lean(),
        
        Product.countDocuments(query),
        
        // Get available categories for filtering
        Category.find({ isActive: true }).select('name slug').lean()
      ]);

      // Calculate pagination metadata
      const totalPages = Math.ceil(total / limitNum);
      
      const response = {
        success: true,
        count: products.length,
        total,
        pages: totalPages,
        currentPage: pageNum,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
        data: products,
        filters: {
          categories,
          priceRange: await getPriceRange(),
          appliedFilters: { 
            search, 
            category, 
            minPrice, 
            maxPrice, 
            inStock,
            startDate,
            endDate,
            nearby
          }
        }
      };

      // Cache the result
      await setCachedData(cacheKey, response, PRODUCT_CONFIG.CACHE_TTL);

      logger.info('Products fetched successfully', {
        count: products.length,
        page: pageNum,
        total,
        query: req.query
      });

      res.status(200).json(response);

    } catch (error) {
      logger.error('Failed to fetch products', {
        error: error.message,
        query: req.query,
        stack: error.stack
      });
      next(error);
    }
  })
];

/**
 * @desc    Get single product with detailed information
 * @route   GET /api/products/:id
 * @access  Public
 */
exports.getProduct = [
  param('id').isMongoId().withMessage('Invalid product ID'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ProductValidationError(errors.array()));
    }

    try {
      const productId = req.params.id;
      const userId = req.user?.id || null;

      // Check cache first with stampede protection
      const cacheKey = `product:${productId}`;
      const cachedProduct = await getCachedDataWithStampedeProtection(cacheKey);
      
      if (cachedProduct) {
        return res.status(200).json(cachedProduct);
      }

      const product = await Product.findById(productId)
        .populate('category', 'name slug description')
        .populate('seller', 'name rating verified shopName location')
        .populate({
          path: 'reviews',
          populate: { path: 'user', select: 'name avatar' },
          options: { limit: 5, sort: { createdAt: -1 } }
        })
        .lean();

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      // Get related products
      const relatedProducts = await Product.find({
        category: product.category._id,
        _id: { $ne: productId },
        isActive: true
      })
      .limit(6)
      .select(getProductProjection('related'))
      .lean();

      // Increment view count (async, don't wait)
      Product.findByIdAndUpdate(productId, { $inc: { views: 1 } }).exec();

      // Track view history for authenticated users
      if (userId) {
        User.findByIdAndUpdate(userId, {
          $push: {
            recentlyViewed: {
              $each: [productId],
              $slice: -10, // Keep only last 10 viewed items
              $position: 0
            }
          }
        }).exec();
      }

      const enhancedProduct = enhanceProductResponse(product, userId);
      const response = {
        success: true,
        data: {
          ...enhancedProduct,
          relatedProducts,
          deliveryInfo: await calculateDeliveryInfo(product),
          availability: getAvailabilityInfo(product)
        }
      };

      // Cache the result
      await setCachedData(cacheKey, response, PRODUCT_CONFIG.CACHE_TTL);

      logger.info('Product details fetched', { 
        productId,
        viewedBy: userId || 'guest'
      });

      res.status(200).json(response);

    } catch (error) {
      logger.error('Failed to fetch product', {
        productId: req.params.id,
        error: error.message,
        stack: error.stack
      });
      next(error);
    }
  })
];

/**
 * @desc    Create new product
 * @route   POST /api/products
 * @access  Private/Admin/Seller
 */
exports.createProduct = [
  exports.validateProduct,
  asyncHandler(async (req, res, next) => {
    try {
      // Check product limit for seller
      if (req.user.role === 'seller') {
        const productCount = await Product.countDocuments({ seller: req.user.id });
        if (productCount >= PRODUCT_CONFIG.MAX_PRODUCTS_PER_SELLER) {
          throw new ProductLimitExceededError();
        }
      }

      // Validate category exists
      const category = await Category.findById(req.body.category);
      if (!category) {
        throw new ValidationError('Category not found');
      }

      // Create product with additional metadata
      const productData = {
        ...req.body,
        seller: req.user.id,
        slug: generateSlug(req.body.name),
        isActive: true,
        createdBy: req.user.id,
        comparePrice: req.body.comparePrice || req.body.price * 1.2 // Default 20% markup
      };

      const product = await Product.create(productData);

      // Create audit log
      await createAuditLog({
        action: 'product_created',
        userId: req.user.id,
        targetId: product._id,
        details: {
          name: product.name,
          price: product.price,
          category: category.name
        }
      });

      // Clear relevant caches
      await clearProductCaches();

      logger.info('Product created successfully', {
        productId: product._id,
        name: product.name,
        createdBy: req.user.id
      });

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: {
          id: product._id,
          name: product.name,
          price: product.price,
          slug: product.slug,
          category: category.name
        }
      });

    } catch (error) {
      logger.error('Failed to create product', {
        error: error.message,
        body: req.body,
        userId: req.user?.id,
        stack: error.stack
      });
      next(error);
    }
  })
];

/**
 * @desc    Update product
 * @route   PUT /api/products/:id
 * @access  Private/Admin/Seller
 */
exports.updateProduct = [
  param('id').isMongoId().withMessage('Invalid product ID'),
  exports.validateProduct,
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ProductValidationError(errors.array()));
    }

    try {
      const productId = req.params.id;
      const updates = req.body;

      // Find existing product
      const existingProduct = await Product.findById(productId);
      if (!existingProduct) {
        throw new NotFoundError('Product not found');
      }

      // Check permissions (seller can only update their own products)
      if (req.user.role === 'seller' && existingProduct.seller.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this product'
        });
      }

      // Update slug if name changed
      if (updates.name && updates.name !== existingProduct.name) {
        updates.slug = generateSlug(updates.name);
      }

      // Track changes for audit log
      const changes = {};
      Object.keys(updates).forEach(key => {
        if (JSON.stringify(existingProduct[key]) !== JSON.stringify(updates[key])) {
          changes[key] = {
            from: existingProduct[key],
            to: updates[key]
          };
        }
      });

      // Update product
      const product = await Product.findByIdAndUpdate(
        productId,
        {
          ...updates,
          updatedAt: new Date(),
          updatedBy: req.user.id
        },
        {
          new: true,
          runValidators: true
        }
      ).populate('category', 'name');

      // Create audit log
      await createAuditLog({
        action: 'product_updated',
        userId: req.user.id,
        targetId: product._id,
        details: {
          changes,
          previousPrice: existingProduct.price,
          newPrice: product.price
        }
      });

      // Clear caches
      await Promise.all([
        clearProductCaches(),
        redis?.del(`product:${productId}`),
        redis?.del(`product:${existingProduct.slug}`)
      ]);

      logger.info('Product updated successfully', {
        productId,
        updatedBy: req.user.id,
        changes: Object.keys(changes)
      });

      res.status(200).json({
        success: true,
        message: 'Product updated successfully',
        data: product
      });

    } catch (error) {
      logger.error('Failed to update product', {
        productId: req.params.id,
        error: error.message,
        userId: req.user?.id,
        stack: error.stack
      });
      next(error);
    }
  })
];

/**
 * @desc    Delete product
 * @route   DELETE /api/products/:id
 * @access  Private/Admin/Seller
 */
exports.deleteProduct = [
  param('id').isMongoId().withMessage('Invalid product ID'),
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ProductValidationError(errors.array()));
    }

    try {
      const productId = req.params.id;
      const product = await Product.findById(productId);

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      // Check permissions
      if (req.user.role === 'seller' && product.seller.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this product'
        });
      }

      // Soft delete instead of hard delete
      product.isDeleted = true;
      product.deletedAt = new Date();
      product.deletedBy = req.user.id;
      await product.save();

      // Create audit log
      await createAuditLog({
        action: 'product_deleted',
        userId: req.user.id,
        targetId: product._id,
        details: {
          name: product.name,
          price: product.price
        }
      });

      // Clear caches
      await Promise.all([
        clearProductCaches(),
        redis?.del(`product:${productId}`),
        redis?.del(`product:${product.slug}`)
      ]);

      logger.info('Product deleted successfully', {
        productId,
        deletedBy: req.user.id,
        productName: product.name
      });

      res.status(200).json({
        success: true,
        message: 'Product deleted successfully'
      });

    } catch (error) {
      logger.error('Failed to delete product', {
        productId: req.params.id,
        error: error.message,
        userId: req.user?.id,
        stack: error.stack
      });
      next(error);
    }
  })
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Build MongoDB query based on filters
 */
const buildProductQuery = (filters) => {
  const query = { 
    isActive: true,
    isDeleted: { $ne: true }
  };

  // Enhanced search with stemming and synonyms
  if (filters.search) {
    const searchTerms = filters.search.split(' ');
    const searchRegexes = searchTerms.map(term => new RegExp(term, 'i'));
    
    query.$or = [
      { name: { $in: searchRegexes } },
      { description: { $in: searchRegexes } },
      { tags: { $in: searchRegexes } },
      { 'specifications.value': { $in: searchRegexes } }
    ];
  }

  // Category filter
  if (filters.category) {
    query.category = filters.category;
  }

  // Price range filter
  if (filters.minPrice || filters.maxPrice) {
    query.price = {};
    if (filters.minPrice) query.price.$gte = parseFloat(filters.minPrice);
    if (filters.maxPrice) query.price.$lte = parseFloat(filters.maxPrice);
  }

  // Stock availability filter
  if (filters.inStock === 'true') {
    query.stock = { $gt: 0 };
  }

  // Date range filtering
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
  }

  // Geospatial filtering for local products
  if (filters.nearby) {
    const [lat, lng, radius] = filters.nearby.split(',');
    query['seller.location'] = {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [parseFloat(lng), parseFloat(lat)]
        },
        $maxDistance: parseInt(radius) || 10000 // Default 10km radius
      }
    };
  }

  return query;
};

/**
 * Build sort criteria
 */
const buildSortCriteria = (sortBy, sortOrder) => {
  const direction = sortOrder === 'desc' ? -1 : 1;
  
  const sortOptions = {
    name: { name: direction },
    price: { price: direction },
    createdAt: { createdAt: direction },
    averageRating: { averageRating: direction },
    popularity: { totalReviews: direction, averageRating: -1 }
  };

  return sortOptions[sortBy] || { createdAt: -1 };
};

/**
 * Generate URL-friendly slug
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * Get price range for filters
 */
const getPriceRange = async () => {
  const result = await Product.aggregate([
    { $match: { isActive: true, isDeleted: { $ne: true } } },
    {
      $group: {
        _id: null,
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' }
      }
    }
  ]);

  return result[0] || { minPrice: 0, maxPrice: 1000 };
};

/**
 * Calculate delivery information
 */
const calculateDeliveryInfo = async (product) => {
  // This would integrate with your delivery service
  return {
    available: true,
    estimatedTime: '20-30 minutes',
    fee: product.price > 500 ? 0 : 25,
    freeDeliveryThreshold: 500,
    expressDeliveryAvailable: true,
    expressDeliveryFee: 50,
    estimatedExpressDeliveryTime: '10-15 minutes'
  };
};

/**
 * Get availability information
 */
const getAvailabilityInfo = (product) => {
  return {
    inStock: product.stock > 0,
    stockLevel: product.stock,
    lowStock: product.stock <= 10,
    availability: product.stock > 0 ? 'In Stock' : 'Out of Stock',
    expectedRestock: product.stock <= 10 ? '3-5 business days' : null
  };
};

/**
 * Implement field-level projection for better performance
 */
const getProductProjection = (type = 'list') => {
  const baseProjection = {
    name: 1,
    price: 1,
    images: { $slice: 1 }, // Only first image for listings
    averageRating: 1,
    totalReviews: 1,
    stock: 1,
    availability: 1,
    createdAt: 1
  };

  const projections = {
    list: baseProjection,
    detail: {
      ...baseProjection,
      description: 1,
      specifications: 1,
      reviews: 1,
      seller: 1,
      category: 1,
      tags: 1,
      views: 1,
      slug: 1
    },
    related: {
      name: 1,
      price: 1,
      images: { $slice: 1 },
      averageRating: 1,
      slug: 1
    }
  };

  return projections[type] || baseProjection;
};

/**
 * Enhance product response with additional metadata
 */
const enhanceProductResponse = async (product, userId = null) => {
  const isFavorite = userId ? await checkIfFavorite(userId, product._id) : false;
  const viewedRecently = userId ? await checkRecentlyViewed(userId, product._id) : false;
  const purchaseHistory = userId ? await getPurchaseHistory(userId, product._id) : null;

  return {
    ...product,
    metadata: {
      isFavorite,
      viewedRecently,
      purchaseHistory,
      hasPurchased: purchaseHistory ? purchaseHistory.count > 0 : false
    },
    seo: {
      title: `${product.name} | Buy Online at Best Price`,
      description: product.description.substring(0, 160),
      keywords: [...product.tags, product.category.name].join(', ')
    },
    socialSharing: {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`https://example.com/products/${product.slug}`)}`,
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out ${product.name} on our store!`)}&url=${encodeURIComponent(`https://example.com/products/${product.slug}`)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${product.name} - https://example.com/products/${product.slug}`)}`
    }
  };
};

/**
 * Check if product is in user's favorites
 */
const checkIfFavorite = async (userId, productId) => {
  try {
    const user = await User.findById(userId).select('favorites').lean();
    return user?.favorites?.includes(productId) || false;
  } catch (error) {
    logger.warn('Failed to check favorites', { userId, productId });
    return false;
  }
};

/**
 * Check if product is in user's recently viewed
 */
const checkRecentlyViewed = async (userId, productId) => {
  try {
    const user = await User.findById(userId).select('recentlyViewed').lean();
    return user?.recentlyViewed?.includes(productId) || false;
  } catch (error) {
    logger.warn('Failed to check recently viewed', { userId, productId });
    return false;
  }
};

/**
 * Get user's purchase history for this product
 */
const getPurchaseHistory = async (userId, productId) => {
  try {
    // This would query your orders collection
    const count = await Order.countDocuments({
      user: userId,
      'items.product': productId,
      status: 'completed'
    });
    
    return { count };
  } catch (error) {
    logger.warn('Failed to get purchase history', { userId, productId });
    return null;
  }
};

/**
 * Cache management functions with stampede protection
 */
const getCachedDataWithStampedeProtection = async (key) => {
  if (!redis) return null;
  
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
    
    // Set a temporary lock to prevent cache stampede
    const lockKey = `${key}:lock`;
    const lockSet = await redis.set(lockKey, '1', 'EX', 5, 'NX');
    
    if (lockSet) {
      return null; // Current request will generate new data
    }
    
    // Wait for other request to populate cache
    await new Promise(resolve => setTimeout(resolve, 100));
    return getCachedDataWithStampedeProtection(key);
  } catch (error) {
    logger.warn('Cache get failed', { key, error: error.message });
    return null;
  }
};

const setCachedData = async (key, data, ttl) => {
  if (!redis) return;
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
    // Clear the lock if it exists
    await redis.del(`${key}:lock`);
  } catch (error) {
    logger.warn('Cache set failed', { key, error: error.message });
  }
};

const clearProductCaches = async () => {
  if (!redis) return;
  try {
    const keys = await redis.keys('products:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (error) {
    logger.warn('Cache clear failed', { error: error.message });
  }
};

module.exports = exports;