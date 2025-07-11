const Redis = require('ioredis');
const logger = require('./logger'); // Your logger utility
const config = require('../config'); // Your config for Redis URI

let redisClient = null;

const connectRedis = () => {
  if (!config.redis.uri) {
    logger.warn('Redis URI not provided in config. Redis client will not be initialized.');
    return;
  }

  redisClient = new Redis(config.redis.uri, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false, // Don't queue commands if Redis is down
    commandTimeout: 5000, // Timeout for individual commands
    lazyConnect: true, // Only connect when a command is issued
    tls: config.isProduction ? { rejectUnauthorized: false } : undefined // Enable TLS in production if needed
  });

  redisClient.on('connect', () => {
    logger.info('✅ Redis connected successfully!');
  });

  redisClient.on('error', (err) => {
    logger.error('❌ Redis connection error:', err);
    // You might want to handle this more gracefully, e.g., send alerts
  });

  redisClient.on('end', () => {
    logger.info('🛑 Redis connection closed.');
  });

  // Connect explicitly when the app starts
  redisClient.connect().catch(err => {
    logger.error('Initial Redis connection failed:', err);
  });
};

const getRedisClient = () => redisClient;

const disconnectRedis = async () => {
  if (redisClient && redisClient.status === 'ready') {
    await redisClient.quit();
  }
};

module.exports = {
  connectRedis,
  client: getRedisClient(), // Export the client directly for use in other modules
  disconnectRedis,
};