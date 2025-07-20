const Product = require('../models/Product');
const Order = require('../models/Order');
const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const { deleteImage, uploadImage } = require('../utils/cloudinary');
const { validationResult } = require('express-validator');
const { createAuditLog } = require('../services/auditService');
const redis = require('../utils/redis');
const mongoose = require('mongoose');

// Configuration Constants
const SELLER_CONFIG = {
  MAX_PRODUCTS: 1000,
  MAX_IMAGES: 10,
  MIN_PRICE: 1,
  MAX_PRICE: 1000000,
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  CACHE_TTL: 300, // 5 minutes
  LOW_STOCK_THRESHOLD: 10,
  SKU_PREFIX_LENGTH: 4,
  SKU_RANDOM_LENGTH: 4
};

// Error Messages
const ERROR_MESSAGES = {
  VALIDATION_FAILED: 'Validation failed',
  PRODUCT_LIMIT: `Maximum ${SELLER_CONFIG.MAX_PRODUCTS} products allowed per seller`,
  IMAGE_LIMIT: `Maximum ${SELLER_CONFIG.MAX_IMAGES} images allowed per product`,
  PRICE_RANGE: `Price must be between ₹${SELLER_CONFIG.MIN_PRICE} and ₹${SELLER_CONFIG.MAX_PRICE}`,
  ACTIVE_ORDERS: 'Cannot delete product with active orders',
  NOT_FOUND: 'Product not found or unauthorized',
  SERVER_ERROR: 'An unexpected error occurred'
};

/**
 * @desc    Validate seller owns product
 * @param   {string} productId - Product ID to validate
 * @param   {string} sellerId - Seller ID to verify ownership
 * @returns {Promise<Product>} - The validated product
 * @throws  {Error} - If product not found or unauthorized
 */
const validateProductOwnership = async (productId, sellerId) => {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new Error(ERROR_MESSAGES.NOT_FOUND);
  }

  const product = await Product.findOne({ 
    _id: productId, 
    seller: sellerId,
    isDeleted: false 
  }).lean();
  
  if (!product) {
    throw new Error(ERROR_MESSAGES.NOT_FOUND);
  }
  
  return product;
};

/**
 * @desc    Upload new product with comprehensive validation
 * @route   POST /api/seller/products
 * @access  Private/Seller
 */
exports.uploadProduct = asyncHandler(async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Product upload validation failed', { 
        errors: errors.array(),
        sellerId: req.user.id 
      });
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.VALIDATION_FAILED,
        errors: errors.array()
      });
    }

    // Destructure and validate request body
    const { 
      name,
      description,
      price,
      comparePrice,
      category,
      stock,
      sku,
      tags,
      specifications,
      isPublished = false,
      features
    } = req.body;

    // Check seller product limit
    const productCount = await Product.countDocuments({ 
      seller: req.user.id,
      isDeleted: false 
    });
    
    if (productCount >= SELLER_CONFIG.MAX_PRODUCTS) {
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.PRODUCT_LIMIT
      });
    }

    // Validate price range
    const parsedPrice = parseFloat(price);
    if (parsedPrice < SELLER_CONFIG.MIN_PRICE || parsedPrice > SELLER_CONFIG.MAX_PRICE) {
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.PRICE_RANGE
      });
    }

    // Process product images
    const imageUrls = await processProductImages(
      req.files, 
      req.user.id, 
      sku || await generateUniqueSKU(req.user.id)
    );

    // Create product document
    const productData = {
      seller: req.user.id,
      name: name.trim(),
      description: description?.trim(),
      price: parsedPrice,
      comparePrice: comparePrice ? parseFloat(comparePrice) : null,
      category: category.trim(),
      stock: parseInt(stock) || 0,
      sku: sku || await generateUniqueSKU(req.user.id),
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      specifications: specifications ? safeJsonParse(specifications) : {},
      features: features ? features.split(',').map(f => f.trim()) : [],
      images: imageUrls,
      status: isPublished ? 'pending' : 'draft',
      isPublished: Boolean(isPublished)
    };

    const product = await Product.create(productData);

    // Post-creation operations
    await Promise.all([
      createAuditLog({
        action: 'product_created',
        userId: req.user.id,
        targetId: product._id,
        details: { 
          name: product.name,
          price: product.price,
          category: product.category 
        }
      }),
      clearSellerCache(req.user.id)
    ]);

    logger.info('Product created successfully', {
      productId: product._id,
      sellerId: req.user.id
    });

    // Format response
    res.status(201).json({
      success: true,
      data: formatProductResponse(product)
    });

  } catch (error) {
    logger.error('Product creation failed', {
      error: error.message,
      stack: error.stack,
      sellerId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR
    });
  }
});

/**
 * @desc    Get seller's products with advanced filtering and pagination
 * @route   GET /api/seller/products
 * @access  Private/Seller
 */
exports.getMyProducts = asyncHandler(async (req, res) => {
  try {
    // Parse and validate query parameters
    const { 
      page = 1, 
      limit = SELLER_CONFIG.PAGE_SIZE,
      status,
      category,
      search,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(SELLER_CONFIG.MAX_PAGE_SIZE, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build query with filters
    const query = buildProductQuery(req.user.id, {
      status,
      category,
      search,
      minPrice,
      maxPrice
    });

    // Check cache
    const cacheKey = `seller:${req.user.id}:products:${JSON.stringify(req.query)}`;
    const cachedResult = await getCachedData(cacheKey);
    
    if (cachedResult) {
      return res.status(200).json(cachedResult);
    }

    // Execute parallel queries
    const [products, total, analytics] = await Promise.all([
      Product.find(query)
        .sort(buildSortCriteria(sortBy, sortOrder))
        .skip(skip)
        .limit(limitNum)
        .populate('category', 'name slug')
        .lean(),
      
      Product.countDocuments(query),
      
      getProductAnalytics(req.user.id)
    ]);

    // Format response
    const response = {
      success: true,
      count: products.length,
      total,
      pages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: products.map(formatProductResponse),
      analytics: analytics[0] || {},
      filters: req.query
    };

    // Cache response
    await setCachedData(cacheKey, response, SELLER_CONFIG.CACHE_TTL);

    res.status(200).json(response);

  } catch (error) {
    logger.error('Failed to get seller products', {
      error: error.message,
      sellerId: req.user.id
    });
    
    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR
    });
  }
});

/**
 * @desc    Update product with comprehensive validation
 * @route   PUT /api/seller/products/:id
 * @access  Private/Seller
 */
exports.updateProduct = asyncHandler(async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.VALIDATION_FAILED,
        errors: errors.array()
      });
    }

    // Get and validate product
    const product = await Product.findById(req.params.id);
    if (!product || product.seller.toString() !== req.user.id || product.isDeleted) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.NOT_FOUND
      });
    }

    const previousData = { ...product.toObject() };
    const updates = req.body;

    // Apply validated updates
    applyProductUpdates(product, updates, req.files);

    // Save updated product
    const updatedProduct = await product.save();

    // Post-update operations
    await Promise.all([
      createAuditLog({
        action: 'product_updated',
        userId: req.user.id,
        targetId: product._id,
        details: {
          changes: Object.keys(updates),
          previousPrice: previousData.price,
          newPrice: product.price
        }
      }),
      clearSellerCache(req.user.id)
    ]);

    logger.info('Product updated successfully', {
      productId: product._id,
      sellerId: req.user.id
    });

    res.status(200).json({
      success: true,
      data: formatProductResponse(updatedProduct)
    });

  } catch (error) {
    logger.error('Product update failed', {
      productId: req.params.id,
      sellerId: req.user.id,
      error: error.message
    });

    const statusCode = error.message === ERROR_MESSAGES.NOT_FOUND ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || ERROR_MESSAGES.SERVER_ERROR
    });
  }
});

/**
 * @desc    Delete product with comprehensive checks
 * @route   DELETE /api/seller/products/:id
 * @access  Private/Seller
 */
exports.deleteProduct = asyncHandler(async (req, res) => {
  try {
    // Get and validate product
    const product = await validateProductOwnership(req.params.id, req.user.id);

    // Check for active orders
    const activeOrders = await Order.countDocuments({
      'items.product': product._id,
      status: { $in: ['pending', 'confirmed', 'processing'] }
    });

    if (activeOrders > 0) {
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.ACTIVE_ORDERS
      });
    }

    // Soft delete with cleanup
    await performProductDeletion(product, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    logger.error('Product deletion failed', {
      productId: req.params.id,
      sellerId: req.user.id,
      error: error.message
    });

    const statusCode = error.message === ERROR_MESSAGES.NOT_FOUND ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || ERROR_MESSAGES.SERVER_ERROR
    });
  }
});

/**
 * @desc    Get comprehensive seller dashboard analytics
 * @route   GET /api/seller/dashboard
 * @access  Private/Seller
 */
exports.getSellerDashboard = asyncHandler(async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    const dateRange = calculateDateRange(timeRange);

    // Execute parallel analytics queries
    const [productStats, orderStats, revenueStats, recentOrders] = await Promise.all([
      getProductStatistics(req.user.id),
      getOrderStatistics(req.user.id, dateRange),
      getRevenueTrends(req.user.id, dateRange),
      getRecentOrders(req.user.id)
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: productStats[0] || {},
        orders: orderStats,
        revenue: {
          trends: revenueStats,
          total: revenueStats.reduce((sum, day) => sum + day.revenue, 0)
        },
        recentOrders,
        timeRange
      }
    });

  } catch (error) {
    logger.error('Failed to get dashboard data', {
      error: error.message,
      sellerId: req.user.id
    });

    res.status(500).json({
      success: false,
      message: ERROR_MESSAGES.SERVER_ERROR
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Process and upload product images
 */
const processProductImages = async (files, sellerId, sku) => {
  if (!files || files.length === 0) return [];

  if (files.length > SELLER_CONFIG.MAX_IMAGES) {
    throw new Error(ERROR_MESSAGES.IMAGE_LIMIT);
  }

  return Promise.all(
    files.map(async (file, index) => {
      const result = await uploadImage(file.buffer, {
        folder: `products/${sellerId}`,
        public_id: `${sku}_${index}`,
        transformation: [
          { width: 800, height: 800, crop: 'limit' },
          { quality: 'auto:good' }
        ]
      });
      return {
        url: result.secure_url,
        publicId: result.public_id,
        isPrimary: index === 0
      };
    })
  );
};

/**
 * Generate unique SKU for product
 */
const generateUniqueSKU = async (sellerId) => {
  const prefix = `SK${sellerId.slice(-SELLER_CONFIG.SKU_PREFIX_LENGTH).toUpperCase()}`;
  let sku;
  let attempts = 0;
  
  while (attempts < 10) {
    const randomNum = Math.floor(Math.random() * Math.pow(10, SELLER_CONFIG.SKU_RANDOM_LENGTH))
      .toString()
      .padStart(SELLER_CONFIG.SKU_RANDOM_LENGTH, '0');
    sku = `${prefix}${randomNum}`;
    
    const existing = await Product.findOne({ sku });
    if (!existing) return sku;
    
    attempts++;
  }
  
  throw new Error('Failed to generate unique SKU');
};

/**
 * Build product query based on filters
 */
const buildProductQuery = (sellerId, filters) => {
  const query = { 
    seller: sellerId,
    isDeleted: false 
  };

  if (filters.status) query.status = filters.status;
  if (filters.category) query.category = filters.category;
  
  if (filters.search) {
    query.$or = [
      { name: { $regex: filters.search, $options: 'i' } },
      { description: { $regex: filters.search, $options: 'i' } },
      { sku: { $regex: filters.search, $options: 'i' } }
    ];
  }

  if (filters.minPrice || filters.maxPrice) {
    query.price = {};
    if (filters.minPrice) query.price.$gte = parseFloat(filters.minPrice);
    if (filters.maxPrice) query.price.$lte = parseFloat(filters.maxPrice);
  }

  return query;
};

/**
 * Build sort criteria
 */
const buildSortCriteria = (sortBy, sortOrder) => {
  const direction = sortOrder === 'desc' ? -1 : 1;
  
  const sortFields = {
    price: { price: direction },
    rating: { averageRating: direction },
    popularity: { totalReviews: direction },
    stock: { stock: direction },
    createdAt: { createdAt: direction },
    updatedAt: { updatedAt: direction }
  };

  return sortFields[sortBy] || { createdAt: -1 };
};

/**
 * Get product analytics for seller
 */
const getProductAnalytics = (sellerId) => {
  return Product.aggregate([
    { $match: { seller: sellerId, isDeleted: false } },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        activeProducts: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        draftProducts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
        totalStock: { $sum: '$stock' },
        lowStockProducts: { 
          $sum: { 
            $cond: [{ $lte: ['$stock', SELLER_CONFIG.LOW_STOCK_THRESHOLD] }, 1, 0] 
          } 
        },
        averagePrice: { $avg: '$price' },
        totalValue: { $sum: { $multiply: ['$price', '$stock'] } }
      }
    }
  ]);
};

/**
 * Apply validated updates to product
 */
const applyProductUpdates = async (product, updates, files) => {
  if (updates.name) product.name = updates.name.trim();
  if (updates.description) product.description = updates.description.trim();
  
  if (updates.price) {
    const newPrice = parseFloat(updates.price);
    if (newPrice < SELLER_CONFIG.MIN_PRICE || newPrice > SELLER_CONFIG.MAX_PRICE) {
      throw new Error(ERROR_MESSAGES.PRICE_RANGE);
    }
    product.price = newPrice;
  }
  
  if (updates.comparePrice) product.comparePrice = parseFloat(updates.comparePrice);
  if (updates.category) product.category = updates.category.trim();
  if (updates.stock !== undefined) product.stock = Math.max(0, parseInt(updates.stock));
  if (updates.tags) product.tags = updates.tags.split(',').map(tag => tag.trim());
  if (updates.specifications) product.specifications = safeJsonParse(updates.specifications);
  if (updates.features) product.features = updates.features.split(',').map(f => f.trim());

  // Handle image updates
  if (files && files.length > 0) {
    // Delete old images
    if (product.images?.length > 0) {
      await Promise.all(
        product.images.map(img => deleteImage(img.publicId))
      );
    }

    // Upload new images
    product.images = await processProductImages(
      files, 
      product.seller, 
      product.sku
    );
  }

  product.updatedAt = new Date();
};

/**
 * Perform product deletion with cleanup
 */
const performProductDeletion = async (product, sellerId) => {
  // Soft delete
  product.isDeleted = true;
  product.deletedAt = new Date();
  await product.save();

  // Delete images from storage
  if (product.images?.length > 0) {
    await Promise.all(
      product.images.map(img => deleteImage(img.publicId))
    );
  }

  // Post-deletion operations
  await Promise.all([
    createAuditLog({
      action: 'product_deleted',
      userId: sellerId,
      targetId: product._id,
      details: { name: product.name }
    }),
    clearSellerCache(sellerId)
  ]);

  logger.info('Product deleted successfully', {
    productId: product._id,
    sellerId
  });
};

/**
 * Format product for response
 */
const formatProductResponse = (product) => {
  return {
    id: product._id,
    name: product.name,
    price: product.price,
    comparePrice: product.comparePrice,
    category: product.category,
    stock: product.stock,
    sku: product.sku,
    status: product.status,
    images: product.images?.map(img => img.url) || [],
    rating: product.averageRating,
    reviews: product.totalReviews,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
};

/**
 * Get product statistics for dashboard
 */
const getProductStatistics = (sellerId) => {
  return Product.aggregate([
    { $match: { seller: sellerId, isDeleted: false } },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        activeProducts: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        draftProducts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
        totalStock: { $sum: '$stock' },
        lowStockProducts: { 
          $sum: { 
            $cond: [{ $lte: ['$stock', SELLER_CONFIG.LOW_STOCK_THRESHOLD] }, 1, 0] 
          } 
        },
        averagePrice: { $avg: '$price' },
        totalViews: { $sum: '$views' },
        averageRating: { $avg: '$averageRating' }
      }
    }
  ]);
};

/**
 * Get order statistics for dashboard
 */
const getOrderStatistics = (sellerId, dateRange) => {
  return Order.aggregate([
    { 
      $match: { 
        'items.seller': sellerId,
        createdAt: { $gte: dateRange.startDate }
      } 
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        revenue: { $sum: '$pricing.total' }
      }
    }
  ]);
};

/**
 * Get revenue trends for dashboard
 */
const getRevenueTrends = (sellerId, dateRange) => {
  return Order.aggregate([
    { 
      $match: { 
        'items.seller': sellerId,
        createdAt: { $gte: dateRange.startDate }
      } 
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        revenue: { $sum: '$pricing.total' },
        orders: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

/**
 * Get recent orders for dashboard
 */
const getRecentOrders = (sellerId) => {
  return Order.find({ 'items.seller': sellerId })
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('customer', 'name email')
    .select('orderNumber status pricing.total createdAt');
};

/**
 * Calculate date range based on time period
 */
const calculateDateRange = (timeRange) => {
  const now = new Date();
  const startDate = new Date(now);
  
  switch (timeRange) {
    case '24h':
      startDate.setHours(now.getHours() - 24);
      break;
    case '7d':
      startDate.setDate(now.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(now.getDate() - 30);
      break;
    case '90d':
      startDate.setDate(now.getDate() - 90);
      break;
    case 'ytd':
      startDate.setMonth(0, 1);
      break;
    default:
      startDate.setDate(now.getDate() - 30);
  }

  return { startDate, endDate: now };
};

/**
 * Safely parse JSON with error handling
 */
const safeJsonParse = (str) => {
  try {
    return JSON.parse(str);
  } catch (error) {
    logger.warn('Failed to parse JSON', { error: error.message });
    return {};
  }
};

/**
 * Get cached data from Redis
 */
const getCachedData = async (key) => {
  if (!redis) return null;
  
  try {
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.warn('Cache get failed', { error: error.message });
    return null;
  }
};

/**
 * Set data in Redis cache
 */
const setCachedData = async (key, data, ttl) => {
  if (!redis) return;
  
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
  } catch (error) {
    logger.warn('Cache set failed', { error: error.message });
  }
};

/**
 * Clear seller-related cache
 */
const clearSellerCache = async (sellerId) => {
  if (!redis) return;
  
  try {
    const pattern = `seller:${sellerId}:*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (error) {
    logger.warn('Cache clear failed', { error: error.message });
  }
};

module.exports = {
  uploadProduct,
  getMyProducts,
  updateProduct,
  deleteProduct,
  getSellerDashboard
};