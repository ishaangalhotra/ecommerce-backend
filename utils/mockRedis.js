// Mock Redis client - no network connections
const logger = console;

const mockRedis = {
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
  isReady: true,
  on: () => {}, // Ignore event listeners
  connect: async () => 'OK'
};

logger.info('Using mock Redis client - no network connections');
module.exports = mockRedis;
