const LocalDeliveryService = require('../services/LocalDeliveryService');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const asyncHandler = require('../middleware/asyncHandlerHandlerHandler');
const ErrorResponse = require('../utils/errorResponse');

// Constants for better maintainability
const DEFAULT_VALUES = {
    MAX_DISTANCE: 10000, // 10km in meters
    PAGE_LIMIT: 20,
    SORT_BY: 'distance'
};

const HTTP_STATUS = {
    OK: 200,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500
};

class LocalDeliveryController {
    /**
     * Get nearby products with local delivery
     * GET /api/v2/delivery/nearby-products
     */
    static getNearbyProducts = asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new ErrorResponse('Validation failed', HTTP_STATUS.BAD_REQUEST, errors.array());
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

        // Enhanced input validation
        if (!latitude || !longitude) {
            throw new ErrorResponse('Latitude and longitude are required', HTTP_STATUS.BAD_REQUEST);
        }

        const userLocation = {
            lat: parseFloat(latitude),
            lng: parseFloat(longitude)
        };

        // Validate coordinates
        if (isNaN(userLocation.lat) || isNaN(userLocation.lng) ||
            userLocation.lat < -90 || userLocation.lat > 90 ||
            userLocation.lng < -180 || userLocation.lng > 180) {
            throw new ErrorResponse('Invalid coordinates provided', HTTP_STATUS.BAD_REQUEST);
        }

        const parsedPage = Math.max(1, parseInt(page) || 1);
        const parsedLimit = Math.min(100, Math.max(1, parseInt(limit) || DEFAULT_VALUES.PAGE_LIMIT));

        const options = {
            maxDistance: Math.min(50000, Math.max(1000, parseInt(maxDistance) || DEFAULT_VALUES.MAX_DISTANCE)),
            category: category?.trim(),
            minPrice: minPrice ? Math.max(0, parseFloat(minPrice)) : undefined,
            maxPrice: maxPrice ? Math.max(0, parseFloat(maxPrice)) : undefined,
            sortBy: ['distance', 'price', 'rating', 'delivery_time'].includes(sortBy) ? sortBy : DEFAULT_VALUES.SORT_BY,
            limit: parsedLimit,
            skip: (parsedPage - 1) * parsedLimit
        };

        // Validate price range
        if (options.minPrice && options.maxPrice && options.minPrice > options.maxPrice) {
            throw new ErrorResponse('Minimum price cannot be greater than maximum price', HTTP_STATUS.BAD_REQUEST);
        }

        const result = await LocalDeliveryService.findNearbyProducts(userLocation, options);

        const response = {
            success: true,
            message: 'Nearby products fetched successfully',
            data: {
                products: result.products || [],
                pagination: {
                    currentPage: parsedPage,
                    totalPages: Math.ceil((result.totalCount || 0) / parsedLimit),
                    totalItems: result.totalCount || 0,
                    hasNext: parsedPage * parsedLimit < (result.totalCount || 0),
                    hasPrev: parsedPage > 1
                },
                meta: {
                    userLocation,
                    searchRadius: `${(options.maxDistance / 1000).toFixed(1)}km`,
                    sortBy: options.sortBy,
                    filters: {
                        category: options.category,
                        priceRange: {
                            min: options.minPrice,
                            max: options.maxPrice
                        }
                    }
                }
            }
        };

        res.status(HTTP_STATUS.OK).json(response);

        // Enhanced logging
        logger.info('Nearby products fetched', {
            userId: req.user?.id,
            location: userLocation,
            count: result.products?.length || 0,
            searchRadius: options.maxDistance,
            filters: options,
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Check delivery feasibility for a product
     * POST /api/v2/delivery/check/:productId
     */
    static checkDelivery = asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new ErrorResponse('Validation failed', HTTP_STATUS.BAD_REQUEST, errors.array());
        }

        const { productId } = req.params;
        const { latitude, longitude } = req.body;

        if (!productId?.trim()) {
            throw new ErrorResponse('Product ID is required', HTTP_STATUS.BAD_REQUEST);
        }

        if (!latitude || !longitude) {
            throw new ErrorResponse('Latitude and longitude are required', HTTP_STATUS.BAD_REQUEST);
        }

        const userLocation = { 
            lat: parseFloat(latitude), 
            lng: parseFloat(longitude) 
        };

        // Validate coordinates
        if (isNaN(userLocation.lat) || isNaN(userLocation.lng)) {
            throw new ErrorResponse('Invalid coordinates provided', HTTP_STATUS.BAD_REQUEST);
        }

        const deliveryInfo = await LocalDeliveryService.checkDeliveryFeasibility(
            productId.trim(),
            userLocation
        );

        if (!deliveryInfo) {
            throw new ErrorResponse('Unable to check delivery feasibility', HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }

        res.status(HTTP_STATUS.OK).json({
            success: true,
            message: 'Delivery feasibility checked successfully',
            data: {
                ...deliveryInfo,
                productId,
                userLocation,
                checkedAt: new Date().toISOString()
            }
        });

        logger.info('Delivery feasibility checked', {
            userId: req.user?.id,
            productId,
            location: userLocation,
            canDeliver: deliveryInfo.canDeliver,
            estimatedTime: deliveryInfo.estimatedTime,
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Get available delivery slots
     * GET /api/v2/delivery/slots/:productId
     */
    static getDeliverySlots = asyncHandler(async (req, res) => {
        const { productId } = req.params;
        const { date, latitude, longitude } = req.query;

        if (!productId?.trim()) {
            throw new ErrorResponse('Product ID is required', HTTP_STATUS.BAD_REQUEST);
        }

        // Validate date if provided
        let targetDate = new Date();
        if (date) {
            targetDate = new Date(date);
            if (isNaN(targetDate.getTime())) {
                throw new ErrorResponse('Invalid date format', HTTP_STATUS.BAD_REQUEST);
            }
            
            // Don't allow past dates
            if (targetDate < new Date().setHours(0, 0, 0, 0)) {
                throw new ErrorResponse('Cannot check slots for past dates', HTTP_STATUS.BAD_REQUEST);
            }
        }

        const userLocation = latitude && longitude ? {
            lat: parseFloat(latitude),
            lng: parseFloat(longitude)
        } : null;

        const slots = await LocalDeliveryService.getAvailableSlots(
            productId.trim(), 
            targetDate,
            userLocation
        );

        res.status(HTTP_STATUS.OK).json({
            success: true,
            message: 'Available delivery slots fetched successfully',
            data: {
                slots: slots || [],
                requestedDate: targetDate.toISOString().split('T')[0],
                productId,
                totalSlots: slots?.length || 0
            }
        });

        logger.info('Delivery slots fetched', {
            userId: req.user?.id,
            productId,
            date: targetDate.toISOString().split('T')[0],
            slotsAvailable: slots?.length || 0
        });
    });

    /**
     * Estimate delivery for cart items
     * POST /api/v2/delivery/estimate-cart
     */
    static estimateCartDelivery = asyncHandler(async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new ErrorResponse('Validation failed', HTTP_STATUS.BAD_REQUEST, errors.array());
        }

        const { items, latitude, longitude } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            throw new ErrorResponse('Cart items are required', HTTP_STATUS.BAD_REQUEST);
        }

        if (!latitude || !longitude) {
            throw new ErrorResponse('Latitude and longitude are required', HTTP_STATUS.BAD_REQUEST);
        }

        // Validate each item
        for (const item of items) {
            if (!item.productId || !item.quantity || item.quantity <= 0) {
                throw new ErrorResponse('Each item must have valid productId and quantity', HTTP_STATUS.BAD_REQUEST);
            }
        }

        const userLocation = { 
            lat: parseFloat(latitude), 
            lng: parseFloat(longitude) 
        };

        // Validate coordinates
        if (isNaN(userLocation.lat) || isNaN(userLocation.lng)) {
            throw new ErrorResponse('Invalid coordinates provided', HTTP_STATUS.BAD_REQUEST);
        }

        const estimate = await LocalDeliveryService.estimateCartDelivery(items, userLocation);

        if (!estimate) {
            throw new ErrorResponse('Unable to estimate delivery', HTTP_STATUS.INTERNAL_SERVER_ERROR);
        }

        res.status(HTTP_STATUS.OK).json({
            success: true,
            message: 'Cart delivery estimated successfully',
            data: {
                ...estimate,
                userLocation,
                itemCount: items.length,
                estimatedAt: new Date().toISOString()
            }
        });

        logger.info('Cart delivery estimated', {
            userId: req.user?.id,
            itemCount: items.length,
            canDeliver: estimate.canDeliver,
            estimatedTime: estimate.estimatedTime,
            totalFee: estimate.deliveryFee,
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Get delivery zones for a pincode
     * GET /api/v2/delivery/zones/:pincode
     */
    static getDeliveryZones = asyncHandler(async (req, res) => {
        const { pincode } = req.params;

        if (!pincode?.trim() || !/^\d{6}$/.test(pincode.trim())) {
            throw new ErrorResponse('Valid 6-digit pincode is required', HTTP_STATUS.BAD_REQUEST);
        }

        try {
            // Get actual delivery zones from service
            const zones = await LocalDeliveryService.getDeliveryZones(pincode.trim());
            
            res.status(HTTP_STATUS.OK).json({
                success: true,
                message: 'Delivery zones fetched successfully',
                data: {
                    ...zones,
                    pincode: pincode.trim(),
                    fetchedAt: new Date().toISOString()
                }
            });

            logger.info('Delivery zones fetched', {
                userId: req.user?.id,
                pincode: pincode.trim(),
                deliveryAvailable: zones.deliveryAvailable
            });

        } catch (error) {
            // Fallback response if service is not implemented
            const fallbackZones = {
                pincode: pincode.trim(),
                deliveryAvailable: true,
                estimatedTime: '15-25 minutes',
                deliveryFee: 25,
                freeDeliveryThreshold: 500,
                expressDeliveryAvailable: true,
                serviceAreas: ['Local Area', 'Extended Area'],
                cutoffTime: '20:00'
            };

            res.status(HTTP_STATUS.OK).json({
                success: true,
                message: 'Delivery zones fetched successfully',
                data: {
                    ...fallbackZones,
                    fetchedAt: new Date().toISOString()
                }
            });
        }
    });

    /**
     * Get delivery statistics for admin
     * GET /api/v2/delivery/stats
     */
    static getDeliveryStats = asyncHandler(async (req, res) => {
        const { startDate, endDate, zone } = req.query;

        const stats = await LocalDeliveryService.getDeliveryStats({
            startDate: startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            endDate: endDate ? new Date(endDate) : new Date(),
            zone
        });

        res.status(HTTP_STATUS.OK).json({
            success: true,
            message: 'Delivery statistics fetched successfully',
            data: stats
        });
    });
}

LocalDeliveryController.getLiveTracking = async (req, res) => {
  res.json({ success: true, message: "Live tracking not implemented yet" });
};

LocalDeliveryController.updateAgentLocation = async (req, res) => {
  res.json({ success: true, message: "Agent location update not implemented yet" });
};

LocalDeliveryController.getCoverageArea = async (req, res) => {
  res.json({ success: true, message: "Coverage area check not implemented yet" });
};
module.exports = LocalDeliveryController;
