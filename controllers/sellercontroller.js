const Product = require('../models/Product');
const Category = require('../models/Category');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const imagekit = require('../utils/imagekit');
const { body, validationResult } = require('express-validator');

// Input validation rules
const validateProduct = [
  body('name')
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ max: 100 })
    .withMessage('Product name must be less than 100 characters'),
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  // Accept BOTH fields; keep backward compatibility
  body('comparePrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Compare price must be a positive number'),
  body('originalPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Original price must be a positive number'),
  body().custom((val) => {
    const price = Number(val.price);
    const op = val.originalPrice != null ? Number(val.originalPrice)
             : val.comparePrice != null ? Number(val.comparePrice)
             : null;
    if (op != null && price > op) {
      throw new Error('Price cannot be greater than original/compare price');
    }
    return true;
  }),
  body('costPerItem')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Cost per item must be a positive number'),
  body('stock')
    .isInt({ min: 0 })
    .withMessage('Stock must be a non-negative integer'),
  body('category')
    .isMongoId()
    .withMessage('Invalid category ID'),
  body('tags')
    .optional()
    .custom((val) => Array.isArray(val) || typeof val === 'string')
    .withMessage('Tags must be an array or a comma-separated string'),
  body('isPublished')
    .optional()
    .isBoolean()
    .withMessage('isPublished must be a boolean'),
];

// Helper function to normalize tags
const normalizeTags = (tags) => {
  if (!tags) return [];
  
  return Array.isArray(tags)
    ? tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
    : String(tags)
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
};

// Upload Product
const uploadProduct = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const sellerId = req.user.id;
    const {
      name,
      description,
      price,
      // accept either/or from the client for backward compatibility
      originalPrice: originalPriceBody,
      comparePrice: comparePriceBody,
      costPerItem,
      stock,
      category,
      tags = [],
      isPublished = true,
      variants = [],
      shipping = {}
    } = req.body;

    // Validate category exists
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category selected'
      });
    }

    // Process uploaded images (ImageKit)
    let images = [];
    const allFiles = [
      ...(req.files?.images || []),
      ...(req.files?.image || []),
    ];
    
    // Align with router: allow up to 8 images
    if (allFiles.length > 8) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 8 images allowed per product'
      });
    }
    
    if (allFiles.length) {
      // Validate file types and sizes
      for (const file of allFiles) {
        if (!file.mimetype.startsWith('image/')) {
          return res.status(400).json({
            success: false,
            message: 'Only image files are allowed'
          });
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
          return res.status(400).json({
            success: false,
            message: 'Image size must be less than 5MB'
          });
        }
      }

      const folder = `products/${sellerId}`;
      const uploads = allFiles.map((f, idx) =>
        imagekit.upload({
          file: f.buffer,
          fileName: `${Date.now()}_${idx}_${f.originalname}`.replace(/\s+/g, '_'),
          folder,
          useUniqueFileName: true
        })
      );
      const results = await Promise.all(uploads);
      images = results.map((r, idx) => ({
        url: r.url,
        publicId: r.fileId,
        alt: r.name || '',
        isPrimary: idx === 0,
        order: idx
      }));
    }

    // Create product slug
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + Date.now();

    // Normalize original price using either field
    const productPrice = Number(price);
    const originalPrice =
      originalPriceBody != null ? Number(originalPriceBody)
      : comparePriceBody != null ? Number(comparePriceBody)
      : null;

    // Calculate discount percentage safely
    let discountPercentage = 0;
    if (originalPrice != null && originalPrice > 0 && productPrice < originalPrice) {
      discountPercentage = Math.round(((originalPrice - productPrice) / originalPrice) * 100);
    }

    // Create product with improved number conversion and tag normalization
    const product = new Product({
      name: name.trim(),
      description: description ? description.trim() : '',
      price: productPrice,
      originalPrice,
      discountPercentage,
      images,
      category: categoryDoc._id,
      seller: sellerId,
      stock: Number(stock),
      tags: normalizeTags(tags),
      status: (String(isPublished) === 'true') ? 'active' : 'draft',
      slug,
      variants,
      shipping,
      costPerItem: costPerItem != null ? Number(costPerItem) : null,
      sellerLocation: req.user.location || {
        type: 'Point',
        coordinates: [0, 0]
      }
    });

    await product.save();

    // Populate category and seller info
    await product.populate('category', 'name slug');
    await product.populate('seller', 'name rating verified');

    logger.info('Product uploaded successfully', {
      productId: product._id,
      sellerId,
      name: product.name
    });

    res.status(201).json({
      success: true,
      message: 'Product uploaded successfully',
      data: {
        product: {
          id: product._id,
          name: product.name,
          price: product.price,
          stock: product.stock,
          status: product.status,
          slug: product.slug,
          category: product.category,
          seller: product.seller,
          images: product.images
        }
      }
    });

  } catch (error) {
    logger.error('Upload product error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading product',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get My Products
const getMyProducts = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const {
      status = 'all',
      category,
      minPrice,
      maxPrice,
      minStock,
      maxStock,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
      search
    } = req.query;

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // Max 100 items per page

    // Build query
    const query = { seller: sellerId };
    
    if (status !== 'all') {
      query.status = status;
    }
    
    if (category && mongoose.Types.ObjectId.isValid(category)) {
      query.category = category;
    }
    
    if (minPrice != null || maxPrice != null) {
      query.price = {};
      if (minPrice != null) query.price.$gte = Number(minPrice);
      if (maxPrice != null) query.price.$lte = Number(maxPrice);
    }
    
    if (minStock != null || maxStock != null) {
      query.stock = {};
      if (minStock != null) query.stock.$gte = Number(minStock);
      if (maxStock != null) query.stock.$lte = Number(maxStock);
    }

    // Search functionality
    if (search) {
      const searchRegex = new RegExp(search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      query.$or = [
        { name: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { tags: { $in: [searchRegex] } }
      ];
    }

    // Build sort
    const sort = {};
    const validSortFields = ['name', 'price', 'stock', 'createdAt', 'updatedAt', 'views'];
    if (validSortFields.includes(sortBy)) {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sort.createdAt = -1; // Default sort
    }

    const skip = (pageNum - 1) * limitNum;

    const [products, totalProducts] = await Promise.all([
      Product.find(query)
        .populate('category', 'name slug')
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalProducts / limitNum);

    res.json({
      success: true,
      message: 'Products retrieved successfully',
      data: {
        products: products.map(product => ({
          id: product._id,
          name: product.name,
          price: product.price,
          originalPrice: product.originalPrice,
          discountPercentage: product.discountPercentage,
          stock: product.stock,
          status: product.status,
          category: product.category,
          images: product.images,
          slug: product.slug,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          views: product.views || 0,
          averageRating: product.averageRating || 0,
          totalReviews: product.totalReviews || 0
        })),
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalProducts,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
          limit: limitNum
        }
      }
    });

  } catch (error) {
    logger.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Update Product
const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const sellerId = req.user.id;

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid productId' 
      });
    }

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const updateData = { ...req.body };

    // Normalize comparePrice -> originalPrice for consistency with create()
    if (updateData.comparePrice != null && updateData.originalPrice == null) {
      updateData.originalPrice = Number(updateData.comparePrice);
      delete updateData.comparePrice;
    }

    // Process uploaded images if any (ImageKit + upload.fields)
    if (req.files && (req.files.images?.length || req.files.image?.length)) {
      const allFiles = [
        ...(req.files.images || []),
        ...(req.files.image || []),
      ];
      
      // Limit uploaded file count
      if (allFiles.length > 8) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 8 images allowed per product'
        });
      }
      
      // Validate file types and sizes
      for (const file of allFiles) {
        if (!file.mimetype.startsWith('image/')) {
          return res.status(400).json({
            success: false,
            message: 'Only image files are allowed'
          });
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
          return res.status(400).json({
            success: false,
            message: 'Image size must be less than 5MB'
          });
        }
      }
      
      const folder = `products/${req.user.id}`;
      const uploads = allFiles.map((f, idx) =>
        imagekit.upload({
          file: f.buffer,
          fileName: `${Date.now()}_${idx}_${f.originalname}`.replace(/\s+/g, '_'),
          folder,
          useUniqueFileName: true
        })
      );
      const results = await Promise.all(uploads);
      updateData.images = results.map((r, idx) => ({
        url: r.url,
        publicId: r.fileId,
        alt: r.name || '',
        isPrimary: idx === 0,
        order: idx
      }));
    }

    // Sanitize string fields
    if (updateData.name) updateData.name = updateData.name.trim();
    if (updateData.description) updateData.description = updateData.description.trim();
    if (updateData.tags) {
      updateData.tags = normalizeTags(updateData.tags);
    }

    // Numeric coercion safety
    if (updateData.price != null) updateData.price = Number(updateData.price);
    if (updateData.originalPrice != null) updateData.originalPrice = Number(updateData.originalPrice);
    if (updateData.stock != null) updateData.stock = Number(updateData.stock);
    if (updateData.costPerItem != null) updateData.costPerItem = Number(updateData.costPerItem);

    // Update discount percentage with improved validation
    if (updateData.price != null && updateData.originalPrice != null && updateData.originalPrice > 0) {
      updateData.discountPercentage = Math.round(
        ((updateData.originalPrice - updateData.price) / updateData.originalPrice) * 100
      );
    }

    const product = await Product.findOneAndUpdate(
      { _id: productId, seller: sellerId },
      updateData,
      { new: true, runValidators: true }
    ).populate('category', 'name slug')
     .populate('seller', 'name rating verified');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or you do not have permission to update it'
      });
    }

    logger.info('Product updated successfully', {
      productId,
      sellerId,
      name: product.name
    });

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: {
        product: {
          id: product._id,
          name: product.name,
          price: product.price,
          stock: product.stock,
          status: product.status,
          category: product.category,
          images: product.images
        }
      }
    });

  } catch (error) {
    logger.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Delete Product
const deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const sellerId = req.user.id;

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid productId' 
      });
    }

    // First find the product to get image publicIds for cleanup
    const product = await Product.findOne({
      _id: productId,
      seller: sellerId
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or you do not have permission to delete it'
      });
    }

    // Delete images from ImageKit
    if (product.images && product.images.length > 0) {
      const deletePromises = product.images.map(image => 
        imagekit.deleteFile(image.publicId).catch(err => {
          logger.warn('Failed to delete image from ImageKit:', err);
        })
      );
      await Promise.all(deletePromises);
    }

    // Delete the product
    await Product.deleteOne({ _id: productId, seller: sellerId });

    logger.info('Product deleted successfully', {
      productId,
      sellerId,
      name: product.name
    });

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    logger.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get Seller Dashboard
const getSellerDashboard = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { timeRange = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    switch (timeRange) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get dashboard data
    const [
      totalProducts,
      activeProducts,
      totalRevenue,
      totalOrders,
      lowStockProducts,
      topProducts
    ] = await Promise.all([
      Product.countDocuments({ seller: sellerId }),
      Product.countDocuments({ seller: sellerId, status: 'active' }),
      // Revenue calculation would need Order model integration
      Promise.resolve(0),
      // Order count would need Order model integration
      Promise.resolve(0),
      Product.countDocuments({ 
        seller: sellerId, 
        stock: { $lte: 10 },
        status: 'active'
      }),
      Product.find({ seller: sellerId })
        .sort({ views: -1 })
        .limit(5)
        .select('name views averageRating stock')
        .lean()
    ]);

    res.json({
      success: true,
      message: 'Dashboard data retrieved successfully',
      data: {
        overview: {
          totalProducts,
          activeProducts,
          totalRevenue,
          totalOrders,
          lowStockProducts
        },
        topProducts,
        timeRange,
        dateRange: {
          startDate: startDate.toISOString(),
          endDate: now.toISOString()
        }
      }
    });

  } catch (error) {
    logger.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get Product Analytics
const getProductAnalytics = async (req, res) => {
  try {
    const { productId } = req.params;
    const sellerId = req.user.id;
    const { timeRange = '30d' } = req.query;

    // Validate productId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid productId' 
      });
    }

    // Verify product ownership
    const product = await Product.findOne({
      _id: productId,
      seller: sellerId
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or you do not have permission to view it'
      });
    }

    // Calculate analytics (simplified version)
    const analytics = {
      views: product.views || 0,
      averageRating: product.averageRating || 0,
      totalReviews: product.totalReviews || 0,
      stockLevel: product.stock,
      status: product.status,
      createdAt: product.createdAt,
      timeRange
    };

    res.json({
      success: true,
      message: 'Product analytics retrieved successfully',
      data: {
        product: {
          id: product._id,
          name: product.name
        },
        analytics
      }
    });

  } catch (error) {
    logger.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Bulk Update Products
const bulkUpdateProducts = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { productIds, updateData } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Product IDs array is required'
      });
    }

    // Validate all product IDs
    const validProductIds = productIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validProductIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid product IDs provided'
      });
    }

    // Limit bulk operations to prevent abuse
    if (validProductIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update more than 100 products at once'
      });
    }

    const result = await Product.updateMany(
      { _id: { $in: validProductIds }, seller: sellerId },
      updateData
    );

    logger.info('Bulk update completed', {
      sellerId,
      updatedCount: result.modifiedCount,
      totalProducts: validProductIds.length
    });

    res.json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} products`,
      data: {
        updatedCount: result.modifiedCount,
        totalProducts: validProductIds.length
      }
    });

  } catch (error) {
    logger.error('Bulk update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating products',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Export Products
const exportProducts = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { format = 'json' } = req.query;

    const products = await Product.find({ seller: sellerId })
      .populate('category', 'name')
      .lean();

    if (format === 'json') {
      res.json({
        success: true,
        message: 'Products exported successfully',
        data: {
          products,
          totalProducts: products.length,
          exportDate: new Date().toISOString()
        }
      });
    } else {
      // For CSV/Excel export, you would implement file generation
      res.status(400).json({
        success: false,
        message: 'CSV/Excel export not implemented yet'
      });
    }

  } catch (error) {
    logger.error('Export products error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting products',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  uploadProduct,
  getMyProducts,
  updateProduct,
  deleteProduct,
  getSellerDashboard,
  getProductAnalytics,
  bulkUpdateProducts,
  exportProducts,
  validateProduct
};