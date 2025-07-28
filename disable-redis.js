process.env.DISABLE_REDIS = 'true';

const fake = {
  on()           { /* noop */ },
  connect()      { return Promise.resolve(); },
  quit()         { return Promise.resolve(); },
  disconnect()   { /* noop */ },
  get()          { return Promise.resolve(null); },
  set()          { return Promise.resolve('OK'); },
  del()          { return Promise.resolve(1); },
  exists()       { return Promise.resolve(0); },
  ping()         { return Promise.resolve('PONG'); },
  expire()       { return Promise.resolve(1); },
  ttl()          { return Promise.resolve(-1); },
  keys()         { return Promise.resolve([]); },
  flushall()     { return Promise.resolve('OK'); }
};

const originalLoad = require('module')._load;
require('module')._load = function(id, parent, isMain) {
  // ONLY block Redis modules - be very specific
  if (id === 'redis' || id === 'ioredis' || id === '@socket.io/redis-adapter') {
    console.log(`🔴 Redis require blocked for: ${id}`);
    return () => fake;
  }
  // Allow ALL other modules to load normally
  return originalLoad.apply(this, arguments);
};

console.log('🔴 Redis hot patch active - blocking only Redis modules');
