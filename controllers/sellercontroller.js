const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order'); 
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { body, validationResult } = require('express-validator');

// Initialize ImageKit with error handling
let imagekit;
try {
  imagekit = require('../utils/imagekit');
  // Test if ImageKit is properly configured
  if (!imagekit || !imagekit.upload) {
    throw new Error('ImageKit not properly configured');
  }
} catch (error) {
  console.warn('ImageKit initialization failed:', error.message);
  // Create a mock imagekit object
  imagekit = {
    upload: () => Promise.reject(new Error('ImageKit not configured')),
    deleteFile: () => Promise.reject(new Error('ImageKit not configured'))
  };
}

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

    // Process uploaded images
    let images = [];
    const allFiles = [
      ...(req.files?.images || []),
      ...(req.files?.image || []),
    ];
    
    if (allFiles.length > 8) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 8 images allowed per product'
      });
    }
    
    if (allFiles.length) {
      for (const file of allFiles) {
        if (!file.mimetype.startsWith('image/')) {
          return res.status(400).json({
            success: false,
            message: 'Only image files are allowed'
          });
        }
        if (file.size > 5 * 1024 * 1024) {
          return res.status(400).json({
            success: false,
            message: 'Image size must be less than 5MB'
          });
        }
      }

      try {
        const folder = `products/${sellerId}`;
        const uploads = allFiles.map((f, idx) =>
          imagekit.upload({
            file: f.buffer,
            fileName: `${Date.now()}_${idx}_${f.originalname}`.replace(/\s+/g, '_'),
            folder,
            useUniqueFileName: true
          }).catch(error => {
            console.error('Image upload failed:', error);
            return null;
          })
        );
        
        const results = await Promise.all(uploads);
        images = results
          .filter(result => result !== null)
          .map((r, idx) => ({
            url: r.url,
            publicId: r.fileId,
            alt: r.name || '',
            isPrimary: idx === 0,
            order: idx
          }));
      } catch (error) {
        console.error('Image upload process failed:', error);
        // Continue without images rather than failing the entire request
        images = [];
      }
    }

    // Create product slug
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + Date.now();

    const productPrice = Number(price);
    const originalPrice =
      originalPriceBody != null ? Number(originalPriceBody)
      : comparePriceBody != null ? Number(comparePriceBody)
      : null;

    let discountPercentage = 0;
    if (originalPrice != null && originalPrice > 0 && productPrice < originalPrice) {
      discountPercentage = Math.round(((originalPrice - productPrice) / originalPrice) * 100);
    }

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

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

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

    if (search) {
      const searchRegex = new RegExp(search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
      query.$or = [
        { name: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { tags: { $in: [searchRegex] } }
      ];
    }

    const sort = {};
    const validSortFields = ['name', 'price', 'stock', 'createdAt', 'updatedAt', 'views'];
    if (validSortFields.includes(sortBy)) {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sort.createdAt = -1;
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
          _id: product._id,
          id: product._id,
          name: product.name,
          price: product.price,
          originalPrice: product.originalPrice,
          discountPercentage: product.discountPercentage,
          stock: product.stock,
          status: product.status,
          category: product.category?.name || 'Uncategorized',
          categoryId: product.category?._id,
          images: product.images,
          slug: product.slug,
          description: product.description,
          tags: product.tags,
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

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid productId' 
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const updateData = { ...req.body };

    if (updateData.comparePrice != null && updateData.originalPrice == null) {
      updateData.originalPrice = Number(updateData.comparePrice);
      delete updateData.comparePrice;
    }

    if (req.files && (req.files.images?.length || req.files.image?.length)) {
      const allFiles = [
        ...(req.files.images || []),
        ...(req.files.image || []),
      ];
      
      if (allFiles.length > 8) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 8 images allowed per product'
        });
      }
      
      for (const file of allFiles) {
        if (!file.mimetype.startsWith('image/')) {
          return res.status(400).json({
            success: false,
            message: 'Only image files are allowed'
          });
        }
        if (file.size > 5 * 1024 * 1024) {
          return res.status(400).json({
            success: false,
            message: 'Image size must be less than 5MB'
          });
        }
      }
      
      try {
        const folder = `products/${req.user.id}`;
        const uploads = allFiles.map((f, idx) =>
          imagekit.upload({
            file: f.buffer,
            fileName: `${Date.now()}_${idx}_${f.originalname}`.replace(/\s+/g, '_'),
            folder,
            useUniqueFileName: true
          }).catch(error => {
            console.error('Image upload failed:', error);
            return null;
          })
        );
        
        const results = await Promise.all(uploads);
        updateData.images = results
          .filter(result => result !== null)
          .map((r, idx) => ({
            url: r.url,
            publicId: r.fileId,
            alt: r.name || '',
            isPrimary: idx === 0,
            order: idx
          }));
      } catch (error) {
        console.error('Image upload process failed:', error);
        // Continue without updating images rather than failing the entire request
      }
    }

    if (updateData.name) updateData.name = updateData.name.trim();
    if (updateData.description) updateData.description = updateData.description.trim();
    if (updateData.tags) {
      updateData.tags = normalizeTags(updateData.tags);
    }

    if (updateData.price != null) updateData.price = Number(updateData.price);
    if (updateData.originalPrice != null) updateData.originalPrice = Number(updateData.originalPrice);
    if (updateData.stock != null) updateData.stock = Number(updateData.stock);
    if (updateData.costPerItem != null) updateData.costPerItem = Number(updateData.costPerItem);

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

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid productId' 
      });
    }

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
          console.warn('Failed to delete image from ImageKit:', err);
          // Don't fail the entire operation if image deletion fails
        })
      );
      await Promise.all(deletePromises);
    }

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

// Get Seller Dashboard - Fixed with proper Order integration
const getSellerDashboard = async (req, res) => {
  try {
    const sellerId = new mongoose.Types.ObjectId(req.user.id);
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

    // Get dashboard data with proper aggregations
    const [
      totalProducts,
      activeProducts,
      lowStockProducts,
      topProducts,
      revenueData,
      orderData,
      customerData
    ] = await Promise.all([
      Product.countDocuments({ seller: sellerId }),
      Product.countDocuments({ seller: sellerId, status: 'active' }),
      Product.countDocuments({ 
        seller: sellerId, 
        stock: { $lte: 10 },
        status: 'active'
      }),
      Product.find({ seller: sellerId })
        .sort({ views: -1 })
        .limit(5)
        .select('name views averageRating stock price')
        .lean(),
      
      // Revenue calculation
      Order.aggregate([
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'prod',
          },
        },
        { $unwind: '$prod' },
        { $match: { 'prod.seller': sellerId, createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        }
      ]),

      // Order count calculation
      Order.aggregate([
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'prod',
          },
        },
        { $unwind: '$prod' },
        { $match: { 'prod.seller': sellerId, createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$_id' // Group by order ID to avoid counting duplicates
          }
        },
        { $count: 'totalOrders' }
      ]),

      // Customer count
      Order.aggregate([
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'prod',
          },
        },
        { $unwind: '$prod' },
        { $match: { 'prod.seller': sellerId } },
        {
          $group: {
            _id: '$user' // Group by customer/user ID
          }
        },
        { $count: 'totalCustomers' }
      ])
    ]);

    const totalRevenue = revenueData[0]?.totalRevenue || 0;
    const totalOrders = orderData[0]?.totalOrders || 0;
    const totalCustomers = customerData[0]?.totalCustomers || 0;

    // Get pending orders count for seller
    const pendingOrdersData = await Order.aggregate([
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'prod',
        },
      },
      { $unwind: '$prod' },
      { $match: { 'prod.seller': sellerId, 'items.status': 'pending' } },
      {
        $group: {
          _id: '$_id'
        }
      },
      { $count: 'pendingOrders' }
    ]);
    
    const pendingOrders = pendingOrdersData[0]?.pendingOrders || 0;

    res.json({
      success: true,
      message: 'Dashboard data retrieved successfully',
      data: {
        overview: {
          totalProducts,
          activeProducts,
          totalRevenue,
          totalOrders,
          totalCustomers,
          lowStockProducts,
          pendingOrders
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

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid productId' 
      });
    }

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

    const validProductIds = productIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validProductIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid product IDs provided'
      });
    }

    if (validProductIds.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update more than 100 products at once'
      });
    }

    // Normalize updateData
    const data = { ...updateData };
    if (data.tags) {
      data.tags = normalizeTags(data.tags);
    }
    if (data.price != null) data.price = Number(data.price);
    if (data.originalPrice != null) data.originalPrice = Number(data.originalPrice);
    if (data.stock != null) data.stock = Number(data.stock);
    if (data.costPerItem != null) data.costPerItem = Number(data.costPerItem);

    // Recompute discount if relevant
    if (data.price != null && data.originalPrice != null && data.originalPrice > 0) {
      data.discountPercentage = Math.round(((data.originalPrice - data.price) / data.originalPrice) * 100);
    }

    const result = await Product.updateMany(
      { _id: { $in: validProductIds }, seller: sellerId },
      { $set: data }
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

    if (format === 'csv') {
      const fields = ['_id', 'name', 'price', 'stock', 'status', 'slug', 'createdAt', 'updatedAt'];
      const lines = [
        fields.join(','),
        ...products.map(p => fields.map(f => {
          const val = p[f] ?? '';
          // CSV-escape
          const s = (val instanceof Date) ? val.toISOString() : String(val);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(','))
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
      return res.send(lines.join('\n'));
    }

    res.json({
      success: true,
      message: 'Products exported successfully',
      data: {
        products,
        totalProducts: products.length,
        exportDate: new Date().toISOString()
      }
    });

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
  validateProduct,       // array of validators
  uploadProduct,
  getMyProducts,
  updateProduct,
  deleteProduct,
  getSellerDashboard,
  getProductAnalytics,
  bulkUpdateProducts,
  exportProducts
};