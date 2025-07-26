// disable-redis.js - Hot patch to stop Redis connections
process.env.DISABLE_REDIS = 'true';      // double-lock

const fake = {                           // minimal stub
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

require('module')._load = ((orig) => (id, parent, isMain) => {
  if (id === 'redis' || id.startsWith('ioredis')) {
    console.log(`🔴 Redis require blocked for: ${id}`);
    return () => fake;
  }
  return orig(id, parent, isMain);
})(require('module')._load);

console.log('🔴 Redis module completely disabled via hot patch');