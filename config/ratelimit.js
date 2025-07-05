const rateLimit = require('express-rate-limit');
const { TooManyRequests } = require('../middleware/error');
const logger = require('../utils/logger');

// Shared rate limit configuration
const baseRateLimitConfig = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // Limit each IP to 100 requests per window
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable deprecated headers
  handler: (req, res, next) => {
    logger.warn(`Rate limit exceeded for ${req.ip}`);
    next(new TooManyRequests());
  }
};

// API rate limiter
const apiLimiter = rateLimit({
  ...baseRateLimitConfig,
  skip: (req) => {
    // Skip rate limiting for health checks and OPTIONS requests
    return req.path === '/health' || req.method === 'OPTIONS';
  }
});

// Authentication rate limiter (stricter)
const authLimiter = rateLimit({
  ...baseRateLimitConfig,
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many login attempts, please try again later',
  skipSuccessfulRequests: true // Only count failed attempts
});

module.exports = {
  api: apiLimiter,
  auth: authLimiter
};