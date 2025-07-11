const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { ErrorResponse } = require('./error'); // Import custom ErrorResponse
const logger = require('../utils/logger'); // Your logger utility
const redis = require('../utils/redis'); // Your Redis client setup (make sure it exports `client`)

// Custom error for rate limiting
class TooManyRequests extends ErrorResponse {
  constructor(message = 'Too many requests, please try again later.', details = null) {
    super(message, 429, details);
  }
}

/**
 * Creates a rate limiter instance.
 * @param {object} opts - Options for the rate limiter.
 * @returns {function} Express middleware for rate limiting.
 */
const createLimiter = (opts = {}) => {
  const config = {
    windowMs: 15 * 60 * 1000, // Default: 15 minutes
    max: 100, // Default: 100 requests per windowMs
    standardHeaders: true, // Return `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    skip: (req) => req.ip === '127.0.0.1', // Skip rate limiting for localhost
    
    // Custom handler for when limit is exceeded
    handler: (req, res, next) => {
      logger.warn(`Rate limit exceeded for ${req.method} ${req.path} from ${req.ip}`);
      next(new TooManyRequests()); // Pass custom error to global error handler
    },
    
    // Use Redis store if Redis client is available
    store: redis.client ? new RedisStore({
      client: redis.client,
      prefix: 'rl:', // Prefix for keys in Redis
      expiry: opts.windowMs || (15 * 60 * 1000), // Expiry in milliseconds
      resetExpiryOnChange: true, // Reset counter on each request
    }) : undefined, // No store if Redis client is not available (falls back to MemoryStore by default for express-rate-limit)
    
    ...opts // Override default options
  };

  const limiter = rateLimit(config);

  return (req, res, next) => {
    limiter(req, res, next); // Simply call the generated limiter
  };
};

module.exports = {
  // Global API rate limit
  global: createLimiter(),
  
  // Stricter rate limit for authentication routes (login, register, forgot password)
  auth: createLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Max 5 requests per hour per IP
    message: 'Too many authentication attempts, please try again after an hour.'
  }),
  
  // Export custom error for direct use if needed
  TooManyRequests
};