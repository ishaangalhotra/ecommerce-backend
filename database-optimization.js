const mongoose = require('mongoose');

// Database Optimization System for High Performance E-commerce
class DatabaseOptimizer {
  
  constructor() {
    this.indexesCreated = false;
    this.performanceMetrics = {
      queryTimes: new Map(),
      indexUsage: new Map(),
      slowQueries: []
    };
  }

  // Create comprehensive indexes for all models
  async createOptimizedIndexes() {
    try {
      console.log('🔧 Creating optimized database indexes...');

      // Product Indexes - Critical for search and filtering
      const Product = mongoose.model('Product');
      await Product.createIndexes([
        // Text search index for name, description, brand, tags
        { 
          name: "text", 
          description: "text", 
          brand: "text", 
          "tags": "text" 
        },
        
        // Compound index for category + price + stock (product listing)
        { category: 1, price: 1, stock: 1 },
        
        // Compound index for category + rating + createdAt (trending products)
        { category: 1, averageRating: -1, createdAt: -1 },
        
        // Status + stock for active products
        { status: 1, stock: 1 },
        
        // Price range queries
        { price: 1 },
        
        // Seller products
        { seller: 1, status: 1, createdAt: -1 },
        
        // Popular products (views + rating)
        { views: -1, averageRating: -1 },
        
        // Recently added products
        { createdAt: -1 },
        
        // Brand filtering
        { brand: 1, status: 1 },
        
        // Stock alerts
        { stock: 1, status: 1 },
        
        // Geographic location (if using geo-based features)
        { "location.coordinates": "2dsphere" }
      ]);

      // User Indexes
      const User = mongoose.model('User');
      await User.createIndexes([
        // Email lookup (login)
        { email: 1 },
        
        // OAuth providers
        { "oauth.googleId": 1 },
        { "oauth.facebookId": 1 },
        
        // Phone number
        { phone: 1 },
        
        // User type and status
        { role: 1, status: 1 },
        
        // Registration date
        { createdAt: -1 },
        
        // Location-based user queries
        { "address.city": 1, "address.state": 1 }
      ]);

      // Order Indexes - Critical for order management
      const Order = mongoose.model('Order');
      await Order.createIndexes([
        // User orders (order history)
        { user: 1, createdAt: -1 },
        
        // Order status tracking
        { status: 1, createdAt: -1 },
        
        // Seller orders
        { "items.seller": 1, status: 1, createdAt: -1 },
        
        // Order number lookup
        { orderNumber: 1 },
        
        // Payment status
        { paymentStatus: 1, createdAt: -1 },
        
        // Delivery tracking
        { "shipping.trackingNumber": 1 },
        
        // Date range queries (reports)
        { createdAt: -1 },
        
        // Compound index for analytics
        { status: 1, paymentStatus: 1, createdAt: -1 }
      ]);

      // Category Indexes
      const Category = mongoose.model('Category');
      await Category.createIndexes([
        // Category lookup
        { slug: 1 },
        { name: 1 },
        
        // Active categories
        { isActive: 1, name: 1 },
        
        // Parent-child relationships
        { parent: 1, isActive: 1 }
      ]);

      // Cart Indexes
      const Cart = mongoose.model('Cart');
      await Cart.createIndexes([
        // User cart lookup
        { user: 1 },
        
        // Active carts
        { user: 1, isActive: 1 },
        
        // Cart expiration cleanup
        { updatedAt: 1, isActive: 1 }
      ]);

      // Wishlist Indexes
      const Wishlist = mongoose.model('Wishlist');
      await Wishlist.createIndexes([
        // User wishlist
        { user: 1 },
        
        // Product in wishlists (popularity tracking)
        { "items.product": 1 }
      ]);

      // Review Indexes
      const Review = mongoose.model('Review');
      await Review.createIndexes([
        // Product reviews
        { product: 1, createdAt: -1 },
        
        // User reviews
        { user: 1, createdAt: -1 },
        
        // Review status
        { isApproved: 1, product: 1, createdAt: -1 },
        
        // Rating-based queries
        { product: 1, rating: -1 }
      ]);

      // Notification Indexes
      const Notification = mongoose.model('Notification');
      await Notification.createIndexes([
        // User notifications
        { user: 1, createdAt: -1 },
        
        // Unread notifications
        { user: 1, isRead: 1, createdAt: -1 },
        
        // Notification type
        { type: 1, user: 1, createdAt: -1 }
      ]);

      // Address Indexes
      const Address = mongoose.model('Address');
      await Address.createIndexes([
        // User addresses
        { user: 1, isDefault: -1 },
        
        // Geographic queries
        { "location.coordinates": "2dsphere" },
        
        // City/state delivery areas
        { city: 1, state: 1 }
      ]);

      // Coupon Indexes
      const Coupon = mongoose.model('Coupon');
      await Coupon.createIndexes([
        // Coupon code lookup
        { code: 1 },
        
        // Active coupons
        { isActive: 1, startDate: 1, endDate: 1 },
        
        // User-specific coupons
        { applicableUsers: 1, isActive: 1 }
      ]);

      // Analytics Indexes
      if (mongoose.models.Analytics) {
        const Analytics = mongoose.model('Analytics');
        await Analytics.createIndexes([
          // Date-based analytics
          { date: -1, type: 1 },
          
          // Event tracking
          { event: 1, date: -1 },
          
          // User behavior
          { userId: 1, event: 1, date: -1 }
        ]);
      }

      this.indexesCreated = true;
      console.log('✅ Database indexes created successfully');
      
      // Create performance monitoring
      this.setupQueryMonitoring();
      
      return true;
    } catch (error) {
      console.error('❌ Error creating database indexes:', error);
      return false;
    }
  }

  // Setup query performance monitoring
  setupQueryMonitoring() {
    // Monitor slow queries
    mongoose.set('debug', (collectionName, method, query, doc) => {
      const start = Date.now();
      
      // Log slow queries (> 100ms)
      setTimeout(() => {
        const duration = Date.now() - start;
        if (duration > 100) {
          this.performanceMetrics.slowQueries.push({
            collection: collectionName,
            method,
            query,
            duration,
            timestamp: new Date()
          });
          
          console.warn(`🐌 Slow query detected: ${collectionName}.${method} (${duration}ms)`);
        }
      }, 0);
    });
  }

  // Memory-based caching system (replacement for Redis)
  createMemoryCache() {
    return new MemoryCacheSystem();
  }

  // Database connection optimization
  optimizeConnection() {
    const options = {
      // Connection pool settings
      maxPoolSize: 10,
      minPoolSize: 2,
      
      // Connection timeout
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      
      // Buffering
      bufferMaxEntries: 0,
      bufferCommands: false,
      
      // Read preference for performance
      readPreference: 'primary',
      
      // Write concern for performance vs durability trade-off
      w: 1,
      j: false, // Don't wait for journal write in development
      
      // Compression
      compressors: ['zlib']
    };

    return options;
  }

  // Get performance statistics
  getPerformanceStats() {
    return {
      indexesCreated: this.indexesCreated,
      slowQueriesCount: this.performanceMetrics.slowQueries.length,
      recentSlowQueries: this.performanceMetrics.slowQueries.slice(-10),
      timestamp: new Date()
    };
  }

  // Optimize specific queries
  getOptimizedAggregations() {
    return {
      // Optimized product search with filters
      productSearch: (query, filters, page = 1, limit = 20) => {
        const pipeline = [];
        
        // Match stage with indexes
        const matchStage = { status: 'active' };
        
        if (query) {
          matchStage.$text = { $search: query };
        }
        
        if (filters.category) {
          matchStage.category = mongoose.Types.ObjectId(filters.category);
        }
        
        if (filters.priceRange) {
          const [min, max] = filters.priceRange.split('-').map(Number);
          matchStage.price = { $gte: min, $lte: max || 999999 };
        }
        
        if (filters.inStock) {
          matchStage.stock = { $gt: 0 };
        }
        
        pipeline.push({ $match: matchStage });
        
        // Add text score for relevance
        if (query) {
          pipeline.push({ $addFields: { score: { $meta: "textScore" } } });
        }
        
        // Lookup category and seller info
        pipeline.push(
          {
            $lookup: {
              from: 'categories',
              localField: 'category',
              foreignField: '_id',
              as: 'categoryInfo'
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'seller',
              foreignField: '_id',
              as: 'sellerInfo',
              pipeline: [{ $project: { name: 1, rating: 1, storeName: 1 } }]
            }
          }
        );
        
        // Sort based on criteria
        let sortStage = {};
        switch (filters.sortBy) {
          case 'price-low':
            sortStage.price = 1;
            break;
          case 'price-high':
            sortStage.price = -1;
            break;
          case 'rating':
            sortStage.averageRating = -1;
            break;
          case 'newest':
            sortStage.createdAt = -1;
            break;
          default:
            if (query) {
              sortStage.score = { $meta: "textScore" };
            } else {
              sortStage.createdAt = -1;
            }
        }
        
        pipeline.push({ $sort: sortStage });
        
        // Pagination
        const skip = (page - 1) * limit;
        pipeline.push({ $skip: skip }, { $limit: limit });
        
        return pipeline;
      },

      // Popular products aggregation
      popularProducts: (limit = 20) => [
        {
          $match: {
            status: 'active',
            stock: { $gt: 0 }
          }
        },
        {
          $addFields: {
            popularityScore: {
              $add: [
                { $multiply: [{ $ifNull: ['$views', 0] }, 0.4] },
                { $multiply: [{ $ifNull: ['$averageRating', 0] }, 20] },
                { $multiply: [{ $ifNull: ['$totalSales', 0] }, 0.3] }
              ]
            }
          }
        },
        { $sort: { popularityScore: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'categories',
            localField: 'category',
            foreignField: '_id',
            as: 'categoryInfo'
          }
        }
      ],

      // User order history with details
      userOrderHistory: (userId, page = 1, limit = 10) => [
        {
          $match: {
            user: mongoose.Types.ObjectId(userId)
          }
        },
        { $sort: { createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'productDetails'
          }
        },
        {
          $addFields: {
            items: {
              $map: {
                input: '$items',
                as: 'item',
                in: {
                  $mergeObjects: [
                    '$$item',
                    {
                      productInfo: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: '$productDetails',
                              cond: { $eq: ['$$this._id', '$$item.product'] }
                            }
                          },
                          0
                        ]
                      }
                    }
                  ]
                }
              }
            }
          }
        },
        {
          $project: {
            productDetails: 0 // Remove the temporary lookup field
          }
        }
      ]
    };
  }
}

// In-Memory Cache System (Redis replacement)
class MemoryCacheSystem {
  constructor(maxSize = 1000, ttlMs = 3600000) { // 1 hour default TTL
    this.cache = new Map();
    this.timers = new Map();
    this.maxSize = maxSize;
    this.defaultTtl = ttlMs;
    this.hits = 0;
    this.misses = 0;
    
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanup(), 300000);
  }

  set(key, value, ttl = this.defaultTtl) {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl
    });

    // Set expiration timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const timer = setTimeout(() => {
      this.delete(key);
    }, ttl);

    this.timers.set(key, timer);
    return true;
  }

  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  delete(key) {
    this.cache.delete(key);
    
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    
    return true;
  }

  clear() {
    this.cache.clear();
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    this.hits = 0;
    this.misses = 0;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.delete(key);
      }
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses) || 0,
      maxSize: this.maxSize
    };
  }

  // Cache popular products
  cachePopularProducts(products, ttl = 3600000) { // 1 hour
    this.set('popular_products', products, ttl);
  }

  getPopularProducts() {
    return this.get('popular_products');
  }

  // Cache search results
  cacheSearchResults(query, filters, results, ttl = 600000) { // 10 minutes
    const key = `search_${Buffer.from(JSON.stringify({query, filters})).toString('base64')}`;
    this.set(key, results, ttl);
  }

  getCachedSearchResults(query, filters) {
    const key = `search_${Buffer.from(JSON.stringify({query, filters})).toString('base64')}`;
    return this.get(key);
  }

  // Cache user session
  cacheUserSession(userId, sessionData, ttl = 86400000) { // 24 hours
    this.set(`session_${userId}`, sessionData, ttl);
  }

  getUserSession(userId) {
    return this.get(`session_${userId}`);
  }

  // Cache product details
  cacheProduct(productId, product, ttl = 3600000) { // 1 hour
    this.set(`product_${productId}`, product, ttl);
  }

  getCachedProduct(productId) {
    return this.get(`product_${productId}`);
  }
}

// Create instances
const dbOptimizer = new DatabaseOptimizer();
const memoryCache = new MemoryCacheSystem();

// Memory cache middleware
const memoryCacheMiddleware = {
  // Product caching
  productCache: (ttl = 3600000) => {
    return async (req, res, next) => {
      const productId = req.params.id;
      if (!productId) return next();

      const cached = memoryCache.getCachedProduct(productId);
      if (cached) {
        return res.json({
          success: true,
          product: cached,
          cached: true
        });
      }

      const originalJson = res.json.bind(res);
      res.json = function(data) {
        if (data.success && data.product) {
          memoryCache.cacheProduct(productId, data.product, ttl);
        }
        return originalJson(data);
      };

      next();
    };
  },

  // Search results caching
  searchCache: (ttl = 600000) => {
    return async (req, res, next) => {
      const { q, category, priceRange, sortBy } = req.query;
      if (!q) return next();

      const filters = { category, priceRange, sortBy };
      const cached = memoryCache.getCachedSearchResults(q, filters);
      
      if (cached) {
        return res.json({
          success: true,
          ...cached,
          cached: true
        });
      }

      const originalJson = res.json.bind(res);
      res.json = function(data) {
        if (data.success && data.products) {
          memoryCache.cacheSearchResults(q, filters, data, ttl);
        }
        return originalJson(data);
      };

      next();
    };
  }
};

module.exports = {
  DatabaseOptimizer,
  MemoryCacheSystem,
  dbOptimizer,
  memoryCache,
  memoryCacheMiddleware
};
