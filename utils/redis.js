const redis = require('redis');
const logger = require('./logger');

let redisClient = null;

const initializeRedis = () => {
  // Only attempt Redis connection if URL is provided
  if (!process.env.REDIS_URL && process.env.NODE_ENV === 'production') {
    logger.info('Redis URL not provided, using mock client');
    return createMockClient();
  }

  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      retryMaxDelay: 2000,
      connectTimeout: 5000,
      lazyConnect: true
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis connected successfully');
    });

    redisClient.on('error', (err) => {
      logger.warn('Redis connection error:', err.message);
      // Don't continuously retry in production without Redis service
      if (!process.env.REDIS_URL) {
        redisClient = createMockClient();
        logger.info('Switched to mock Redis client');
      }
    });

    redisClient.on('end', () => {
      logger.warn('Redis connection closed');
    });

    // Attempt connection
    redisClient.connect().catch(() => {
      logger.warn('Redis server unavailable, falling back to mock client');
      redisClient = createMockClient();
    });

  } catch (error) {
    logger.warn('Redis initialization failed, using mock client:', error.message);
    redisClient = createMockClient();
  }

  return redisClient;
};

// Mock Redis client for development/environments without Redis
const createMockClient = () => {
  logger.info('Using mock Redis client');
  
  return {
    get: async () => null,
    set: async () => 'OK',
    setex: async () => 'OK',
    del: async () => 1,
    exists: async () => 0,
    expire: async () => 1,
    ttl: async () => -1,
    keys: async () => [],
    flushall: async () => 'OK',
    quit: async () => 'OK',
    disconnect: () => {},
    zincrby: async () => 1,
    zrange: async () => [],
    isOpen: true,
    isReady: true
  };
};

module.exports = initializeRedis();
