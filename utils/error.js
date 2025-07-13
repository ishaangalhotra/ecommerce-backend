const logger = require('../utils/logger');
const config = require('../config/config'); // Assuming config.js exports NODE_ENV and other settings

/**
 * @class ErrorResponse
 * @extends Error
 * @description Custom error class for operational errors.
 */
class ErrorResponse extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details; // Can be used to pass additional error context (e.g., validation errors)
    this.isOperational = true; // Flag for known, handled errors
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * @function errorHandler
 * @description Global error handling middleware for Express.
 * @param {Error} err - The error object.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.stack = config.isDevelopment ? err.stack : undefined; // Only show stack in dev

  // Log to console for development
  if (config.isDevelopment) {
    console.error('❌ Error Stack:', err.stack);
  }

  // Log to Winston for all environments (especially production)
  logger.error(`${err.statusCode || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);

  // Handle specific error types
  switch (true) {
    // Mongoose duplicate key error
    case err.code === 11000:
      const duplicateField = Object.keys(err.keyValue)[0];
      error = new ErrorResponse(
        `Duplicate field value entered for ${duplicateField}`,
        400,
        { field: duplicateField, value: err.keyValue[duplicateField] }
      );
      break;

    // Mongoose validation error
    case err.name === 'ValidationError':
      const messages = Object.values(err.errors).map(val => val.message);
      error = new ErrorResponse(
        'Validation Error',
        400,
        { errors: messages }
      );
      break;

    // JWT errors
    case err.name === 'JsonWebTokenError':
      error = new ErrorResponse('Invalid token', 401);
      break;

    case err.name === 'TokenExpiredError':
      error = new ErrorResponse('Token expired', 401);
      break;

    // CastError (invalid ObjectId)
    case err.name === 'CastError':
      error = new ErrorResponse(`Invalid ${err.path}: ${err.value}`, 400);
      break;

    // Multer errors (file upload errors)
    case err.name === 'MulterError':
      error = new ErrorResponse(`File upload error: ${err.message}`, 400);
      break;

    // Default to internal server error if not an operational error
    default:
      // If it's not a custom ErrorResponse, or if it's an unexpected error,
      // mask the message in production for non-operational errors.
      if (!(err instanceof ErrorResponse) || !err.isOperational) {
        const message = config.isProduction && !err.isOperational
          ? 'Something went wrong on our server'
          : err.message;
        
        error = new ErrorResponse(
          message,
          err.statusCode || 500,
          config.isDevelopment ? err.stack : undefined // Show stack only in dev
        );
      }
  }

  // Send error response
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message,
    details: error.details, // Include specific error details (e.g., validation msgs)
    stack: error.stack // Include stack only in development
  });
};

module.exports = { ErrorResponse, errorHandler };