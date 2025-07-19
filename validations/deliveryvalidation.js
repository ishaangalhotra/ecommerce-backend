const { body, query, param } = require('express-validator');

const validateLocation = [
  query('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  query('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  query('maxDistance')
    .optional()
    .isInt({ min: 500, max: 50000 })
    .withMessage('Max distance must be between 500m and 50km'),
  query('category')
    .optional()
    .isString()
    .trim()
    .withMessage('Category must be a string'),
  query('sortBy')
    .optional()
    .isIn(['distance', 'time', 'rating', 'price_low', 'price_high', 'popularity'])
    .withMessage('Invalid sort option'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
];

const validateDeliveryCheck = [
  param('productId')
    .isMongoId()
    .withMessage('Invalid product ID'),
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180')
];

const validateCartEstimate = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Items must be a non-empty array'),
  body('items.*.productId')
    .isMongoId()
    .withMessage('Each item must have a valid product ID'),
  body('items.*.quantity')
    .isInt({ min: 1, max: 50 })
    .withMessage('Quantity must be between 1 and 50'),
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180')
];

module.exports = {
  validateLocation,
  validateDeliveryCheck,
  validateCartEstimate
};
