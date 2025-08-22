const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const imagekit = require('../utils/imagekit');


// Upload Product
const uploadProduct = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const {
      name,
      description,
      price,
      comparePrice,
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
    if (allFiles.length) {
      const folder = `products/${sellerId}`;
      const uploads = allFiles.map((f, idx) =>
        imagekit.upload({
          file: f.buffer, // multer.memoryStorage()
          fileName: `${Date.now()}_${idx}_${f.originalname}`.replace(/\s+/g, '_'),
          folder,
          useUniqueFileName: true
        })
      );
      const results = await Promise.all(uploads);
      images = results.map((r, idx) => ({
        url: r.url,
        publicId: r.fileId,        // from ImageKit, for delete later
        alt: r.name || '',         // or leave blank
        isPrimary: idx === 0,      // first image = primary
        order: idx
      }));
    }


    // Create product slug
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + Date.now();

    // Create product
    const product = new Product({
      name,
      description,
      price: parseFloat(price),
      originalPrice: comparePrice ? parseFloat(comparePrice) : null,
      discountPercentage: comparePrice ?
        Math.round(((comparePrice - price) / comparePrice) * 100) : 0,
      images,
      category: categoryDoc._id,
      seller: sellerId,
      stock: parseInt(stock),
      tags,
      status: 'active', // Always save as active for immediate visibility
      slug,
      variants,
      shipping,
      costPerItem: costPerItem ? parseFloat(costPerItem) : null,
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

    // Build query
    const query = { seller: sellerId };
    
    if (status !== 'all') {
      query.status = status;
    }
    
    if (category) {
      query.category = category;
    }
    
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }
    
    if (minStock || maxStock) {
      query.stock = {};
      if (minStock) query.stock.$gte = parseInt(minStock);
      if (maxStock) query.stock.$lte = parseInt(maxStock);
    }

    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [products, totalProducts] = await Promise.all([
      Product.find(query)
        .populate('category', 'name slug')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Product.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalProducts / parseInt(limit));

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
          currentPage: parseInt(page),
          totalPages,
          totalProducts,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1,
          limit: parseInt(limit)
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
    const updateData = req.body;

    // Process uploaded images if any (ImageKit + upload.fields)
    if (req.files && (req.files.images?.length || req.files.image?.length)) {
      const allFiles = [
        ...(req.files.images || []),
        ...(req.files.image || []),
      ];
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

    // Update discount percentage if price changed
    if (updateData.price && updateData.originalPrice) {
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

    const product = await Product.findOneAndDelete({
      _id: productId,
      seller: sellerId
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or you do not have permission to delete it'
      });
    }

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
        timeRange
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
      createdAt: product.createdAt
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

    const result = await Product.updateMany(
      { _id: { $in: productIds }, seller: sellerId },
      updateData
    );

    logger.info('Bulk update completed', {
      sellerId,
      updatedCount: result.modifiedCount,
      totalProducts: productIds.length
    });

    res.json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} products`,
      data: {
        updatedCount: result.modifiedCount,
        totalProducts: productIds.length
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
  exportProducts
};