const ErrorResponse = require('../utils/errorResponse');
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log complete error stack in development
  if (process.env.NODE_ENV === 'development') {
    logger.error(`${err.stack}`);
  } else {
    logger.error(`${err.message}`);
  }

  // Handle specific error types
  switch (true) {
    case err.name === 'CastError':
      error = new ErrorResponse('Invalid resource ID format', 400);
      break;
    case err.name === 'ValidationError':
      error = new ErrorResponse(
        Object.values(err.errors).map(val => val.message).join(', '),
        400
      );
      break;
    case err.code === 11000: // MongoDB duplicate key
      error = new ErrorResponse('Duplicate field value entered', 400);
      break;
    case err.name === 'JsonWebTokenError':
      error = new ErrorResponse('Invalid token', 401);
      break;
    case err.name === 'TokenExpiredError':
      error = new ErrorResponse('Token expired', 401);
      break;
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = errorHandler;