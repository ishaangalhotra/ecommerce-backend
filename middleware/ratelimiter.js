const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { TooManyRequests } = require('./error');
const logger = require('./logger');
const redis = require('../utils/redis');

const createLimiter = (opts = {}) => {
  const config = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.ip === '127.0.0.1',
    handler: (req, res, next) => next(new TooManyRequests()),
    store: redis.client ? new RedisStore({
      client: redis.client,
      prefix: 'rl:'
    }) : undefined,
    ...opts
  };

  const limiter = rateLimit(config);

  // Add logging
  return (req, res, next) => {
    limiter(req, res, (err) => {
      if (err) {
        logger.warn(`Rate limit exceeded: ${req.method} ${req.path} from ${req.ip}`);
      }
      next(err);
    });
  };
};

module.exports = {
  global: createLimiter(),
  auth: createLimiter({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => `${req.ip}:${req.body.email || 'unknown'}`
  }),
  api: createLimiter({
    max: 1000,
    windowMs: 60 * 60 * 1000,
    keyGenerator: (req) => req.user ? `user:${req.user.id}` : `ip:${req.ip}`
  }),
  strict: createLimiter({
    max: 5,
    windowMs: 24 * 60 * 60 * 1000,
    skip: false
  })
};