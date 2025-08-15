const { body, param, query, validationResult } = require('express-validator');
const Product = require('../models/Product');
const { PRODUCT_STATUSES, BUSINESS_CONFIG, ERROR_CODES } = require('../constants');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

/**
 * Product validation middleware
 */

// Validate product creation data
const validateProductCreation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ min: 3, max: 100 })
    .withMessage('Product name must be 3-100 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be under 2000 characters'),
  
  body('price')
    .isNumeric()
    .withMessage('Price must be a number')
    .custom((value) => {
      if (value < 1 || value > 1000000) {
        throw new Error('Price must be between ₹1 and ₹1,000,000');
      }
      return true;
    }),
  
  body('comparePrice')
    .optional()
    .isNumeric()
    .withMessage('Compare price must be a number')
    .custom((value, { req }) => {
      if (value && value <= req.body.price) {
        throw new Error('Compare price must be higher than selling price');
      }
      return true;
    }),
  
  body('category')
    .trim()
    .notEmpty()
    .withMessage('Category is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Category must be 2-50 characters'),
  
  body('stock')
    .isInt({ min: 0, max: 10000 })
    .withMessage('Stock must be between 0 and 10,000'),
  
  body('sku')
    .optional()
    .trim()
    .matches(/^[A-Z0-9-]{6,20}$/)
    .withMessage('SKU must be 6-20 characters (A-Z, 0-9, -)'),
  
  body('tags')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const tags = value.split(',').map(tag => tag.trim());
        if (tags.length > 10) {
          throw new Error('Maximum 10 tags allowed');
        }
        for (const tag of tags) {
          if (tag.length < 2 || tag.length > 30) {
            throw new Error('Each tag must be 2-30 characters');
          }
        }
      }
      return true;
    }),
  
  body('features')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const features = value.split(',').map(f => f.trim());
        if (features.length > 20) {
          throw new Error('Maximum 20 features allowed');
        }
        for (const feature of features) {
          if (feature.length < 3 || feature.length > 100) {
            throw new Error('Each feature must be 3-100 characters');
          }
        }
      }
      return true;
    }),
  
  body('specifications')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try {
          const specs = JSON.parse(value);
          if (typeof specs !== 'object' || Array.isArray(specs)) {
            throw new Error('Specifications must be a valid object');
          }
          if (Object.keys(specs).length > 20) {
            throw new Error('Maximum 20 specifications allowed');
          }
        } catch (err) {
          throw new Error('Invalid specifications format');
        }
      }
      return true;
    }),
  
  body('isPublished')
    .optional()
    .isBoolean()
    .withMessage('isPublished must be true or false')
];

// Validate product update data
const validateProductUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Product name must be 3-100 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be under 2000 characters'),
  
  body('price')
    .optional()
    .isNumeric()
    .withMessage('Price must be a number')
    .custom((value) => {
      if (value < 1 || value > 1000000) {
        throw new Error('Price must be between ₹1 and ₹1,000,000');
      }
      return true;
    }),
  
  body('comparePrice')
    .optional()
    .isNumeric()
    .withMessage('Compare price must be a number'),
  
  body('category')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Category must be 2-50 characters'),
  
  body('stock')
    .optional()
    .isInt({ min: 0, max: 10000 })
    .withMessage('Stock must be between 0 and 10,000'),
  
  body('status')
    .optional()
    .isIn(Object.values(PRODUCT_STATUSES))
    .withMessage('Invalid product status'),
  
  body('tags')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const tags = value.split(',').map(tag => tag.trim());
        if (tags.length > 10) {
          throw new Error('Maximum 10 tags allowed');
        }
        for (const tag of tags) {
          if (tag.length < 2 || tag.length > 30) {
            throw new Error('Each tag must be 2-30 characters');
          }
        }
      }
      return true;
    }),
  
  body('features')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const features = value.split(',').map(f => f.trim());
        if (features.length > 20) {
          throw new Error('Maximum 20 features allowed');
        }
        for (const feature of features) {
          if (feature.length < 3 || feature.length > 100) {
            throw new Error('Each feature must be 3-100 characters');
          }
        }
      }
      return true;
    }),
  
  body('specifications')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try {
          const specs = JSON.parse(value);
          if (typeof specs !== 'object' || Array.isArray(specs)) {
            throw new Error('Specifications must be a valid object');
          }
          if (Object.keys(specs).length > 20) {
            throw new Error('Maximum 20 specifications allowed');
          }
        } catch (err) {
          throw new Error('Invalid specifications format');
        }
      }
      return true;
    }),
  
  body('isPublished')
    .optional()
    .isBoolean()
    .withMessage('isPublished must be true or false')
];

// Validate MongoDB ObjectId
const validateObjectId = (paramName = 'id') => [
  param(paramName)
    .isMongoId()
    .withMessage(`Invalid ${paramName} format`)
];

// Validate query parameters for product listing
const validateProductQuery = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Page must be between 1 and 1000')
    .toInt(),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: BUSINESS_CONFIG.MAX_PAGE_SIZE })
    .withMessage(`Limit must be between 1 and ${BUSINESS_CONFIG.MAX_PAGE_SIZE}`)
    .toInt(),
  
  query('search')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search query must be 2-100 characters'),
  
  query('category')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Category filter must be 2-50 characters'),
  
  query('status')
    .optional()
    .isIn(Object.values(PRODUCT_STATUSES))
    .withMessage('Invalid status filter'),
  
  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be a positive number')
    .toFloat(),
  
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be a positive number')
    .toFloat(),
  
  query('sortBy')
    .optional()
    .isIn(['name', 'price', 'createdAt', 'updatedAt', 'rating', 'stock'])
    .withMessage('Invalid sort field'),
  
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc')
];

// Middleware to check validation results
const checkValidationResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.debug('Validation failed', {
      path: req.path,
      method: req.method,
      errors: errors.array(),
      userId: req.user?.id
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: ERROR_CODES.VALIDATION_ERROR,
      errors: errors.array(),
      timestamp: new Date().toISOString()
    });
  }
  next();
};

// Middleware to check if user owns the product
const checkProductOwnership = async (req, res, next) => {
  try {
    const productId = req.params.id;
    const userId = req.user.id;
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format',
        code: ERROR_CODES.VALIDATION_ERROR
      });
    }
    
    const product = await Product.findOne({
      _id: productId,
      seller: userId,
      isDeleted: false
    }).lean();
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found or access denied',
        code: ERROR_CODES.PRODUCT_NOT_FOUND
      });
    }
    
    req.product = product;
    next();
  } catch (error) {
    logger.error('Product ownership check failed', {
      error: error.message,
      productId: req.params.id,
      userId: req.user?.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to verify product ownership',
      code: ERROR_CODES.INTERNAL_SERVER_ERROR
    });
  }
};

// Middleware to check if product exists (for public routes)
const checkProductExists = async (req, res, next) => {
  try {
    const productId = req.params.id;
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID format',
        code: ERROR_CODES.VALIDATION_ERROR
      });
    }
    
    const product = await Product.findOne({
      _id: productId,
      isDeleted: false
    }).lean();
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        code: ERROR_CODES.PRODUCT_NOT_FOUND
      });
    }
    
    req.product = product;
    next();
  } catch (error) {
    logger.error('Product existence check failed', {
      error: error.message,
      productId: req.params.id
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to verify product existence',
      code: ERROR_CODES.INTERNAL_SERVER_ERROR
    });
  }
};

// Middleware to check if product is available for purchase
const checkProductAvailability = (req, res, next) => {
  const product = req.product;
  
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found',
      code: ERROR_CODES.PRODUCT_NOT_FOUND
    });
  }
  
  if (product.status !== PRODUCT_STATUSES.ACTIVE) {
    return res.status(400).json({
      success: false,
      message: 'Product is not available for purchase',
      code: ERROR_CODES.PRODUCT_NOT_AVAILABLE
    });
  }
  
  const requestedQuantity = req.body.quantity || 1;
  if (product.stock < requestedQuantity) {
    return res.status(400).json({
      success: false,
      message: 'Insufficient stock available',
      code: ERROR_CODES.INSUFFICIENT_STOCK,
      data: {
        requestedQuantity,
        availableStock: product.stock
      }
    });
  }
  
  next();
};

// Middleware to validate bulk product operations
const validateBulkOperation = [
  body('productIds')
    .isArray({ min: 1, max: 50 })
    .withMessage('Product IDs must be an array with 1-50 items'),
  
  body('productIds.*')
    .isMongoId()
    .withMessage('Each product ID must be valid'),
  
  body('action')
    .isIn(['activate', 'deactivate', 'delete', 'update_status'])
    .withMessage('Invalid bulk action'),
  
  body('data')
    .optional()
    .isObject()
    .withMessage('Data must be an object for bulk updates')
];

module.exports = {
  validateProductCreation,
  validateProductUpdate,
  validateObjectId,
  validateProductQuery,
  validateBulkOperation,
  checkValidationResult,
  checkProductOwnership,
  checkProductExists,
  checkProductAvailability
};