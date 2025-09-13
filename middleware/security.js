// middleware/security.js

const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xssClean = require('xss-clean');
const hpp = require('hpp');
const helmet = require('helmet');
const logger = require('../utils/logger');

// Brute force protection (auth-specific can be stricter elsewhere)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: {
    error: 'Too many requests from this IP. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Wrap all security middleware into a single initializer
const applySecurity = (app) => {
  logger.info('🔐 Applying global security middleware');

  // HTTP headers hardening (configured to not interfere with CORS)
  app.use(helmet({
    // Disable crossOriginEmbedderPolicy to avoid CORS conflicts
    crossOriginEmbedderPolicy: false,
    // Configure crossOriginResourcePolicy to allow cross-origin requests
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));

  // Prevent HTTP parameter pollution
  app.use(hpp());

  // Data sanitization against NoSQL injection
  app.use(mongoSanitize());

  // Data sanitization against XSS
  app.use(xssClean());

  // General rate limiting (add tighter limiter for /api/auth separately)
  app.use('/api', generalLimiter);
};

module.exports = applySecurity;
