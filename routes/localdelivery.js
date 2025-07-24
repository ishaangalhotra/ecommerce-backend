const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const LocalDeliveryController = require('../controllers/LocalDeliveryController');
const { protect, authorize } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { validateDeliveryParameters } = require('../middleware/deliveryValidation');
const { cacheMiddleware } = require('../middleware/cache');

const router = express.Router();

// Enhanced rate limiting with Redis store
const createRateLimiter = (windowMs, max, keyPrefix) => rateLimit({
  windowMs,
  max,
  store: new rateLimit.RedisStore({
    client: redis,
    prefix: `rate_limit:${keyPrefix}`
  }),
  keyGenerator: (req) => {
    return `${req.ip}:${req.user?.id || 'guest'}`;
  },
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for ${req.ip} on ${keyPrefix}`);
    res.status(429).json({ 
      success: false, 
      error: 'Too many requests, please try again later',
      retryAfter: Math.ceil(windowMs / 1000)
    });
  }
});

// Rate limiters for different endpoints
const generalDeliveryLimiter = createRateLimiter(15 * 60 * 1000, 100, 'delivery');
const estimateLimiter = createRateLimiter(60 * 1000, 20, 'estimate');
const trackingLimiter = createRateLimiter(60 * 1000, 30, 'tracking');

// Common validation chains
const geoCoordinatesValidation = [
  query('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude (-90 to 90)')
    .toFloat(),
  
  query('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude (-180 to 180)')
    .toFloat()
];

const mongoIdValidation = (field) => [
  param(field)
    .isMongoId()
    .withMessage(`Invalid ${field} format`)
];

const pincodeValidation = [
  param('pincode')
    .matches(/^[1-9][0-9]{5}$/)
    .withMessage('Invalid 6-digit pincode format')
    .customSanitizer(value => value.trim())
];

// Enhanced request validation middleware
const validateRequest = (validations) => [
  validations,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.debug('Validation errors:', { 
        path: req.path,
        errors: errors.array(),
        body: req.body,
        params: req.params,
        query: req.query
      });
      
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
    next();
  }
];

// Request logging middleware
const requestLogger = (action) => (req, res, next) => {
  const logData = {
    action,
    method: req.method,
    path: req.path,
    user: req.user?.id || 'guest',
    ip: req.ip
  };

  if (req.method === 'GET') {
    logData.query = req.query;
  } else {
    logData.body = req.body;
  }

  logger.info('API Request', logData);
  next();
};

/**
 * @swagger
 * tags:
 *   name: Local Delivery
 *   description: Local delivery operations
 */

/**
 * @swagger
 * /api/v2/delivery/nearby-products:
 *   get:
 *     summary: Get nearby available products
 *     tags: [Local Delivery]
 *     parameters:
 *       - $ref: '#/components/parameters/latitude'
 *       - $ref: '#/components/parameters/longitude'
 *       - $ref: '#/components/parameters/radius'
 *       - $ref: '#/components/parameters/category'
 *       - $ref: '#/components/parameters/limit'
 *     responses:
 *       200:
 *         description: List of nearby products
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/NearbyProductsResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get('/nearby-products',
  generalDeliveryLimiter,
  validateRequest([
    ...geoCoordinatesValidation,
    query('radius')
      .optional()
      .isFloat({ min: 0.1, max: 50 })
      .withMessage('Radius must be between 0.1-50 km')
      .toFloat(),
    query('category')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Category must be 1-50 characters'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1-100')
      .toInt()
  ]),
  requestLogger('nearby_products'),
  cacheMiddleware('5 minutes'),
  LocalDeliveryController.getNearbyProducts
);

/**
 * @swagger
 * /api/v2/delivery/check/{productId}:
 *   post:
 *     summary: Check delivery feasibility for a product
 *     tags: [Local Delivery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/productId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeliveryCheckRequest'
 *     responses:
 *       200:
 *         description: Delivery feasibility result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeliveryCheckResponse'
 */
router.post('/check/:productId',
  protect,
  generalDeliveryLimiter,
  validateRequest([
    ...mongoIdValidation('productId'),
    body('deliveryAddress.latitude')
      .isFloat({ min: -90, max: 90 })
      .withMessage('Invalid delivery latitude'),
    body('deliveryAddress.longitude')
      .isFloat({ min: -180, max: 180 })
      .withMessage('Invalid delivery longitude'),
    body('deliveryAddress.pincode')
      .matches(/^[1-9][0-9]{5}$/)
      .withMessage('Invalid delivery pincode'),
    body('quantity')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Quantity must be between 1-100')
      .toInt()
  ]),
  requestLogger('delivery_check'),
  validateDeliveryParameters,
  LocalDeliveryController.checkDelivery
);

/**
 * @swagger
 * /api/v2/delivery/slots/{productId}:
 *   get:
 *     summary: Get available delivery slots
 *     tags: [Local Delivery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/productId'
 *       - $ref: '#/components/parameters/date'
 *     responses:
 *       200:
 *         description: Available delivery slots
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeliverySlotsResponse'
 */
router.get('/slots/:productId',
  protect,
  generalDeliveryLimiter,
  validateRequest([
    ...mongoIdValidation('productId'),
    query('date')
      .optional()
      .isISO8601()
      .withMessage('Invalid date format (ISO8601 required)')
      .custom(value => {
        const date = new Date(value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (date < today) throw new Error('Date cannot be in the past');
        if (date > new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) {
          throw new Error('Date cannot be more than 7 days in future');
        }
        return true;
      })
  ]),
  requestLogger('delivery_slots'),
  cacheMiddleware('1 hour'),
  LocalDeliveryController.getDeliverySlots
);

/**
 * @swagger
 * /api/v2/delivery/estimate-cart:
 *   post:
 *     summary: Estimate delivery for cart items
 *     tags: [Local Delivery]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CartEstimateRequest'
 *     responses:
 *       200:
 *         description: Delivery estimation result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CartEstimateResponse'
 */
router.post('/estimate-cart',
  protect,
  estimateLimiter,
  validateRequest([
    body('items')
      .isArray({ min: 1, max: 50 })
      .withMessage('Items array required (1-50 items)'),
    body('items.*.productId')
      .isMongoId()
      .withMessage('Invalid product ID'),
    body('items.*.quantity')
      .isInt({ min: 1, max: 100 })
      .withMessage('Quantity must be 1-100')
      .toInt(),
    body('deliveryAddress.latitude')
      .isFloat({ min: -90, max: 90 })
      .withMessage('Invalid delivery latitude'),
    body('deliveryAddress.longitude')
      .isFloat({ min: -180, max: 180 })
      .withMessage('Invalid delivery longitude'),
    body('deliveryAddress.pincode')
      .matches(/^[1-9][0-9]{5}$/)
      .withMessage('Invalid delivery pincode'),
    body('preferredTime')
      .optional()
      .isISO8601()
      .withMessage('Invalid preferred time format'),
    body('deliveryType')
      .optional()
      .isIn(['standard', 'express', 'scheduled'])
      .withMessage('Invalid delivery type')
  ]),
  requestLogger('cart_estimate'),
  validateDeliveryParameters,
  LocalDeliveryController.estimateCartDelivery
);

/**
 * @swagger
 * /api/v2/delivery/zones/{pincode}:
 *   get:
 *     summary: Get delivery zones for pincode
 *     tags: [Local Delivery]
 *     parameters:
 *       - $ref: '#/components/parameters/pincode'
 *     responses:
 *       200:
 *         description: Delivery zones information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeliveryZonesResponse'
 */
router.get('/zones/:pincode',
  generalDeliveryLimiter,
  validateRequest(pincodeValidation),
  requestLogger('delivery_zones'),
  cacheMiddleware('24 hours'),
  LocalDeliveryController.getDeliveryZones
);

/**
 * @swagger
 * /api/v2/delivery/live-tracking/{orderId}:
 *   get:
 *     summary: Get live delivery tracking
 *     tags: [Local Delivery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/orderId'
 *     responses:
 *       200:
 *         description: Live tracking information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LiveTrackingResponse'
 */
router.get('/live-tracking/:orderId',
  protect,
  trackingLimiter,
  validateRequest(mongoIdValidation('orderId')),
  requestLogger('live_tracking'),
  LocalDeliveryController.getLiveTracking
);

/**
 * @swagger
 * /api/v2/delivery/agent/location:
 *   post:
 *     summary: Update delivery agent location
 *     tags: [Local Delivery]
 *     security:
 *       - bearerAuth: []
 *       - deliveryAgent: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AgentLocationUpdate'
 *     responses:
 *       200:
 *         description: Location updated successfully
 */
router.post('/agent/location',
  protect,
  authorize('delivery_agent'),
  generalDeliveryLimiter,
  validateRequest([
    body('latitude')
      .isFloat({ min: -90, max: 90 })
      .withMessage('Invalid latitude'),
    body('longitude')
      .isFloat({ min: -180, max: 180 })
      .withMessage('Invalid longitude'),
    body('orderId')
      .isMongoId()
      .withMessage('Invalid order ID'),
    body('accuracy')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Invalid accuracy value')
  ]),
  requestLogger('agent_location_update'),
  LocalDeliveryController.updateAgentLocation
);

/**
 * @swagger
 * /api/v2/delivery/coverage-area:
 *   get:
 *     summary: Get delivery coverage area
 *     tags: [Local Delivery]
 *     parameters:
 *       - $ref: '#/components/parameters/pincodeQuery'
 *     responses:
 *       200:
 *         description: Coverage area information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoverageAreaResponse'
 */
router.get('/coverage-area',
  generalDeliveryLimiter,
  validateRequest([
    query('pincode')
      .optional()
      .matches(/^[1-9][0-9]{5}$/)
      .withMessage('Invalid pincode format')
  ]),
  requestLogger('coverage_area'),
  cacheMiddleware('24 hours'),
  LocalDeliveryController.getCoverageArea
);

module.exports = router;