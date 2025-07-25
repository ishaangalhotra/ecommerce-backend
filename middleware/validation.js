const { body, validationResult } = require('express-validator');

// Validation middleware to handle express-validator results
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Common validation rules
const userValidation = {
  register: [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('name').isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('phone').isMobilePhone().withMessage('Valid phone number is required'),
    handleValidationErrors
  ],
  
  login: [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    handleValidationErrors
  ],
  
  update: [
    body('email').optional().isEmail().withMessage('Valid email is required'),
    body('name').optional().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('phone').optional().isMobilePhone().withMessage('Valid phone number is required'),
    handleValidationErrors
  ]
};

const productValidation = {
  create: [
    body('name').isLength({ min: 2 }).withMessage('Product name must be at least 2 characters'),
    body('price').isNumeric().withMessage('Price must be a number'),
    body('description').isLength({ min: 10 }).withMessage('Description must be at least 10 characters'),
    body('category').notEmpty().withMessage('Category is required'),
    handleValidationErrors
  ],
  
  update: [
    body('name').optional().isLength({ min: 2 }).withMessage('Product name must be at least 2 characters'),
    body('price').optional().isNumeric().withMessage('Price must be a number'),
    body('description').optional().isLength({ min: 10 }).withMessage('Description must be at least 10 characters'),
    handleValidationErrors
  ]
};

const orderValidation = {
  create: [
    body('items').isArray({ min: 1 }).withMessage('Order must contain at least one item'),
    body('deliveryAddress').notEmpty().withMessage('Delivery address is required'),
    body('paymentMethod').isIn(['card', 'cash', 'razorpay', 'stripe']).withMessage('Invalid payment method'),
    handleValidationErrors
  ]
};

module.exports = {
  handleValidationErrors,
  userValidation,
  productValidation,
  orderValidation,
  // Export individual functions for backwards compatibility
  validateUser: userValidation.register,
  validateLogin: userValidation.login,
  validateProduct: productValidation.create,
  validateOrder: orderValidation.create
};
