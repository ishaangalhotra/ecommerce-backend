const rateLimit = require('express-rate-limit');
const ErrorResponse = require('../utils/errorResponse');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per window
  handler: (req, res) => {
    res.status(429).json(
      new ErrorResponse('Too many login attempts. Please try again later', 429)
    );
  },
  skipSuccessfulRequests: true // Only count failed attempts
});

const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 500, // Limit each IP to 500 requests per hour
  message: new ErrorResponse('Too many requests from this IP', 429)
});

module.exports = { authLimiter, apiLimiter };