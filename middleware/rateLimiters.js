const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { client, useRedis } = require('../config/redisClient');

const createStore = () => {
  if (useRedis) {
    return new RedisStore({
      sendCommand: (...args) => client.call(...args)
    });
  }
  return undefined; // will use in-memory store
};

const loginLimiter = rateLimit({
  store: createStore(),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  legacyHeaders: false,
  standardHeaders: true,
  message: { error: 'Too many login attempts, please try again later.' }
});

const couponLimiter = rateLimit({
  store: createStore(),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  legacyHeaders: false,
  standardHeaders: true,
  message: { error: 'Too many coupon attempts, please try later.' }
});

module.exports = { loginLimiter, couponLimiter };
