const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { body, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const Review = require('../models/Review');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const { createSlug } = require('../utils/helpers');
const logger = require('../utils/logger');
const redis = require('../config/redis');

const router = express.Router();

// Product status constants
const ProductStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  REJECTED: 'rejected'
};

// Enhanced rate limiting
const productLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  keyGenerator: (req) => `${req.ip}:${req.user?.id || 'guest'}`,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.ip} on ${req.path}`);
    res.status(429).json({ 
      success: false, 
      error: 'Too many requests, please try again later',
      retryAfter: 15 * 60
    });
  }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: { error: 'Too many upload requests, please try again later' }
});

// Image upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
    fields: 20
  },
  fileFilter: (req, file, cb) => {
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (validMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
    }
  }
});

// Product validation middleware
const validateProduct = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Product name must be 3-100 characters')
    .matches(/^[\w\s\-.,()&]+$/)
    .withMessage('Invalid characters in product name'),
  
  body('description')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Description must be 10-2000 characters'),
  
  body('price')
    .isFloat({ min: 1, max: 100000 })
    .withMessage('Price must be ₹1 - ₹100,000')
    .toFloat(),
  
  body('category')
    .isMongoId()
    .withMessage('Invalid category ID')
    .custom(async (value) => {
      const category = await Category.findById(value);
      if (!category) throw new Error('Category not found');
      return true;
    }),
  
  body('stock')
    .isInt({ min: 0, max: 10000 })
    .withMessage('Stock must be 0-10000')
    .toInt(),
  
  body('unit')
    .isIn(['piece', 'kg', 'gram', 'liter', 'ml', 'packet', 'box', 'dozen'])
    .withMessage('Invalid unit type'),
  
  body('tags')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Maximum 10 tags allowed')
    .customSanitizer(tags => tags ? tags.map(tag => tag.trim().toLowerCase()) : []),
  
  body('weight')
    .optional()
    .isFloat({ min: 0.01, max: 1000 })
    .withMessage('Weight must be 0.01-1000 kg')
    .toFloat(),
  
  body('expiryDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid expiry date format')
    .custom(value => {
      if (value && new Date(value) <= new Date()) {
        throw new Error('Expiry date must be in the future');
      }
      return true;
    })
];

// Search validation
const validateSearch = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Page must be 1-1000')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be 1-100')
    .toInt(),
  
  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be positive')
    .toFloat(),
  
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be positive')
    .toFloat(),
  
  query('latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude (-90 to 90)')
    .toFloat(),
  
  query('longitude')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude (-180 to 180)')
    .toFloat(),
  
  query('radius')
    .optional()
    .isFloat({ min: 0.1, max: 50 })
    .withMessage('Radius must be 0.1-50 km')
    .toFloat()
];

// ==================== PUBLIC ROUTES ====================

// Simplified GET /api/products route for testing
router.get('/', 
  productLimiter,
  validateSearch,
  async (req, res) => {
    try {
      logger.info('Starting /api/products request', { query: req.query, requestId: req.requestId });

      // Validate query parameters
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        logger.warn('Validation errors in /api/products', { errors: errors.array(), requestId: req.requestId });
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      // Simple test response
      logger.info('Returning test response for /api/products', { requestId: req.requestId });
      res.json({
        success: true,
        message: 'Products route is working',
        query: req.query,
        products: [] // Empty for now, replace with actual logic once confirmed working
      });

      /*
      // Original logic (commented out for testing)
      // Build search query
      logger.info('Building search query', { requestId: req.requestId });
      const query = await buildProductSearchQuery(req.query);

      // Build aggregation pipeline
      logger.info('Building aggregation pipeline', { requestId: req.requestId });
      const pipeline = await buildProductPipeline(query, req.query);

      // Check cache first
      logger.info('Checking cache', { requestId: req.requestId });
      const cacheKey = `products:${JSON.stringify(req.query)}`;
      const cachedResults = await getCachedResults(cacheKey);
      
      if (cachedResults) {
        logger.info('Returning cached results', { requestId: req.requestId });
        return res.json(cachedResults);
      }

      // Execute search
      logger.info('Executing MongoDB query', { requestId: req.requestId });
      const [products, totalProducts] = await Promise.all([
        Product.aggregate(pipeline),
        Product.countDocuments(query)
      ]);

      // Prepare response
      const response = {
        success: true,
        count: products.length,
        totalProducts,
        totalPages: Math.ceil(totalProducts / (req.query.limit || 20)),
        currentPage: req.query.page || 1,
        hasNextPage: (req.query.page || 1) * (req.query.limit || 20) < totalProducts,
        hasPrevPage: (req.query.page || 1) > 1,
        filters: {
          search: req.query.search,
          category: req.query.category,
          minPrice: req.query.minPrice,
          maxPrice: req.query.maxPrice,
          sort: req.query.sort
        },
        products
      };

      // Cache results for 5 minutes
      logger.info('Caching results', { requestId: req.requestId });
      await setCacheResults(cacheKey, response, 300);

      // Track popular searches
      if (req.query.search && products.length > 0) {
        logger.info('Tracking popular search', { search: req.query.search, requestId: req.requestId });
        await trackPopularSearch(req.query.search);
      }

      res.json(response);
      */

    } catch (error) {
      logger.error('Product search error:', { 
        error: error.message, 
        stack: error.stack, 
        requestId: req.requestId 
      });
      res.status(500).json({
        success: false,
        message: 'Error retrieving products',
        requestId: req.requestId
      });
    }
  }
);

// ... (rest of the routes remain unchanged, included for completeness)
router.get('/:identifier', 
  productLimiter,
  async (req, res) => {
    try {
      const product = await getProductDetails(
        req.params.identifier, 
        req.user?.id, 
        req.query
      );
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      res.json({
        success: true,
        product
      });

    } catch (error) {
      logger.error('Get product error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving product'
      });
    }
  }
);

router.get('/category/:categorySlug',
  productLimiter,
  validateSearch,
  async (req, res) => {
    try {
      const { categorySlug } = req.params;
      const { page = 1, limit = 20, sort = 'popular' } = req.query;

      const category = await Category.findOne({ slug: categorySlug });
      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      const query = {
        category: category._id,
        status: ProductStatus.ACTIVE,
        isDeleted: false,
        stock: { $gt: 0 }
      };

      const sortQuery = buildSortQuery(sort);
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [products, totalProducts] = await Promise.all([
        Product.find(query)
          .populate('seller', 'name rating verified')
          .select('-description -specifications')
          .sort(sortQuery)
          .skip(skip)
          .limit(parseInt(limit)),
        Product.countDocuments(query)
      ]);

      res.json({
        success: true,
        category: {
          name: category.name,
          slug: category.slug,
          description: category.description
        },
        count: products.length,
        totalProducts,
        totalPages: Math.ceil(totalProducts / parseInt(limit)),
        currentPage: parseInt(page),
        products
      });

    } catch (error) {
      logger.error('Category products error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving category products'
      });
    }
  }
);

router.get('/trending/products',
  productLimiter,
  async (req, res) => {
    try {
      const { limit = 20 } = req.query;

      const products = await Product.aggregate([
        {
          $match: {
            status: ProductStatus.ACTIVE,
            isDeleted: false,
            stock: { $gt: 0 }
          }
        },
        {
          $addFields: {
            trendingScore: {
              $add: [
                { $multiply: ['$totalSales', 0.4] },
                { $multiply: ['$views', 0.2] },
                { $multiply: ['$averageRating', 20] },
                { $multiply: ['$totalReviews', 5] }
              ]
            }
          }
        },
        { $sort: { trendingScore: -1 } },
        { $limit: parseInt(limit) },
        {
          $lookup: {
            from: 'categories',
            localField: 'category',
            foreignField: '_id',
            as: 'category'
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'seller',
            foreignField: '_id',
            as: 'seller',
            pipeline: [
              { $project: { name: 1, rating: 1, verified: 1 } }
            ]
          }
        },
        {
          $project: {
            name: 1,
            price: 1,
            discountPercentage: 1,
            images: { $slice: ['$images', 1] },
            averageRating: 1,
            totalReviews: 1,
            slug: 1,
            trendingScore: 1,
            category: { $arrayElemAt: ['$category', 0] },
            seller: { $arrayElemAt: ['$seller', 0] }
          }
        }
      ]);

      res.json({
        success: true,
        count: products.length,
        products
      });

    } catch (error) {
      logger.error('Trending products error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving trending products'
      });
    }
  }
);

router.post('/',
  protect,
  authorize('seller', 'admin'),
  uploadLimiter,
  upload.array('images', 5),
  validateProduct,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const productCount = await Product.countDocuments({ 
        seller: req.user.id,
        isDeleted: false 
      });
      
      if (productCount >= 1000) {
        return res.status(400).json({
          success: false,
          message: 'Product limit reached. Contact support to increase limit.'
        });
      }

      const imageUrls = await processProductImages(req.files, req.user.id);
      const product = await createNewProduct(req.body, req.user, imageUrls);

      await product.populate('category', 'name');

      logger.info(`Product created: ${product.name}`, {
        productId: product._id,
        sellerId: req.user.id,
        sellerName: req.user.name
      });

      res.status(201).json({
        success: true,
        message: req.user.role === 'admin' 
          ? 'Product created and published successfully'
          : 'Product created successfully. Awaiting admin approval.',
        product
      });

    } catch (error) {
      logger.error('Create product error:', error);
      
      if (req.uploadedImages) {
        await cleanupUploadedImages(req.uploadedImages);
      }

      res.status(500).json({
        success: false,
        message: 'Error creating product'
      });
    }
  }
);

router.patch('/:id',
  protect,
  authorize('seller', 'admin'),
  upload.array('newImages', 5),
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 3, max: 100 })
      .withMessage('Product name must be between 3-100 characters'),
    
    body('price')
      .optional()
      .isFloat({ min: 1 })
      .withMessage('Price must be greater than 0'),
    
    body('stock')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Stock must be non-negative')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const product = await verifyProductOwnership(req.params.id, req.user);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found or not authorized'
        });
      }

      const updatedProduct = await updateProductDetails(
        product, 
        req.body, 
        req.files, 
        req.user.id
      );

      logger.info(`Product updated: ${updatedProduct.name}`, {
        productId: updatedProduct._id,
        updatedBy: req.user.id
      });

      res.json({
        success: true,
        message: 'Product updated successfully',
        product: updatedProduct
      });

    } catch (error) {
      logger.error('Update product error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating product'
      });
    }
  }
);

router.delete('/:id',
  protect,
  authorize('seller', 'admin'),
  async (req, res) => {
    try {
      const product = await verifyProductOwnership(req.params.id, req.user);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found or not authorized'
        });
      }

      product.isDeleted = true;
      product.deletedAt = new Date();
      await product.save();

      logger.info(`Product deleted: ${product.name}`, {
        productId: product._id,
        deletedBy: req.user.id
      });

      res.json({
        success: true,
        message: 'Product deleted successfully'
      });

    } catch (error) {
      logger.error('Delete product error:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting product'
      });
    }
  }
);

router.get('/seller/dashboard',
  protect,
  authorize('seller', 'admin'),
  async (req, res) => {
    try {
      const { page = 1, limit = 20, status, search } = req.query;

      let query = { 
        seller: req.user.id,
        isDeleted: false 
      };

      if (status && status !== 'all') {
        query.status = status;
      }

      if (search) {
        query.$text = { $search: search };
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [products, stats] = await Promise.all([
        Product.find(query)
          .populate('category', 'name')
          .select('-description -specifications')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        
        Product.aggregate([
          { $match: { seller: req.user.id, isDeleted: false } },
          {
            $group: {
              _id: null,
              totalProducts: { $sum: 1 },
              activeProducts: {
                $sum: { $cond: [{ $eq: ['$status', ProductStatus.ACTIVE] }, 1, 0] }
              },
              pendingProducts: {
                $sum: { $cond: [{ $eq: ['$status', ProductStatus.PENDING] }, 1, 0] }
              },
              totalViews: { $sum: '$views' },
              totalSales: { $sum: '$totalSales' },
              lowStockProducts: {
                $sum: { $cond: [{ $lte: ['$stock', 10] }, 1, 0] }
              },
              avgRating: { $avg: '$averageRating' },
              totalRevenue: { $sum: { $multiply: ['$price', '$totalSales'] } }
            }
          }
        ])
      ]);

      const totalProducts = await Product.countDocuments(query);

      res.json({
        success: true,
        stats: stats[0] || {
          totalProducts: 0,
          activeProducts: 0,
          pendingProducts: 0,
          totalViews: 0,
          totalSales: 0,
          lowStockProducts: 0,
          avgRating: 0,
          totalRevenue: 0
        },
        products,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalProducts / parseInt(limit)),
          totalProducts,
          hasNext: parseInt(page) * parseInt(limit) < totalProducts,
          hasPrev: parseInt(page) > 1
        }
      });

    } catch (error) {
      logger.error('Seller dashboard error:', error);
      res.status(500).json({
        success: false,
        message: 'Error loading seller dashboard'
      });
    }
  }
);

router.patch('/bulk/operations',
  protect,
  authorize('seller', 'admin'),
  [
    body('operation')
      .isIn(['activate', 'deactivate', 'delete', 'updateStock', 'updatePrice'])
      .withMessage('Invalid operation'),
    body('productIds')
      .isArray({ min: 1, max: 100 })
      .withMessage('Product IDs array required (max 100)'),
    body('data')
      .optional()
      .isObject()
      .withMessage('Additional data must be an object')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { operation, productIds, data } = req.body;
      
      const products = await Product.find({
        _id: { $in: productIds },
        seller: req.user.role === 'admin' ? { $exists: true } : req.user.id,
        isDeleted: false
      });

      if (products.length !== productIds.length) {
        return res.status(400).json({
          success: false,
          message: 'Some products not found or not authorized'
        });
      }

      let updateQuery = {};
      let successMessage = '';

      switch (operation) {
        case 'activate':
          updateQuery = { status: ProductStatus.ACTIVE };
          successMessage = 'Products activated successfully';
          break;
        
        case 'deactivate':
          updateQuery = { status: ProductStatus.INACTIVE };
          successMessage = 'Products deactivated successfully';
          break;
        
        case 'delete':
          updateQuery = { isDeleted: true, deletedAt: new Date() };
          successMessage = 'Products deleted successfully';
          break;
        
        case 'updateStock':
          if (!data?.stock || data.stock < 0) {
            return res.status(400).json({
              success: false,
              message: 'Valid stock quantity required'
            });
          }
          updateQuery = { stock: parseInt(data.stock) };
          successMessage = 'Stock updated successfully';
          break;
        
        case 'updatePrice':
          if (!data?.price || data.price <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Valid price required'
            });
          }
          updateQuery = { price: parseFloat(data.price) };
          successMessage = 'Prices updated successfully';
          break;
      }

      const result = await Product.updateMany(
        { _id: { $in: productIds } },
        { $set: { ...updateQuery, updatedAt: new Date() } }
      );

      logger.info(`Bulk ${operation} performed`, {
        userId: req.user.id,
        productCount: result.modifiedCount,
        operation
      });

      res.json({
        success: true,
        message: successMessage,
        modifiedCount: result.modifiedCount
      });

    } catch (error) {
      logger.error('Bulk operation error:', error);
      res.status(500).json({
        success: false,
        message: 'Error performing bulk operation'
      });
    }
  }
);

router.get('/seller/low-stock',
  protect,
  authorize('seller', 'admin'),
  async (req, res) => {
    try {
      const { threshold = 10 } = req.query;
      
      const lowStockProducts = await Product.find({
        seller: req.user.id,
        stock: { $lte: parseInt(threshold), $gt: 0 },
        status: ProductStatus.ACTIVE,
        isDeleted: false
      })
      .select('name stock price images slug')
      .sort({ stock: 1 });

      res.json({
        success: true,
        count: lowStockProducts.length,
        threshold: parseInt(threshold),
        products: lowStockProducts
      });

    } catch (error) {
      logger.error('Low stock products error:', error);
      res.status(500).json({
        success: false,
        message: 'Error retrieving low stock products'
      });
    }
  }
);

router.post('/:id/duplicate',
  protect,
  authorize('seller', 'admin'),
  async (req, res) => {
    try {
      const originalProduct = await verifyProductOwnership(req.params.id, req.user);
      if (!originalProduct) {
        return res.status(404).json({
          success: false,
          message: 'Product not found or not authorized'
        });
      }

      const duplicateData = originalProduct.toObject();
      delete duplicateData._id;
      delete duplicateData.createdAt;
      delete duplicateData.updatedAt;
      delete duplicateData.views;
      delete duplicateData.totalSales;
      delete duplicateData.totalReviews;
      delete duplicateData.averageRating;

      duplicateData.name = `${duplicateData.name} (Copy)`;
      duplicateData.slug = await generateUniqueSlug(duplicateData.name);
      duplicateData.status = ProductStatus.PENDING;
      duplicateData.stock = 0;

      const duplicatedProduct = await Product.create(duplicateData);

      logger.info(`Product duplicated: ${originalProduct.name}`, {
        originalId: originalProduct._id,
        duplicateId: duplicatedProduct._id,
        userId: req.user.id
      });

      res.status(201).json({
        success: true,
        message: 'Product duplicated successfully',
        product: duplicatedProduct
      });

    } catch (error) {
      logger.error('Duplicate product error:', error);
      res.status(500).json({
        success: false,
        message: 'Error duplicating product'
      });
    }
  }
);

// ==================== HELPER FUNCTIONS ====================

async function buildProductSearchQuery(params) {
  logger.info('Building product search query', { params });
  const {
    search,
    category,
    seller,
    minPrice,
    maxPrice,
    inStock,
    rating,
    tags,
    latitude,
    longitude,
    radius = 10,
    fresh,
    discount
  } = params;

  const query = { 
    status: ProductStatus.ACTIVE,
    isDeleted: false,
    stock: { $gt: 0 } 
  };

  if (search) {
    query.$text = { $search: search };
  }

  if (category) {
    const categoryDoc = await Category.findOne({ 
      $or: [
        { _id: category },
        { slug: category.toLowerCase() }
      ]
    });
    if (categoryDoc) {
      query.category = categoryDoc._id;
    }
  }

  if (seller) {
    query.seller = seller;
  }

  if (minPrice || maxPrice) {
    query.price = {};
    if (minPrice) query.price.$gte = parseFloat(minPrice);
    if (maxPrice) query.price.$lte = parseFloat(maxPrice);
  }

  if (inStock === 'true') {
    query.stock = { $gt: 0 };
  }

  if (rating) {
    query.averageRating = { $gte: parseFloat(rating) };
  }

  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : tags.split(',');
    query.tags = { $in: tagArray };
  }

  if (latitude && longitude) {
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        $maxDistance: parseFloat(radius) * 1000
      }
    };
  }

  if (fresh === 'true') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    query.createdAt = { $gte: weekAgo };
  }

  if (discount === 'true') {
    query.discountPercentage = { $gt: 0 };
  }

  return query;
}

async function buildProductPipeline(query, params) {
  const { sort, limit = 20, page = 1 } = params;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const sortStage = buildSortStage(sort, query.$text);

  return [
    { $match: query },
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'category'
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: 'seller',
        foreignField: '_id',
        as: 'seller',
        pipeline: [
          { $project: { name: 1, rating: 1, verified: 1 } }
        ]
      }
    },
    {
      $addFields: {
        finalPrice: {
          $cond: {
            if: { $gt: ['$discountPercentage', 0] },
            then: {
              $subtract: [
                '$price',
                { $multiply: ['$price', { $divide: ['$discountPercentage', 100] }] }
              ]
            },
            else: '$price'
          }
        },
        isOnSale: { $gt: ['$discountPercentage', 0] },
        deliveryEstimate: calculateDeliveryEstimate()
      }
    },
    { $sort: sortStage },
    { $skip: skip },
    { $limit: parseInt(limit) },
    {
      $project: {
        name: 1,
        price: 1,
        finalPrice: 1,
        discountPercentage: 1,
        isOnSale: 1,
        images: { $slice: ['$images', 3] },
        stock: 1,
        averageRating: 1,
        totalReviews: 1,
        tags: 1,
        deliveryEstimate: 1,
        slug: 1,
        category: { $arrayElemAt: ['$category', 0] },
        seller: { $arrayElemAt: ['$seller', 0] },
        createdAt: 1
      }
    }
  ];
}

function buildSortStage(sort, hasTextSearch) {
  switch (sort) {
    case 'price_low': return { price: 1 };
    case 'price_high': return { price: -1 };
    case 'rating': return { averageRating: -1 };
    case 'popular': return { totalSales: -1 };
    case 'newest': return { createdAt: -1 };
    case 'discount': return { discountPercentage: -1 };
    default: return hasTextSearch ? { score: { $meta: 'textScore' } } : { createdAt: -1 };
  }
}

function buildSortQuery(sort) {
  switch (sort) {
    case 'price_low': return { price: 1 };
    case 'price_high': return { price: -1 };
    case 'popular': return { totalSales: -1, averageRating: -1 };
    default: return { createdAt: -1 };
  }
}

function calculateDeliveryEstimate() {
  return '20-30 mins';
}

async function getProductDetails(identifier, userId, queryParams) {
  const isObjectId = identifier.match(/^[0-9a-fA-F]{24}$/);
  const query = isObjectId ? { _id: identifier } : { slug: identifier };

  const product = await Product.findOneAndUpdate(
    { ...query, status: ProductStatus.ACTIVE, isDeleted: false },
    { $inc: { views: 1 } },
    { new: true }
  )
  .populate('category', 'name slug')
  .populate('seller', 'name rating verified shopAddress')
  .populate({
    path: 'reviews',
    options: { sort: { createdAt: -1 }, limit: 10 },
    populate: { path: 'user', select: 'name' }
  });

  if (!product) return null;

  let isInWishlist = false;
  if (userId) {
    const user = await User.findById(userId).select('wishlist');
    isInWishlist = user?.wishlist?.includes(product._id) || false;
  }

  const relatedProducts = await Product.find({
    category: product.category._id,
    _id: { $ne: product._id },
    status: ProductStatus.ACTIVE,
    stock: { $gt: 0 }
  })
  .select('name price images averageRating discountPercentage slug')
  .limit(8);

  return {
    ...product.toObject(),
    isInWishlist,
    finalPrice: product.discountPercentage > 0 
      ? product.price - (product.price * product.discountPercentage / 100)
      : product.price,
    deliveryEstimate: '20-30 mins',
    relatedProducts
  };
}

async function processProductImages(files, userId) {
  if (!files || files.length === 0) return [];

  const uploadPromises = files.map(async (file, index) => {
    const optimizedImage = await sharp(file.buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    return uploadToCloudinary(optimizedImage, {
      folder: `quicklocal/products/${userId}`,
      public_id: `${Date.now()}_${index}`,
      transformation: [
        { quality: 'auto:good' },
        { fetch_format: 'auto' }
      ]
    });
  });

  return Promise.all(uploadPromises);
}

async function createNewProduct(productData, user, images) {
  const slug = await generateUniqueSlug(productData.name);
  
  return await Product.create({
    ...productData,
    slug,
    seller: user.id,
    images,
    status: user.role === 'admin' ? ProductStatus.ACTIVE : ProductStatus.PENDING,
    specifications: productData.specifications 
      ? JSON.parse(productData.specifications) 
      : undefined,
    dimensions: productData.dimensions 
      ? JSON.parse(productData.dimensions) 
      : undefined,
    tags: productData.tags 
      ? (Array.isArray(productData.tags) 
          ? productData.tags 
          : productData.tags.split(',').map(tag => tag.trim()))
      : [],
    sku: productData.sku || `SKU-${Date.now()}`
  });
}

async function generateUniqueSlug(name) {
  const baseSlug = createSlug(name);
  let slug = baseSlug;
  let counter = 1;
  
  while (await Product.findOne({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  
  return slug;
}

async function verifyProductOwnership(productId, user) {
  const product = await Product.findById(productId);
  if (!product) return null;
  
  if (user.role !== 'admin' && product.seller.toString() !== user.id) {
    return null;
  }
  
  return product;
}

async function updateProductDetails(product, updateData, newImages, userId) {
  const updates = {};
  const allowedFields = [
    'name', 'description', 'price', 'stock', 'unit', 
    'weight', 'dimensions', 'tags', 'specifications',
    'expiryDate', 'brand', 'status'
  ];

  allowedFields.forEach(field => {
    if (updateData[field] !== undefined) {
      updates[field] = updateData[field];
    }
  });

  if (newImages?.length > 0) {
    const newImageUrls = await processProductImages(newImages, userId);
    updates.$push = { images: { $each: newImageUrls } };
  }

  if (updateData.removeImages) {
    const imagesToRemove = Array.isArray(updateData.removeImages) 
      ? updateData.removeImages 
      : [updateData.removeImages];
    
    await deleteProductImages(imagesToRemove);
    updates.$pull = { images: { $in: imagesToRemove } };
  }

  if (updates.name && updates.name !== product.name) {
    updates.slug = await generateUniqueSlug(updates.name);
  }

  return await Product.findByIdAndUpdate(
    product._id,
    updates,
    { new: true, runValidators: true }
  ).populate('category', 'name');
}

async function deleteProductImages(imageUrls) {
  const deletePromises = imageUrls.map(url => 
    deleteFromCloudinary(extractPublicIdFromUrl(url))
  );
  await Promise.allSettled(deletePromises);
}

function extractPublicIdFromUrl(url) {
  const parts = url.split('/');
  const fileName = parts[parts.length - 1];
  return fileName.split('.')[0];
}

async function cleanupUploadedImages(publicIds) {
  await Promise.allSettled(
    publicIds.map(publicId => 
      deleteFromCloudinary(publicId).catch(error => {
        logger.error('Failed to cleanup image:', error);
      })
    )
  );
}

async function getCachedResults(key) {
  if (process.env.DISABLE_REDIS === 'true') {
    logger.info('Redis disabled, skipping cache check', { key });
    return null;
  }
  try {
    if (redis) {
      const cached = await redis.get(key);
      return cached ? JSON.parse(cached) : null;
    }
  } catch (error) {
    logger.warn('Cache get failed:', { error: error.message });
  }
  return null;
}

async function setCacheResults(key, data, ttl) {
  if (process.env.DISABLE_REDIS === 'true') {
    logger.info('Redis disabled, skipping cache set', { key });
    return;
  }
  try {
    if (redis) {
      await redis.setex(key, ttl, JSON.stringify(data));
    }
  } catch (error) {
    logger.warn('Cache set failed:', { error: error.message });
  }
}

async function trackPopularSearch(search) {
  if (process.env.DISABLE_REDIS === 'true') {
    logger.info('Redis disabled, skipping search tracking', { search });
    return;
  }
  try {
    if (redis) {
      await redis.zincrby('popular_searches', 1, search.toLowerCase());
    }
  } catch (error) {
    logger.warn('Search tracking failed:', { error: error.message });
  }
}

module.exports = router;