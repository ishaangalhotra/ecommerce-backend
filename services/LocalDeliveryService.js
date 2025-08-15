const ProductEnhanced = require('../models/ProductEnhanced');
const redis = require('../config/redis');
const logger = require('../utils/logger');

class LocalDeliveryService {
  
  /**
   * Find products near user location with delivery capability
   */
  static async findNearbyProducts(userLocation, options = {}) {
    const {
      maxDistance = 10000,
      maxDeliveryTime = 25,
      category,
      minRating = 0,
      sortBy = 'distance',
      limit = 20,
      skip = 0
    } = options;
    
    // Try cache first
    const cacheKey = this.generateCacheKey(userLocation, options);
    try {
      const cached = await redis.publisher.get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        logger.info('Cache hit for nearby products', { cacheKey });
        return data;
      }
    } catch (error) {
      logger.warn('Cache read failed:', error.message);
    }
    
    try {
      // Build aggregation pipeline
      const pipeline = [
        // Geospatial query - find products within distance
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [userLocation.lng, userLocation.lat]
            },
            distanceField: "deliveryDistance",
            maxDistance: maxDistance,
            spherical: true,
            query: { 
              "deliveryConfig.isLocalDeliveryEnabled": true,
              "stock": { $gt: 0 }, 
              "status": "active",
              ...(category && { "category": category })
            }
          }
        },
        
        // Populate seller information
        {
          $lookup: {
            from: 'users',
            localField: 'seller',
            foreignField: '_id',
            as: 'sellerInfo',
            pipeline: [
              {
                $project: {
                  businessName: 1,
                  rating: 1,
                  totalOrders: 1,
                  profileImage: 1,
                  isVerified: 1
                }
              }
            ]
          }
        },
        
        // Calculate delivery details
        {
          $addFields: {
            seller: { $arrayElemAt: ["$sellerInfo", 0] },
            estimatedDeliveryTime: {
              $add: [
                "$deliveryConfig.preparationTime",
                { $ceil: { $divide: ["$deliveryDistance", 250] } } // ~15 km/h
              ]
            },
            deliveryFee: {
              $cond: {
                if: { $lte: ["$deliveryDistance", 2000] },
                then: 0,
                else: { $ifNull: ["$deliveryConfig.deliveryFee", 25] }
              }
            }
          }
        },
        
        // Filter by delivery time and rating
        {
          $match: {
            estimatedDeliveryTime: { $lte: maxDeliveryTime },
            "seller.rating": { $gte: minRating }
          }
        },
        
        // Sort based on preference
        {
          $sort: this.getSortCriteria(sortBy)
        },
        
        // Pagination
        { $skip: skip },
        { $limit: limit },
        
        // Clean up response
        {
          $project: {
            sellerInfo: 0 // Remove duplicate field
          }
        }
      ];
      
      const products = await ProductEnhanced.aggregate(pipeline);
      
      // Cache results for 5 minutes
      try {
        await redis.publisher.setex(cacheKey, 300, JSON.stringify(products));
        logger.info('Cached nearby products', { cacheKey, count: products.length });
      } catch (error) {
        logger.warn('Cache write failed:', error.message);
      }
      
      return products;
      
    } catch (error) {
      logger.error('Find nearby products failed:', error);
      throw new Error('Unable to fetch nearby products');
    }
  }
  
  /**
   * Check if delivery is possible for a specific product
   */
  static async checkDeliveryFeasibility(productId, userLocation) {
    try {
      const product = await ProductEnhanced.findById(productId);
      if (!product) {
        throw new Error('Product not found');
      }
      
      const deliveryDetails = product.calculateDeliveryDetails([userLocation.lng, userLocation.lat]);
      
      return {
        ...deliveryDetails,
        product: {
          id: product._id,
          name: product.name,
          price: product.price,
          stock: product.stock
        },
        seller: {
          location: product.sellerLocation
        }
      };
      
    } catch (error) {
      logger.error('Delivery feasibility check failed:', error);
      throw error;
    }
  }
  
  /**
   * Get delivery zones for a specific pincode
   */
  static async getDeliveryZones(pincode) {
    try {
      const sellers = await ProductEnhanced.distinct('seller', {
        'sellerLocation.pincode': pincode,
        'deliveryConfig.isLocalDeliveryEnabled': true,
        'status': 'active'
      });
      
      return {
        pincode,
        availableSellers: sellers.length,
        deliveryAvailable: sellers.length > 0
      };
      
    } catch (error) {
      logger.error('Get delivery zones failed:', error);
      throw error;
    }
  }
  
  /**
   * Estimate delivery time for multiple products
   */
  static async estimateDeliveryTime(productIds, userLocation) {
    try {
      const products = await ProductEnhanced.find({
        _id: { $in: productIds },
        'deliveryConfig.isLocalDeliveryEnabled': true,
        'status': 'active',
        'stock': { $gt: 0 }
      });
      
      const estimates = products.map(product => {
        const details = product.calculateDeliveryDetails([userLocation.lng, userLocation.lat]);
        return {
          productId: product._id,
          ...details
        };
      });
      
      // Calculate combined delivery time (max preparation time + travel)
      const maxPreparationTime = Math.max(...estimates.filter(e => e.canDeliver).map(e => e.preparationTime || 10));
      const maxTravelTime = Math.max(...estimates.filter(e => e.canDeliver).map(e => e.travelTime || 5));
      
      return {
        individual: estimates,
        combined: {
          canDeliver: estimates.some(e => e.canDeliver),
          estimatedTime: maxPreparationTime + maxTravelTime,
          totalDeliveryFee: estimates.reduce((sum, e) => sum + (e.deliveryFee || 0), 0)
        }
      };
      
    } catch (error) {
      logger.error('Estimate delivery time failed:', error);
      throw error;
    }
  }
  
  /**
   * Generate cache key for nearby products
   */
  static generateCacheKey(userLocation, options) {
    const key = `nearby:${userLocation.lat.toFixed(4)}:${userLocation.lng.toFixed(4)}:${JSON.stringify(options)}`;
    return key;
  }
  
  /**
   * Get sort criteria based on preference
   */
  static getSortCriteria(sortBy) {
    const sortOptions = {
      'distance': { deliveryDistance: 1, estimatedDeliveryTime: 1 },
      'time': { estimatedDeliveryTime: 1, deliveryDistance: 1 },
      'rating': { "seller.rating": -1, deliveryDistance: 1 },
      'price_low': { price: 1, deliveryDistance: 1 },
      'price_high': { price: -1, deliveryDistance: 1 },
      'popularity': { totalOrders: -1, deliveryDistance: 1 }
    };
    
    return sortOptions[sortBy] || sortOptions['distance'];
  }
  
  /**
   * Invalidate cache when products are updated
   */
  static async invalidateCache(sellerId) {
    try {
      const pattern = 'nearby:*';
      const keys = await redis.publisher.keys(pattern);
      
      if (keys.length > 0) {
        await redis.publisher.del(...keys);
        logger.info('Invalidated nearby products cache', { sellerId, keysCount: keys.length });
      }
    } catch (error) {
      logger.warn('Cache invalidation failed:', error.message);
    }
  }
}

module.exports = LocalDeliveryService;
