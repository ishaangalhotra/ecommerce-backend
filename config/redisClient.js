
/**
 * Redis client helper. Uses REDIS_URL env var if present.
 * Falls back to a no-op in-memory store if Redis is not configured.
 */
const Redis = require('ioredis');

let client = null;
let useRedis = false;

if (process.env.REDIS_URL) {
  client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false
  });
  useRedis = true;
  client.on('error', (err) => {
    console.error('Redis error:', err && err.message ? err.message : err);
  });
} else {
  // simple in-memory fallback
  const MapStore = new Map();
  client = {
    async set(key, val, mode, ttl) {
      MapStore.set(key, val);
      if (mode && mode.toUpperCase()==='EX' && ttl) {
        setTimeout(()=>MapStore.delete(key), ttl*1000);
      }
      return 'OK';
    },
    async get(key) {
      return MapStore.get(key) || null;
    },
    async del(key) {
      return MapStore.delete(key);
    },
    on() {}
  };
}

module.exports = { client, useRedis };
