const Redis = require('redis');
const mongoose = require('mongoose');

// Redis Cache System for High Performance E-commerce
class RedisCacheSystem {
  
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.initialize();
  }

  async initialize() {
    try {
      this.client = Redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB || 0,
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableReadyCheck: true,
        lazyConnect: true
      });

      this.client.on('connect', () => {
        console.log('✅ Redis Cache System connected successfully');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('❌ Redis connection error:', err);
        this.isConnected = false;
      });

      this.client.on('ready', () => {
        console.log('🚀 Redis Cache System ready for operations');
        this.setupCacheStrategies();
      });

      await this.client.connect();

    } catch (error) {
      console.error('Redis initialization failed:', error);
      this.isConnected = false;
    }
  }

  // Cache key generators
  generateKey(prefix, identifier) {
    return `quicklocal:${prefix}:${identifier}`;
  }

  // Product caching strategies
  async cacheProduct(product, ttl = 3600) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey('product', product._id);
      const productData = JSON.stringify({
        ...product.toObject(),
        cached_at: new Date()
      });
      
      await this.client.setEx(key, ttl, productData);
      
      // Cache product in category list
      if (product.category) {
        const categoryKey = this.generateKey('category_products', product.category);
        await this.client.zAdd(categoryKey, {
          score: product.averageRating || 0,
          value: product._id.toString()
        });
        await this.client.expire(categoryKey, ttl);
      }

      // Cache for search
      const searchKey = this.generateKey('search_products', product.name.toLowerCase().replace(/\s+/g, '_'));
      await this.client.setEx(searchKey, ttl, product._id.toString());

      return true;
    } catch (error) {
      console.error('Product caching error:', error);
      return false;
    }
  }

  async getCachedProduct(productId) {
    if (!this.isConnected) return null;
    
    try {
      const key = this.generateKey('product', productId);
      const cachedData = await this.client.get(key);
      
      if (cachedData) {
        const product = JSON.parse(cachedData);
        
        // Update view count asynchronously
        this.incrementProductViews(productId);
        
        return product;
      }
      
      return null;
    } catch (error) {
      console.error('Get cached product error:', error);
      return null;
    }
  }

  // Category caching
  async cacheCategoryProducts(categoryId, products, page = 1, limit = 20) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey('category_page', `${categoryId}_${page}_${limit}`);
      const cacheData = {
        products,
        cached_at: new Date(),
        page,
        limit,
        total: products.length
      };
      
      await this.client.setEx(key, 1800, JSON.stringify(cacheData)); // 30 minutes
      return true;
    } catch (error) {
      console.error('Category caching error:', error);
      return false;
    }
  }

  async getCachedCategoryProducts(categoryId, page = 1, limit = 20) {
    if (!this.isConnected) return null;
    
    try {
      const key = this.generateKey('category_page', `${categoryId}_${page}_${limit}`);
      const cachedData = await this.client.get(key);
      
      return cachedData ? JSON.parse(cachedData) : null;
    } catch (error) {
      console.error('Get cached category error:', error);
      return null;
    }
  }

  // Search results caching
  async cacheSearchResults(query, filters, results, page = 1, limit = 20) {
    if (!this.isConnected) return false;
    
    try {
      const filterHash = Buffer.from(JSON.stringify(filters)).toString('base64');
      const key = this.generateKey('search', `${query}_${filterHash}_${page}_${limit}`);
      
      const cacheData = {
        query,
        filters,
        results,
        page,
        limit,
        cached_at: new Date(),
        total: results.pagination?.totalProducts || 0
      };
      
      await this.client.setEx(key, 600, JSON.stringify(cacheData)); // 10 minutes
      return true;
    } catch (error) {
      console.error('Search caching error:', error);
      return false;
    }
  }

  async getCachedSearchResults(query, filters, page = 1, limit = 20) {
    if (!this.isConnected) return null;
    
    try {
      const filterHash = Buffer.from(JSON.stringify(filters)).toString('base64');
      const key = this.generateKey('search', `${query}_${filterHash}_${page}_${limit}`);
      const cachedData = await this.client.get(key);
      
      return cachedData ? JSON.parse(cachedData) : null;
    } catch (error) {
      console.error('Get cached search error:', error);
      return null;
    }
  }

  // Session management
  async cacheUserSession(userId, sessionData, ttl = 86400) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey('session', userId);
      const sessionInfo = {
        ...sessionData,
        last_activity: new Date(),
        user_id: userId
      };
      
      await this.client.setEx(key, ttl, JSON.stringify(sessionInfo));
      return true;
    } catch (error) {
      console.error('Session caching error:', error);
      return false;
    }
  }

  async getCachedUserSession(userId) {
    if (!this.isConnected) return null;
    
    try {
      const key = this.generateKey('session', userId);
      const sessionData = await this.client.get(key);
      
      if (sessionData) {
        const session = JSON.parse(sessionData);
        
        // Update last activity
        session.last_activity = new Date();
        await this.client.setEx(key, 86400, JSON.stringify(session));
        
        return session;
      }
      
      return null;
    } catch (error) {
      console.error('Get cached session error:', error);
      return null;
    }
  }

  // Cart caching for real-time updates
  async cacheUserCart(userId, cartData, ttl = 3600) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey('cart', userId);
      const cartInfo = {
        ...cartData,
        updated_at: new Date(),
        user_id: userId
      };
      
      await this.client.setEx(key, ttl, JSON.stringify(cartInfo));
      
      // Also cache cart items count for quick access
      const countKey = this.generateKey('cart_count', userId);
      const itemCount = cartData.items?.length || 0;
      await this.client.setEx(countKey, ttl, itemCount.toString());
      
      return true;
    } catch (error) {
      console.error('Cart caching error:', error);
      return false;
    }
  }

  async getCachedUserCart(userId) {
    if (!this.isConnected) return null;
    
    try {
      const key = this.generateKey('cart', userId);
      const cartData = await this.client.get(key);
      
      return cartData ? JSON.parse(cartData) : null;
    } catch (error) {
      console.error('Get cached cart error:', error);
      return null;
    }
  }

  // Wishlist caching
  async cacheUserWishlist(userId, wishlistData, ttl = 7200) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey('wishlist', userId);
      await this.client.setEx(key, ttl, JSON.stringify(wishlistData));
      return true;
    } catch (error) {
      console.error('Wishlist caching error:', error);
      return false;
    }
  }

  // Recently viewed products
  async addRecentlyViewed(userId, productId) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey('recently_viewed', userId);
      
      // Add to list with timestamp as score
      await this.client.zAdd(key, {
        score: Date.now(),
        value: productId.toString()
      });
      
      // Keep only last 20 items
      await this.client.zRemRangeByRank(key, 0, -21);
      
      // Set expiration
      await this.client.expire(key, 86400 * 7); // 7 days
      
      return true;
    } catch (error) {
      console.error('Recently viewed caching error:', error);
      return false;
    }
  }

  async getRecentlyViewed(userId, limit = 10) {
    if (!this.isConnected) return [];
    
    try {
      const key = this.generateKey('recently_viewed', userId);
      const productIds = await this.client.zRevRange(key, 0, limit - 1);
      
      return productIds;
    } catch (error) {
      console.error('Get recently viewed error:', error);
      return [];
    }
  }

  // Popular products caching
  async updatePopularProducts() {
    if (!this.isConnected) return false;
    
    try {
      const Product = mongoose.model('Product');
      
      // Get trending products based on views and ratings
      const trendingProducts = await Product.find({
        status: 'active',
        stock: { $gt: 0 }
      })
      .sort({ 
        views: -1, 
        averageRating: -1, 
        createdAt: -1 
      })
      .limit(100)
      .lean();

      const key = this.generateKey('popular_products', 'trending');
      await this.client.setEx(key, 3600, JSON.stringify(trendingProducts)); // 1 hour
      
      return true;
    } catch (error) {
      console.error('Popular products update error:', error);
      return false;
    }
  }

  async getPopularProducts(limit = 20) {
    if (!this.isConnected) return [];
    
    try {
      const key = this.generateKey('popular_products', 'trending');
      const cachedData = await this.client.get(key);
      
      if (cachedData) {
        const products = JSON.parse(cachedData);
        return products.slice(0, limit);
      }
      
      return [];
    } catch (error) {
      console.error('Get popular products error:', error);
      return [];
    }
  }

  // Product view tracking
  async incrementProductViews(productId) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey('product_views', productId);
      const dailyKey = this.generateKey('daily_views', `${productId}_${new Date().toISOString().split('T')[0]}`);
      
      // Increment total views
      await this.client.incr(key);
      
      // Increment daily views
      await this.client.incr(dailyKey);
      await this.client.expire(dailyKey, 86400 * 7); // Keep for 7 days
      
      return true;
    } catch (error) {
      console.error('Product views increment error:', error);
      return false;
    }
  }

  // Real-time stock tracking
  async updateProductStock(productId, newStock) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateKey('stock', productId);
      await this.client.set(key, newStock.toString());
      
      // Cache stock status
      const statusKey = this.generateKey('stock_status', productId);
      const status = newStock > 0 ? 'in_stock' : 'out_of_stock';
      await this.client.setEx(statusKey, 300, status); // 5 minutes
      
      // If low stock, add to alert list
      if (newStock <= 5 && newStock > 0) {
        const lowStockKey = this.generateKey('low_stock', 'alert');
        await this.client.sAdd(lowStockKey, productId.toString());
        await this.client.expire(lowStockKey, 3600);
      }
      
      return true;
    } catch (error) {
      console.error('Stock update error:', error);
      return false;
    }
  }

  async getProductStock(productId) {
    if (!this.isConnected) return null;
    
    try {
      const key = this.generateKey('stock', productId);
      const stock = await this.client.get(key);
      
      return stock ? parseInt(stock) : null;
    } catch (error) {
      console.error('Get stock error:', error);
      return null;
    }
  }

  // Cache invalidation strategies
  async invalidateProductCache(productId) {
    if (!this.isConnected) return false;
    
    try {
      const keys = [
        this.generateKey('product', productId),
        this.generateKey('stock', productId),
        this.generateKey('stock_status', productId)
      ];
      
      await Promise.all(keys.map(key => this.client.del(key)));
      
      // Clear related search and category caches
      const searchPattern = this.generateKey('search', '*');
      const categoryPattern = this.generateKey('category_page', '*');
      
      const searchKeys = await this.client.keys(searchPattern);
      const categoryKeys = await this.client.keys(categoryPattern);
      
      if (searchKeys.length > 0) await this.client.del(searchKeys);
      if (categoryKeys.length > 0) await this.client.del(categoryKeys);
      
      return true;
    } catch (error) {
      console.error('Cache invalidation error:', error);
      return false;
    }
  }

  // Performance monitoring
  async getCacheStats() {
    if (!this.isConnected) return null;
    
    try {
      const info = await this.client.info('memory');
      const keyspace = await this.client.info('keyspace');
      
      return {
        memory_usage: info,
        keyspace_info: keyspace,
        connected: this.isConnected,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Cache stats error:', error);
      return null;
    }
  }

  // Setup automated cache strategies
  setupCacheStrategies() {
    // Update popular products every hour
    setInterval(() => {
      this.updatePopularProducts();
    }, 3600000);

    // Clear expired sessions every 6 hours
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 21600000);

    console.log('🔄 Cache strategies initialized');
  }

  async cleanupExpiredSessions() {
    if (!this.isConnected) return;
    
    try {
      const pattern = this.generateKey('session', '*');
      const keys = await this.client.keys(pattern);
      
      for (const key of keys) {
        const ttl = await this.client.ttl(key);
        if (ttl < 0) {
          await this.client.del(key);
        }
      }
      
      console.log(`🧹 Cleaned up expired sessions: ${keys.length} checked`);
    } catch (error) {
      console.error('Session cleanup error:', error);
    }
  }

  // Graceful shutdown
  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      console.log('🔌 Redis Cache System disconnected');
    }
  }
}

// Create singleton instance
const cacheSystem = new RedisCacheSystem();

// Middleware for caching
const cacheMiddleware = {
  // Product caching middleware
  productCache: (ttl = 3600) => {
    return async (req, res, next) => {
      const productId = req.params.id;
      if (!productId) return next();
      
      try {
        const cachedProduct = await cacheSystem.getCachedProduct(productId);
        
        if (cachedProduct) {
          return res.json({
            success: true,
            product: cachedProduct,
            cached: true
          });
        }
        
        // Store original res.json
        const originalJson = res.json.bind(res);
        
        // Override res.json to cache response
        res.json = function(data) {
          if (data.success && data.product) {
            cacheSystem.cacheProduct(data.product, ttl);
          }
          return originalJson(data);
        };
        
        next();
      } catch (error) {
        console.error('Product cache middleware error:', error);
        next();
      }
    };
  },

  // Search results caching
  searchCache: (ttl = 600) => {
    return async (req, res, next) => {
      const { q, category, priceRange, availability, sortBy, page = 1, limit = 20 } = req.query;
      
      if (!q) return next();
      
      try {
        const filters = { category, priceRange, availability, sortBy };
        const cachedResults = await cacheSystem.getCachedSearchResults(q, filters, page, limit);
        
        if (cachedResults) {
          return res.json({
            success: true,
            ...cachedResults,
            cached: true
          });
        }
        
        const originalJson = res.json.bind(res);
        
        res.json = function(data) {
          if (data.success && data.products) {
            cacheSystem.cacheSearchResults(q, filters, data, page, limit);
          }
          return originalJson(data);
        };
        
        next();
      } catch (error) {
        console.error('Search cache middleware error:', error);
        next();
      }
    };
  },

  // Session caching
  sessionCache: (ttl = 86400) => {
    return async (req, res, next) => {
      const userId = req.user?.id;
      if (!userId) return next();
      
      try {
        const cachedSession = await cacheSystem.getCachedUserSession(userId);
        
        if (cachedSession) {
          req.cachedSession = cachedSession;
        }
        
        next();
      } catch (error) {
        console.error('Session cache middleware error:', error);
        next();
      }
    };
  }
};

module.exports = {
  RedisCacheSystem,
  cacheSystem,
  cacheMiddleware
};
