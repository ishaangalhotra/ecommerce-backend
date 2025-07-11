const logger = require('../utils/logger'); // Assuming you have a logger

/**
 * Async handler wrapper that:
 * 1. Handles async route handlers
 * 2. Provides consistent error responses
 * 3. Logs errors appropriately
 */
const asyncHandler = (fn, options = {}) => (req, res, next) => {
  const { logErrors = true } = options;
  
  Promise.resolve(fn(req, res, next))
    .catch(error => {
      if (logErrors) {
        logger.error('Async handler error:', {
          error: error.message,
          stack: error.stack,
          route: req.originalUrl,
          method: req.method,
          params: req.params,
          query: req.query
        });
      }

      // Handle different error types
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          details: error.errors
        });
      }

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: 'File too large'
        });
      }

      // Default error handler
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Internal Server Error'
      });

      // Still pass to express error handler if needed
      if (!res.headersSent) {
        next(error);
      }
    });
};

module.exports = asyncHandler;