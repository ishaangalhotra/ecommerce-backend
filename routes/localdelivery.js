const express = require('express');
const router = express.Router();
const LocalDeliveryController = require('../controllers/LocalDeliveryController');
const { protect, authorize } = require('../middleware/auth');
const { 
  validateLocation, 
  validateDeliveryCheck, 
  validateCartEstimate 
} = require('../middleware/deliveryValidation');

/**
 * @desc    Get nearby products with local delivery
 * @route   GET /api/v2/delivery/nearby-products
 * @access  Public
 */
router.get('/nearby-products', 
  validateLocation, 
  LocalDeliveryController.getNearbyProducts
);

/**
 * @desc    Check delivery feasibility for a product
 * @route   POST /api/v2/delivery/check/:productId
 * @access  Private
 */
router.post('/check/:productId', 
  protect,
  validateDeliveryCheck,
  LocalDeliveryController.checkDelivery
);

/**
 * @desc    Get available delivery slots
 * @route   GET /api/v2/delivery/slots/:productId
 * @access  Private
 */
router.get('/slots/:productId',
  protect,
  LocalDeliveryController.getDeliverySlots
);

/**
 * @desc    Estimate delivery for cart items
 * @route   POST /api/v2/delivery/estimate-cart
 * @access  Private
 */
router.post('/estimate-cart',
  protect,
  validateCartEstimate,
  LocalDeliveryController.estimateCartDelivery
);

/**
 * @desc    Get delivery zones for pincode
 * @route   GET /api/v2/delivery/zones/:pincode
 * @access  Public
 */
router.get('/zones/:pincode',
  LocalDeliveryController.getDeliveryZones
);

module.exports = router;
