// middleware/validation.js
const mongoose = require('mongoose');

/**
 * Validate MongoDB ObjectId parameters
 */
const validateObjectId = (paramName = 'id') => {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (!id) {
      return res.status(400).json({ success: false, message: `${paramName} parameter is required` });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: `Invalid ${paramName} format` });
    }
    next();
  };
};

/**
 * Validate required body fields
 */
const validateRequiredFields = (requiredFields) => {
  return (req, res, next) => {
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        missingFields
      });
    }
    next();
  };
};

/**
 * Validate email format
 */
const validateEmail = (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format' });
  }
  next();
};

/**
 * Validate phone number format
 */
const validatePhone = (req, res, next) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, message: 'Phone number is required' });
  }
  const phoneRegex = /^[\+]?[\d\s\-\(\)]{10,15}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({ success: false, message: 'Invalid phone number format' });
  }
  next();
};

/**
 * Validate order payload (for payment routes)
 */
const validateOrder = (req, res, next) => {
  const { orderId, amount } = req.body;
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ success: false, message: 'Valid orderId is required' });
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Valid amount is required' });
  }
  next();
};

/**
 * Validate number field with range
 */
const validateNumberRange = (fieldName, min = null, max = null) => {
  return (req, res, next) => {
    const value = req.body[fieldName];
    if (typeof value !== 'number' || isNaN(value)) {
      return res.status(400).json({ success: false, message: `${fieldName} must be a number` });
    }
    if (min !== null && value < min) {
      return res.status(400).json({ success: false, message: `${fieldName} must be at least ${min}` });
    }
    if (max !== null && value > max) {
      return res.status(400).json({ success: false, message: `${fieldName} must be no more than ${max}` });
    }
    next();
  };
};

/**
 * Validate date format & optional range
 */
const validateDate = (fieldName, { required = true, minDate = null, maxDate = null } = {}) => {
  return (req, res, next) => {
    const value = req.body[fieldName];
    if (!value) {
      if (required) {
        return res.status(400).json({ success: false, message: `${fieldName} is required` });
      } else {
        return next();
      }
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ success: false, message: `${fieldName} must be a valid date` });
    }
    if (minDate && date < new Date(minDate)) {
      return res.status(400).json({ success: false, message: `${fieldName} must be after ${minDate}` });
    }
    if (maxDate && date > new Date(maxDate)) {
      return res.status(400).json({ success: false, message: `${fieldName} must be before ${maxDate}` });
    }
    next();
  };
};

/**
 * Validate string length
 */
const validateStringLength = (fieldName, minLength = 0, maxLength = 255) => {
  return (req, res, next) => {
    const value = req.body[fieldName];
    if (typeof value !== 'string') {
      return res.status(400).json({ success: false, message: `${fieldName} must be a string` });
    }
    if (value.length < minLength) {
      return res.status(400).json({ success: false, message: `${fieldName} must be at least ${minLength} characters` });
    }
    if (value.length > maxLength) {
      return res.status(400).json({ success: false, message: `${fieldName} must be at most ${maxLength} characters` });
    }
    next();
  };
};

/**
 * Validate enum (allowed values)
 */
const validateEnum = (fieldName, allowedValues = []) => {
  return (req, res, next) => {
    const value = req.body[fieldName];
    if (!allowedValues.includes(value)) {
      return res.status(400).json({
        success: false,
        message: `${fieldName} must be one of: ${allowedValues.join(', ')}`
      });
    }
    next();
  };
};

module.exports = {
  validateObjectId,
  validateRequiredFields,
  validateEmail,
  validatePhone,
  validateOrder,
  validateNumberRange,
  validateDate,
  validateStringLength,
  validateEnum
};
