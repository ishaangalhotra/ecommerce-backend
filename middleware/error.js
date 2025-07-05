const logger = require('../utils/logger');
const { NODE_ENV } = require('../config');

class ErrorResponse extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.stack = err.stack;

  // Log to console for development
  if (NODE_ENV === 'development') {
    console.error('❌ Error Stack:', err.stack);
  }

  // Log to file/winston for production
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

    // Default to internal server error
    default:
      if (!(err instanceof ErrorResponse)) {  // <-- This was missing a closing parenthesis
        // Mask non-operational errors in production
        const message = NODE_ENV === 'production' && !err.isOperational 
          ? 'Something went wrong' 
          : err.message;
        
        error = new ErrorResponse(
          message,
          err.statusCode || 500,
          NODE_ENV === 'development' ? err.stack : undefined
        );
      }
  }

  // Send error response
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message,
    ...(error.details && { details: error.details }),
    ...(NODE_ENV === 'development' && { stack: error.stack })
  });
};

module.exports = {
  ErrorResponse,
  errorHandler
};