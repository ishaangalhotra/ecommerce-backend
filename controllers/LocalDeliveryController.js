const LocalDeliveryService = require('../services/LocalDeliveryService');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const asyncHandler = require('../middleware/asyncHandler');

class LocalDeliveryController {
  
  /**
   * Get nearby products with local delivery
   * GET /api/v2/delivery/nearby-products
   */
  static getNearbyProducts = asyncHandler(async (req, res) => {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { 
      latitude, 
      longitude, 
      maxDistance, 
      category, 
      minPrice,
      maxPrice,
      sortBy,
      limit,
      page 
    } = req.query;
    
    const userLocation = {
      lat: parseFloat(latitude),
      lng: parseFloat(longitude)
    };
    
    const options = {
      maxDistance: parseInt(maxDistance) || 10000,
      category,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      sortBy: sortBy || 'distance',
      limit: parseInt(limit) || 20,
      skip: (parseInt(page) - 1 || 0) * (parseInt(limit) || 20)
    };
    
    const products = await LocalDeliveryService.findNearbyProducts(userLocation, options);
    
    res.json({
      success: true,
      count: products.length,
      data: products,
      meta: {
        userLocation,
        searchRadius: `${options.maxDistance/1000}km`,
        sortBy: options.sortBy,
        page: parseInt(page) || 1,
        limit: options.limit
      }
    });
    
    // Log for analytics
    logger.info('Nearby products fetched', {
      userId: req.user?.id,
      location: userLocation,
      count: products.length,
      searchRadius: options.maxDistance
    });
  });
  
  /**
   * Check delivery feasibility for a product
   * POST /api/v2/delivery/check/:productId
   */
  static checkDelivery = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { latitude, longitude } = req.body;
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const userLocation = { lat: latitude, lng: longitude };
    
    const deliveryInfo = await LocalDeliveryService.checkDeliveryFeasibility(
      productId, 
      userLocation
    );
    
    res.json({
      success: true,
      data: deliveryInfo,
      timestamp: new Date().toISOString()
    });
    
    logger.info('Delivery feasibility checked', {
      userId: req.user?.id,
      productId,
      location: userLocation,
      canDeliver: deliveryInfo.canDeliver
    });
  });
  
  /**
   * Get available delivery slots
   * GET /api/v2/delivery/slots/:productId
   */
  static getDeliverySlots = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { date } = req.query;
    
    const targetDate = date ? new Date(date) : new Date();
    
    const slots = await LocalDeliveryService.getAvailableSlots(productId, targetDate);
    
    res.json({
      success: true,
      data: slots
    });
  });
  
  /**
   * Estimate delivery for cart items
   * POST /api/v2/delivery/estimate-cart
   */
  static estimateCartDelivery = asyncHandler(async (req, res) => {
    const { items, latitude, longitude } = req.body;
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const userLocation = { lat: latitude, lng: longitude };
    
    const estimate = await LocalDeliveryService.estimateCartDelivery(items, userLocation);
    
    res.json({
      success: true,
      data: estimate,
      timestamp: new Date().toISOString()
    });
    
    logger.info('Cart delivery estimated', {
      userId: req.user?.id,
      itemCount: items.length,
      canDeliver: estimate.canDeliver,
      estimatedTime: estimate.estimatedTime
    });
  });
  
  /**
   * Get delivery zones for a pincode
   * GET /api/v2/delivery/zones/:pincode
   */
  static getDeliveryZones = asyncHandler(async (req, res) => {
    const { pincode } = req.params;
    
    // This is a placeholder - you can implement based on your business logic
    const zones = {
      pincode,
      deliveryAvailable: true,
      estimatedTime: '15-25 minutes',
      deliveryFee: 25,
      freeDeliveryThreshold: 500,
      expressDeliveryAvailable: true
    };
    
    res.json({
      success: true,
      data: zones
    });
  });
}

module.exports = LocalDeliveryController;
