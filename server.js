/*
  QuickLocal - Refactored Production-Grade server.js
  - Async/await consistent
  - Structured logging (winston)
  - Memory, CPU, and event-loop lag monitoring
  - Prometheus metrics (express-prom-bundle)
  - Graceful shutdown and clustering support
  - Lazy route loading for non-critical routes
  - Config manager with validation
  - Minimal synchronous work on startup

  Notes:
  - This file assumes environment variables are set (see your .env).
  - Keep NODE_OPTIONS and runtime flags (e.g. --expose-gc) as needed.
  - The code aims to be clear and easily extensible.
*/

require('dotenv').config();

const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const cluster = require('cluster');
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const promBundle = require('express-prom-bundle');
const { performance, PerformanceObserver } = require('perf_hooks');
const pidusage = require('pidusage');
const morgan = require('morgan');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

// -----------------------------
// Configuration helper
// -----------------------------
class Config {
  constructor(env = process.env) {
    this.env = env;
    this.required = ['MONGODB_URI', 'JWT_SECRET', 'SESSION_SECRET'];
    this.values = this.build();
    this.validate();
  }

  build() {
    return {
      NODE_ENV: this.env.NODE_ENV || 'development',
      PORT: parseInt(this.env.PORT, 10) || 10000,
      HOST: this.env.HOST || '0.0.0.0',
      ENABLE_CLUSTER: (this.env.ENABLE_CLUSTER_MODE === 'true') || false,
      MAX_WORKERS: Math.max(1, Math.min(os.cpus().length, parseInt(this.env.CLUSTER_WORKERS || '0', 10) || os.cpus().length)),
      MONGODB_URI: this.env.MONGODB_URI || this.env.MONGO_URI,
      REDIS_ENABLED: this.env.REDIS_ENABLED === 'true' && !this.env.DISABLE_REDIS,
      ENABLE_HELMET: this.env.ENABLE_HELMET === 'true' || this.env.HELMET_ENABLED === 'true',
      ENABLE_COMPRESSION: this.env.ENABLE_COMPRESSION === 'true',
      RATE_LIMIT_ENABLED: this.env.RATE_LIMIT_ENABLED !== 'false',
      RATE_LIMIT_WINDOW_MS: parseInt(this.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
      RATE_LIMIT_MAX: parseInt(this.env.RATE_LIMIT_MAX, 10) || 1000,
      LOG_DIR: this.env.LOG_DIR || './logs',
      LOG_LEVEL: this.env.LOG_LEVEL || 'info',
      PROMETHEUS: this.env.ENABLE_METRICS === 'true' || false,
      GC_ENABLED: typeof global.gc === 'function'
    };
  }

  validate() {
    const missing = this.required.filter(k => !this.values[k] && !this.env.DEBUG_MODE);
    if (missing.length) {
      console.warn('⚠️ Missing required env vars:', missing.join(', '));
      if (this.values.NODE_ENV === 'production') throw new Error(`Missing env vars: ${missing.join(', ')}`);
    }
  }
}

const config = new Config().values;

// -----------------------------
// Logger (winston)
// -----------------------------
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'quicklocal-backend' },
  transports: [
    new winston.transports.Console({ stderrLevels: ['error'] })
  ]
});

// ensure log dir exists
(async () => {
  try { await fs.mkdir(config.LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
})();

// -----------------------------
// Health + Metrics middleware
// -----------------------------
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  normalizePath: ['/api/v1/:route']
});

// -----------------------------
// Memory / CPU / Event loop monitor
// -----------------------------
class ResourceMonitor {
  constructor(opts = {}) {
    this.interval = opts.interval || 10000; // 10s
    this.pid = process.pid;
    this.timer = null;
    this.observer = null;
  }

  start() {
    const obs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const e of entries) {
        logger.debug('eventloop-lag', { name: e.name, duration: e.duration });
      }
    });
    obs.observe({ entryTypes: ['function'] });
    this.observer = obs;

    this.timer = setInterval(async () => {
      try {
        const stats = await pidusage(this.pid);
        const memMB = Math.round(stats.memory / 1024 / 1024);
        const cpu = Number(stats.cpu.toFixed(1));
        const mu = process.memoryUsage();
        const heapUsedMB = Math.round(mu.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(mu.heapTotal / 1024 / 1024);
        const rssMB = Math.round(mu.rss / 1024 / 1024);

        const start = performance.now();
        setImmediate(() => {
          const lag = Math.max(0, performance.now() - start);
          logger.info('resource-stats', {
            pid: this.pid,
            cpu,
            memMB,
            heapUsedMB,
            heapTotalMB,
            rssMB,
            eventLoopLagMs: Math.round(lag)
          });

          if (config.GC_ENABLED && heapUsedMB > 0.8 * heapTotalMB) {
            logger.warn('high-heap-usage, attempting gc', { heapUsedMB, heapTotalMB });
            try { global.gc(); } catch (e) { logger.debug('gc-failed', e.message); }
          }
        });
      } catch (e) {
        logger.error('resource-monitor-error', e);
      }
    }, this.interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.observer) this.observer.disconnect();
  }
}

// -----------------------------
// Database manager
// -----------------------------
class Database {
  static async connect(uri) {
    if (!uri) {
      logger.warn('No MONGODB_URI provided; skipping DB connect');
      return;
    }

    const opts = {
      maxPoolSize: parseInt(process.env.DB_POOL_SIZE, 10) || 10,
      serverSelectionTimeoutMS: parseInt(process.env.DB_CONNECT_TIMEOUT_MS, 10) || 30000,
      socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT_MS, 10) || 45000,
      family: 4
    };

    let attempts = 0;
    const maxRetries = parseInt(process.env.DB_MAX_RETRY_ATTEMPTS, 10) || 5;
    const baseDelay = parseInt(process.env.DB_RETRY_DELAY_MS, 10) || 2000;

    while (attempts < maxRetries) {
      try {
        await mongoose.connect(uri, opts);
        logger.info('Database connected');
        mongoose.connection.on('error', (err) => logger.error('mongoose-error', err));
        mongoose.connection.on('disconnected', () => logger.warn('mongoose-disconnected'));
        return;
      } catch (err) {
        attempts += 1;
        const delay = baseDelay * Math.pow(2, attempts - 1);
        logger.warn('db-connect-attempt-failed', { attempt: attempts, err: err.message, retryInMs: delay });
        if (attempts >= maxRetries) throw err;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  static async health() {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) return { status: 'down' };
    try {
      const start = Date.now();
      await mongoose.connection.db.admin().ping();
      return { status: 'up', pingMs: Date.now() - start };
    } catch (e) {
      return { status: 'down', error: e.message };
    }
  }
}

// -----------------------------
// App factory
// -----------------------------
async function createApp() {
  const app = express();

  app.use((req, res, next) => {
    req.id = req.get('X-Request-Id') || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1');

  if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
    app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
  }

  if (config.ENABLE_HELMET) app.use(helmet());

  app.use(express.json({ limit: process.env.MAX_REQUEST_SIZE || '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.MAX_REQUEST_SIZE || '10mb' }));
  app.use(cookieParser(process.env.COOKIE_SECRET));

  if (config.ENABLE_COMPRESSION) app.use(compression());

  if (process.env.ENABLE_CORS !== 'false') {
    const corsOpts = { origin: (origin, cb) => cb(null, true), credentials: true };
    app.use(cors(corsOpts));
  }

  if (config.PROMETHEUS) app.use(metricsMiddleware);

  if (config.RATE_LIMIT_ENABLED) {
    app.use(rateLimit({ windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX }));
    app.use(slowDown({ windowMs: config.RATE_LIMIT_WINDOW_MS, delayAfter: 100, delayMs: 50 }));
  }

  app.get('/health', async (req, res) => {
    const db = await Database.health();
    return res.status(db.status === 'up' ? 200 : 503).json({
      status: 'ok',
      env: config.NODE_ENV,
      db
    });
  });

  if (!config.PROMETHEUS) {
    app.get('/metrics', (req, res) => res.status(200).send('metrics disabled'));
  }

  const apiBase = process.env.API_BASE_PATH || '/api/v1';

  try {
    const authRouter = require('./routes/auth');
    app.use(path.join(apiBase, 'auth'), authRouter);
  } catch (e) {
    logger.warn('auth-route-missing', e.message);
  }

  app.use(apiBase, async (req, res, next) => {
    if (!app.locals._lazyLoaded) {
      app.locals._lazyLoaded = true;
      (async function mountOptional() {
        const optional = [
          { mount: 'products', mod: './routes/products' },
          { mount: 'orders', mod: './routes/orders' },
          { mount: 'users', mod: './routes/users' }
        ];
        for (const r of optional) {
          try {
            const mod = require(r.mod);
            app.use(path.join(apiBase, r.mount), mod);
            logger.info('mounted-route', r.mount);
          } catch (err) {
            logger.debug('optional-route-missing', r.mod, err.message);
          }
        }
      })().catch(e => logger.error('lazy-mount-failed', e));
    }
    next();
  });

  app.use((req, res, next) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err, req, res, next) => {
    logger.error('unhandled-error', { message: err.message, stack: err.stack });
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });

  return app;
}

// -----------------------------
// Server start / cluster / graceful shutdown
// -----------------------------
async function start() {
  if (config.ENABLE_CLUSTER && cluster.isMaster) {
    logger.info('master-starting', { workers: config.MAX_WORKERS });
    for (let i = 0; i < config.MAX_WORKERS; i++) cluster.fork();

    cluster.on('exit', (worker, code, signal) => {
      logger.warn('worker-exit', { pid: worker.process.pid, code, signal });
      setTimeout(() => cluster.fork(), 1000);
    });
    return;
  }

  const app = await createApp();
  const server = http.createServer(app);

  try { await Database.connect(config.MONGODB_URI); } catch (e) { logger.error('db-failed', e); }

  const monitor = new ResourceMonitor({ interval: parseInt(process.env.RESOURCE_MONITOR_INTERVAL_MS, 10) || 10000 });
  monitor.start();

  server.listen(config.PORT, config.HOST, () => {
    logger.info('server-started', { host: config.HOST, port: config.PORT, pid: process.pid, env: config.NODE_ENV });
  });

  const shutdown = async (signal) => {
    if (app.locals._shuttingDown) return;
    app.locals._shuttingDown = true;
    logger.info('shutdown-init', { signal });

    server.close(err => {
      if (err) logger.error('server-close-err', err);
    });

    monitor.stop();

    try { await mongoose.connection.close(false); logger.info('mongoose-closed'); } catch (e) { logger.warn('mongoose-close-failed', e.message); }

    setTimeout(() => {
      logger.info('shutdown-complete');
      process.exit(0);
    }, parseInt(process.env.SHUTDOWN_WAIT_MS, 10) || 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => { logger.error('uncaughtException', err); shutdown('uncaughtException'); });
  process.on('unhandledRejection', (reason) => { logger.error('unhandledRejection', reason); });
}

start().catch(err => {
  logger.error('startup-failed', err);
  process.exit(1);
});
