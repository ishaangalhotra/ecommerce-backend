const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const router = express.Router();

// ==================== GET ALL PRODUCTS ====================
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      search,
      minPrice,
      maxPrice,
      sort = 'newest',
      inStock
    } = req.query;

    // Build query filters
    const filters = { status: 'active' };
    
    if (category) {
      // Handle both category ID and slug
      if (mongoose.isValidObjectId(category)) {
        filters.category = category;
      } else {
        const categoryDoc = await Category.findOne({ slug: category });
        if (categoryDoc) {
          filters.category = categoryDoc._id;
        }
      }
    }
    
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = parseFloat(minPrice);
      if (maxPrice) filters.price.$lte = parseFloat(maxPrice);
    }
    
    if (inStock === 'true') {
      filters.stock = { $gt: 0 };
    }

    // Build sort query
    let sortQuery = {};
    switch (sort) {
      case 'price_low':
        sortQuery = { price: 1 };
        break;
      case 'price_high':
        sortQuery = { price: -1 };
        break;
      case 'rating':
        sortQuery = { averageRating: -1 };
        break;
      case 'popular':
        sortQuery = { totalSales: -1 };
        break;
      case 'newest':
      default:
        sortQuery = { createdAt: -1 };
        break;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute queries
    let productsQuery;
    
    if (search) {
      // Text search
      productsQuery = Product.searchProducts(search, filters);
    } else {
      // Regular query
      productsQuery = Product.find(filters);
    }

    const [products, totalProducts] = await Promise.all([
      productsQuery
        .populate('category', 'name slug')
        .populate('seller', 'name rating verified')
        .sort(sortQuery)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(), // Use lean() for better performance
      
      Product.countDocuments(search ? { ...filters, $text: { $search: search } } : filters)
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalProducts / parseInt(limit));
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    res.json({
      success: true,
      message: 'Products retrieved successfully',
      data: {
        products: products.map(product => ({
          id: product._id,
          name: product.name,
          price: product.price,
          finalPrice: product.discountPercentage > 0 
            ? product.price - (product.price * product.discountPercentage / 100)
            : product.price,
          discountPercentage: product.discountPercentage,
          isOnSale: product.discountPercentage > 0,
          images: product.images.slice(0, 2), // Only send first 2 images for list view
          stock: product.stock,
          isInStock: product.stock > 0,
          averageRating: product.averageRating,
          totalReviews: product.totalReviews,
          category: product.category,
          seller: product.seller,
          slug: product.slug,
          deliveryTime: product.deliveryInfo?.preparationTime || 10
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalProducts,
          hasNextPage,
          hasPrevPage,
          limit: parseInt(limit)
        },
        filters: {
          category,
          search,
          minPrice,
          maxPrice,
          sort,
          inStock
        }
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving products',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== GET SINGLE PRODUCT ====================
router.get('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Check if identifier is ObjectId or slug
    const isObjectId = mongoose.isValidObjectId(identifier);
    const query = isObjectId ? { _id: identifier } : { slug: identifier };
    
    const product = await Product.findOne({ ...query, status: 'active' })
      .populate('category', 'name slug description')
      .populate('seller', 'name rating verified')
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        requestId: req.requestId
      });
    }

    // Increment views (fire and forget)
    Product.updateOne({ _id: product._id }, { $inc: { views: 1 } }).exec();

    // Get related products
    const relatedProducts = await Product.find({
      category: product.category._id,
      _id: { $ne: product._id },
      status: 'active'
    })
    .select('name price discountPercentage images averageRating slug')
    .limit(8)
    .lean();

    res.json({
      success: true,
      message: 'Product retrieved successfully',
      data: {
        product: {
          id: product._id,
          name: product.name,
          description: product.description,
          price: product.price,
          finalPrice: product.discountPercentage > 0 
            ? product.price - (product.price * product.discountPercentage / 100)
            : product.price,
          discountPercentage: product.discountPercentage,
          isOnSale: product.discountPercentage > 0,
          images: product.images,
          stock: product.stock,
          isInStock: product.stock > 0,
          unit: product.unit,
          weight: product.weight,
          dimensions: product.dimensions,
          averageRating: product.averageRating,
          totalReviews: product.totalReviews,
          category: product.category,
          seller: product.seller,
          slug: product.slug,
          brand: product.brand,
          sku: product.sku,
          specifications: product.specifications,
          tags: product.tags,
          deliveryInfo: product.deliveryInfo,
          views: product.views,
          createdAt: product.createdAt
        },
        relatedProducts: relatedProducts.map(p => ({
          id: p._id,
          name: p.name,
          price: p.price,
          finalPrice: p.discountPercentage > 0 
            ? p.price - (p.price * p.discountPercentage / 100)
            : p.price,
          discountPercentage: p.discountPercentage,
          images: p.images.slice(0, 1),
          averageRating: p.averageRating,
          slug: p.slug
        }))
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving product',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== GET PRODUCTS BY CATEGORY ====================
router.get('/category/:categorySlug', async (req, res) => {
  try {
    const { categorySlug } = req.params;
    const { page = 1, limit = 20, sort = 'newest' } = req.query;

    // Find category
    const category = await Category.findOne({ 
      slug: categorySlug, 
      isActive: true 
    }).lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
        requestId: req.requestId
      });
    }

    // Get products in category
    const products = await Product.getProductsByCategory(category._id, {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: sort === 'price_low' ? { price: 1 } : 
            sort === 'price_high' ? { price: -1 } :
            sort === 'popular' ? { totalSales: -1 } : { createdAt: -1 }
    });

    const totalProducts = await Product.countDocuments({
      category: category._id,
      status: 'active'
    });

    res.json({
      success: true,
      message: `Products in ${category.name} category`,
      data: {
        category: {
          id: category._id,
          name: category.name,
          slug: category.slug,
          description: category.description
        },
        products: products.map(product => ({
          id: product._id,
          name: product.name,
          price: product.price,
          finalPrice: product.discountPercentage > 0 
            ? product.price - (product.price * product.discountPercentage / 100)
            : product.price,
          discountPercentage: product.discountPercentage,
          images: product.images.slice(0, 1),
          stock: product.stock,
          averageRating: product.averageRating,
          totalReviews: product.totalReviews,
          seller: product.seller,
          slug: product.slug
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalProducts / parseInt(limit)),
          totalProducts,
          limit: parseInt(limit)
        }
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Get category products error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving category products',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== SEARCH PRODUCTS ====================
router.get('/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
        requestId: req.requestId
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const products = await Product.searchProducts(q.trim())
      .populate('category', 'name slug')
      .populate('seller', 'name rating verified')
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalResults = await Product.countDocuments({
      $text: { $search: q.trim() },
      status: 'active'
    });

    res.json({
      success: true,
      message: 'Search completed successfully',
      data: {
        query: q.trim(),
        products: products.map(product => ({
          id: product._id,
          name: product.name,
          price: product.price,
          finalPrice: product.discountPercentage > 0 
            ? product.price - (product.price * product.discountPercentage / 100)
            : product.price,
          discountPercentage: product.discountPercentage,
          images: product.images.slice(0, 1),
          stock: product.stock,
          averageRating: product.averageRating,
          category: product.category,
          seller: product.seller,
          slug: product.slug
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalResults / parseInt(limit)),
          totalResults,
          limit: parseInt(limit)
        }
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching products',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== CREATE SAMPLE DATA ====================
router.post('/create-sample-data', async (req, res) => {
  try {
    // Check if data already exists
    const existingProducts = await Product.countDocuments();
    if (existingProducts > 0) {
      return res.json({
        success: true,
        message: 'Sample data already exists',
        count: existingProducts
      });
    }

    // Create sample categories
    const categories = await Category.insertMany([
      { name: 'Electronics', description: 'Electronic devices and gadgets' },
      { name: 'Clothing', description: 'Fashion and apparel' },
      { name: 'Home & Garden', description: 'Home and garden essentials' },
      { name: 'Books', description: 'Books and educational materials' },
      { name: 'Sports', description: 'Sports and fitness equipment' }
    ]);

    // Create sample user (seller) - you might want to use an existing user ID
    const sampleSellerId = new mongoose.Types.ObjectId();

    // Create sample products
    const sampleProducts = [
      {
        name: 'Smartphone Pro Max',
        description: 'Latest smartphone with advanced features and high-quality camera',
        price: 59999,
        discountPercentage: 10,
        images: [
          { url: 'https://via.placeholder.com/400x400?text=Phone+1', alt: 'Smartphone front view' },
          { url: 'https://via.placeholder.com/400x400?text=Phone+2', alt: 'Smartphone back view' }
        ],
        category: categories[0]._id, // Electronics
        seller: sampleSellerId,
        stock: 50,
        unit: 'piece',
        weight: 0.2,
        brand: 'TechBrand',
        tags: ['smartphone', 'mobile', 'electronics', 'communication'],
        status: 'active',
        averageRating: 4.5,
        totalReviews: 128,
        specifications: new Map([
          ['Display', '6.7-inch OLED'],
          ['Storage', '256GB'],
          ['RAM', '8GB'],
          ['Camera', '108MP Triple Camera']
        ])
      },
      {
        name: 'Wireless Headphones',
        description: 'Premium noise-cancelling wireless headphones with long battery life',
        price: 8999,
        discountPercentage: 15,
        images: [
          { url: 'https://via.placeholder.com/400x400?text=Headphones', alt: 'Wireless headphones' }
        ],
        category: categories[0]._id, // Electronics
        seller: sampleSellerId,
        stock: 75,
        unit: 'piece',
        weight: 0.3,
        brand: 'AudioMax',
        tags: ['headphones', 'wireless', 'audio', 'music'],
        status: 'active',
        averageRating: 4.2,
        totalReviews: 89
      },
      {
        name: 'Cotton T-Shirt',
        description: 'Comfortable 100% cotton t-shirt available in multiple colors',
        price: 799,
        discountPercentage: 20,
        images: [
          { url: 'https://via.placeholder.com/400x400?text=T-Shirt', alt: 'Cotton t-shirt' }
        ],
        category: categories[1]._id, // Clothing
        seller: sampleSellerId,
        stock: 100,
        unit: 'piece',
        weight: 0.2,
        brand: 'FashionCo',
        tags: ['clothing', 'cotton', 'casual', 'comfortable'],
        status: 'active',
        averageRating: 4.0,
        totalReviews: 45
      },
      {
        name: 'Coffee Maker',
        description: 'Automatic coffee maker with programmable timer and thermal carafe',
        price: 4999,
        images: [
          { url: 'https://via.placeholder.com/400x400?text=Coffee+Maker', alt: 'Coffee maker' }
        ],
        category: categories[2]._id, // Home & Garden
        seller: sampleSellerId,
        stock: 25,
        unit: 'piece',
        weight: 2.5,
        brand: 'BrewMaster',
        tags: ['coffee', 'kitchen', 'appliance', 'home'],
        status: 'active',
        averageRating: 4.3,
        totalReviews: 67
      },
      {
        name: 'Programming Book',
        description: 'Complete guide to modern web development with practical examples',
        price: 1299,
        images: [
          { url: 'https://via.placeholder.com/400x400?text=Programming+Book', alt: 'Programming book' }
        ],
        category: categories[3]._id, // Books
        seller: sampleSellerId,
        stock: 200,
        unit: 'piece',
        weight: 0.8,
        brand: 'TechPublishing',
        tags: ['programming', 'education', 'web development', 'learning'],
        status: 'active',
        averageRating: 4.7,
        totalReviews: 156
      }
    ];

    const products = await Product.insertMany(sampleProducts);

    res.status(201).json({
      success: true,
      message: 'Sample data created successfully',
      data: {
        categoriesCreated: categories.length,
        productsCreated: products.length,
        categories: categories.map(c => ({ id: c._id, name: c.name, slug: c.slug })),
        sampleProductIds: products.map(p => p._id)
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Create sample data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating sample data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== TEST HEALTH ====================
router.get('/test/health', (req, res) => {
  res.json({
    success: true,
    message: 'Products route with MongoDB is healthy!',
    database: 'Connected',
    redis: process.env.DISABLE_REDIS === 'true' ? 'disabled' : 'enabled',
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  });
});

module.exports = router;