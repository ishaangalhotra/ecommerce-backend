/*
  QuickLocal - Production-Grade server.js (fixed)
  - Async/await consistent
  - Structured logging (winston)
  - Memory, CPU, and event-loop lag monitoring
  - Prometheus metrics (express-prom-bundle) with proper normalizePath tuple
  - Graceful shutdown and clustering support
  - Lazy route loading for non-critical routes
  - Config manager with validation (includes JWT_SECRET & SESSION_SECRET)
  - Minimal synchronous work on startup
  - express-slow-down v2 config fixed (no warning)

  Notes:
  - This file assumes environment variables are set (see your .env).
  - Keep NODE_OPTIONS and runtime flags (e.g. --expose-gc) as needed.
*/

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

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
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const promBundle = require('express-prom-bundle');
const { performance, PerformanceObserver } = require('perf_hooks');
const pidusage = require('pidusage');
const morgan = require('morgan');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

/* ---------------------------------
 * Configuration helper
 * --------------------------------- */
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
      MAX_WORKERS: Math.max(
        1,
        Math.min(os.cpus().length, parseInt(this.env.CLUSTER_WORKERS || '0', 10) || os.cpus().length)
      ),

      // Required secrets
      MONGODB_URI: this.env.MONGODB_URI || this.env.MONGO_URI,
      JWT_SECRET: this.env.JWT_SECRET,
      SESSION_SECRET: this.env.SESSION_SECRET,

      // Redis flags (auto-mocked if not present)
      REDIS_URL: this.env.REDIS_URL,
      REDIS_ENABLED:
        this.env.REDIS_ENABLED === 'true' &&
        !this.env.DISABLE_REDIS &&
        !!this.env.REDIS_URL,

      ENABLE_HELMET: this.env.ENABLE_HELMET === 'true' || this.env.HELMET_ENABLED === 'true',
      ENABLE_COMPRESSION: this.env.ENABLE_COMPRESSION === 'true',

      RATE_LIMIT_ENABLED: this.env.RATE_LIMIT_ENABLED !== 'false',
      RATE_LIMIT_WINDOW_MS: parseInt(this.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
      RATE_LIMIT_MAX: parseInt(this.env.RATE_LIMIT_MAX, 10) || 1000,

      LOG_DIR: this.env.LOG_DIR || './logs',
      LOG_LEVEL: this.env.LOG_LEVEL || 'info',

      PROMETHEUS: this.env.ENABLE_METRICS === 'true' || false,

      // GC toggle (requires --expose-gc)
      GC_ENABLED: typeof global.gc === 'function',

      // Resource monitor tuning
      HEAP_THRESHOLD: parseFloat(this.env.HEAP_THRESHOLD) || 0.7,
      RESOURCE_MONITOR_INTERVAL: parseInt(this.env.RESOURCE_MONITOR_INTERVAL_MS, 10) || 10000,
    };
  }

  validate() {
    const missing = this.required.filter((k) => !this.values[k] && !this.env.DEBUG_MODE);
    if (missing.length) {
      console.warn('⚠️ Missing required env vars:', missing.join(', '));
      if (this.values.NODE_ENV === 'production') {
        throw new Error(`Missing env vars: ${missing.join(', ')}`);
      }
    }
  }
}

const config = new Config().values;

/* ---------------------------------
 * Logger (winston)
 * --------------------------------- */
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'quicklocal-backend' },
  transports: [new winston.transports.Console({ stderrLevels: ['error'] })],
});

// ensure log dir exists (non-blocking)
(async () => {
  try {
    await fs.mkdir(config.LOG_DIR, { recursive: true });
  } catch (_) {}
})();

/* ---------------------------------
 * Health + Metrics middleware
 * --------------------------------- */
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  // FIX: use proper [regex, replacement] tuple(s)
  normalizePath: [[/^\/api\/v1\/[^/]+/, '/api/v1/*']],
});

/* ---------------------------------
 * Memory / CPU / Event loop monitor
 * --------------------------------- */
class ResourceMonitor {
  constructor(opts = {}) {
    this.interval = opts.interval || config.RESOURCE_MONITOR_INTERVAL;
    this.pid = process.pid;
    this.timer = null;
    this.observer = null;
    this.heapThreshold = config.HEAP_THRESHOLD;
  }

  start() {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
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
            eventLoopLagMs: Math.round(lag),
          });

          const heapUsageRatio = heapTotalMB > 0 ? heapUsedMB / heapTotalMB : 0;
          if (config.GC_ENABLED && heapUsageRatio > this.heapThreshold) {
            logger.warn('high-heap-usage, attempting gc', {
              heapUsedMB,
              heapTotalMB,
              usageRatio: heapUsageRatio.toFixed(2),
            });
            try {
              global.gc();
              logger.debug('gc-triggered-successfully');
            } catch (e) {
              logger.debug('gc-failed', e.message);
            }
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

/* ---------------------------------
 * Database manager
 * --------------------------------- */
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
      family: 4,
      // Tame index spam on prod
      autoIndex: false,
      bufferCommands: false,
    };

    let attempts = 0;
    const maxRetries = parseInt(process.env.DB_MAX_RETRY_ATTEMPTS, 10) || 5;
    const baseDelay = parseInt(process.env.DB_RETRY_DELAY_MS, 10) || 2000;

    // keep compatibility with older schemas
    mongoose.set('strictQuery', false);

    while (attempts < maxRetries) {
      try {
        await mongoose.connect(uri, opts);
        logger.info('Database connected', {
          host: mongoose.connection.host,
          name: mongoose.connection.name,
        });
        mongoose.connection.on('error', (err) => logger.error('mongoose-error', err));
        mongoose.connection.on('disconnected', () => logger.warn('mongoose-disconnected'));
        mongoose.connection.on('reconnected', () => logger.info('mongoose-reconnected'));
        return;
      } catch (err) {
        attempts += 1;
        const delay = baseDelay * Math.pow(2, attempts - 1);
        logger.warn('db-connect-attempt-failed', {
          attempt: attempts,
          err: err.message,
          retryInMs: delay,
        });
        if (attempts >= maxRetries) throw err;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  static async health() {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return { status: 'down', readyState: mongoose.connection?.readyState };
    }
    try {
      const start = Date.now();
      await mongoose.connection.db.admin().ping();
      return {
        status: 'up',
        pingMs: Date.now() - start,
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        name: mongoose.connection.name,
      };
    } catch (e) {
      return { status: 'down', error: e.message, readyState: mongoose.connection.readyState };
    }
  }
}

/* ---------------------------------
 * Redis manager (optional; auto-mock if missing)
 * --------------------------------- */
class RedisManager {
  static client = null;

  static mockClient = {
    async get() { return null; },
    async set() { return 'OK'; },
    async del() { return 1; },
    async exists() { return 0; },
    async expire() { return 1; },
    async ping() { return 'PONG'; },
    async quit() { return 'OK'; },
  };

  static async initialize() {
    if (!config.REDIS_ENABLED || !config.REDIS_URL) {
      logger.info('Redis URL not provided or disabled, using mock client');
      this.client = this.mockClient;
      return this.client;
    }

    try {
      // If your environment blocks redis/ioredis via a preload, this try/catch ensures fallback.
      const redis = require('redis');
      const client = redis.createClient({ url: config.REDIS_URL });

      client.on('error', (err) => {
        logger.error('Redis client error', { message: err.message });
      });

      client.on('ready', () => {
        logger.info('Redis client connected');
      });

      await client.connect();
      this.client = client;
      return client;
    } catch (error) {
      logger.warn('Redis unavailable, using mock client', { error: error.message });
      this.client = this.mockClient;
      return this.client;
    }
  }

  static getClient() {
    return this.client || this.mockClient;
  }

  static async close() {
    if (this.client && this.client !== this.mockClient && this.client.quit) {
      try {
        await this.client.quit();
        logger.info('Redis connection closed');
      } catch (error) {
        logger.error('Error closing Redis connection', { message: error.message });
      }
    }
  }
}

/* ---------------------------------
 * App factory
 * --------------------------------- */
async function createApp() {
  const app = express();

  // Initialize Redis (non-blocking if mocked)
  await RedisManager.initialize();

  // Request ID
  app.use((req, res, next) => {
    req.id = req.get('X-Request-Id') || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY === '1');
  }

  // Optional request log
  if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
    app.use(
      morgan('combined', {
        stream: {
          write: (msg) => logger.info('http', { message: msg.trim() }),
        },
      })
    );
  }

  // Security + parsers
  if (config.ENABLE_HELMET) {
    app.use(
      helmet({
        contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
      })
    );
  }

  app.use(
    express.json({
      limit: process.env.MAX_REQUEST_SIZE || '10mb',
      strict: false,
    })
  );
  app.use(
    express.urlencoded({
      extended: true,
      limit: process.env.MAX_REQUEST_SIZE || '10mb',
    })
  );
  app.use(cookieParser(process.env.COOKIE_SECRET));

  if (config.ENABLE_COMPRESSION) {
    app.use(
      compression({
        threshold: 1024,
        level: 6,
      })
    );
  }

  // CORS
  if (process.env.ENABLE_CORS !== 'false') {
    const corsOpts = {
      origin: (origin, cb) => cb(null, true),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    };
    app.use(cors(corsOpts));
  }

  // Metrics
  if (config.PROMETHEUS) {
    app.use(metricsMiddleware);
  } else {
    app.get('/metrics', (req, res) => res.status(200).send('# Metrics disabled\n'));
  }

  // Rate limiting + slow down (FIXED for v2)
  if (config.RATE_LIMIT_ENABLED) {
    app.use(
      rateLimit({
        windowMs: config.RATE_LIMIT_WINDOW_MS,
        max: config.RATE_LIMIT_MAX,
        message: { error: 'Too many requests from this IP, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
      })
    );

    app.use(
      slowDown({
        windowMs: config.RATE_LIMIT_WINDOW_MS,
        delayAfter: 100,
        delayMs: 50, // fixed value as per v2 recommendation
        maxDelayMs: 20000,
        validate: { delayMs: false }, // silence deprecation warning helper
      })
    );
  }

  // Health
  app.get('/health', async (req, res) => {
    try {
      const db = await Database.health();
      const redis = RedisManager.getClient();

      let redisStatus = 'up';
      try {
        if (redis !== RedisManager.mockClient && redis.ping) {
          await redis.ping();
        } else if (redis === RedisManager.mockClient) {
          redisStatus = 'mock';
        }
      } catch {
        redisStatus = 'down';
      }

      const status = {
        status: (db.status === 'up' && redisStatus !== 'down') ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        env: config.NODE_ENV,
        version: process.env.npm_package_version || '1.0.0',
        db,
        redis: { status: redisStatus },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      };

      const httpStatus = status.status === 'ok' ? 200 : 503;
      return res.status(httpStatus).json(status);
    } catch (error) {
      logger.error('health-check-error', { message: error.message });
      return res.status(503).json({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // API routes
  const apiBase = process.env.API_BASE_PATH || '/api/v1';

  // Core auth route
  try {
    const authRouter = require('./routes/auth');
    app.use(path.join(apiBase, 'auth'), authRouter);
    logger.info('mounted-core-route', { route: 'auth' });
  } catch (e) {
    logger.warn('auth-route-missing', { error: e.message });
  }

  // Lazy optional routes (loaded on first API hit)
  app.use(apiBase, async (req, res, next) => {
    if (!app.locals._lazyLoaded) {
      app.locals._lazyLoaded = true;
      setImmediate(() => {
        const optional = [
          { mount: 'products', mod: './routes/products' },
          { mount: 'orders', mod: './routes/orders' },
          { mount: 'users', mod: './routes/users' },
          { mount: 'categories', mod: './routes/categories' },
          { mount: 'reviews', mod: './routes/reviews' },
        ];
        for (const r of optional) {
          try {
            const mod = require(r.mod);
            app.use(path.join(apiBase, r.mount), mod);
            logger.info('mounted-optional-route', { route: r.mount });
          } catch (err) {
            logger.debug('optional-route-missing', { route: r.mod, error: err.message });
          }
        }
      });
    }
    next();
  });

  // 404
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    const errorId = uuidv4();
    logger.error('unhandled-error', {
      errorId,
      message: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      ip: req.ip,
    });

    res.status(err.status || 500).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      errorId,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

/* ---------------------------------
 * Graceful shutdown helpers
 * --------------------------------- */
const shutdown = async (signal) => {
  if (global._shuttingDown) return;
  global._shuttingDown = true;

  logger.info('shutdown-init', { signal, pid: process.pid });

  // Close server
  if (global._server) {
    global._server.close((err) => {
      if (err) logger.error('server-close-error', { message: err.message });
      else logger.info('server-closed');
    });
  }

  // Stop monitoring
  if (global._monitor) {
    global._monitor.stop();
    logger.info('resource-monitor-stopped');
  }

  // Close DB
  try {
    await mongoose.connection.close(false);
    logger.info('mongoose-closed');
  } catch (e) {
    logger.warn('mongoose-close-failed', { error: e.message });
  }

  // Close Redis
  try {
    await RedisManager.close();
  } catch (e) {
    logger.warn('redis-close-failed', { error: e.message });
  }

  setTimeout(() => {
    logger.info('shutdown-complete', { signal });
    process.exit(0);
  }, parseInt(process.env.SHUTDOWN_WAIT_MS, 10) || 5000);
};

/* ---------------------------------
 * Server start / cluster
 * --------------------------------- */
async function start() {
  try {
    // cluster.isPrimary in Node >=16; keep fallback for older
    const isPrimary = typeof cluster.isPrimary === 'boolean' ? cluster.isPrimary : cluster.isMaster;

    if (config.ENABLE_CLUSTER && isPrimary) {
      logger.info('cluster-master-starting', {
        workers: config.MAX_WORKERS,
        pid: process.pid,
      });

      for (let i = 0; i < config.MAX_WORKERS; i++) cluster.fork();

      cluster.on('exit', (worker, code, signal) => {
        logger.warn('worker-exit', { pid: worker.process.pid, code, signal });
        setTimeout(() => cluster.fork(), 1000);
      });
      return;
    }

    const app = await createApp();
    const server = http.createServer(app);
    global._server = server;

    // DB connect
    try {
      await Database.connect(config.MONGODB_URI);
    } catch (e) {
      logger.error('database-connection-failed', { error: e.message });
      if (config.NODE_ENV === 'production') throw e;
    }

    // Start monitor
    const monitor = new ResourceMonitor({ interval: config.RESOURCE_MONITOR_INTERVAL });
    monitor.start();
    global._monitor = monitor;

    // Listen
    server.listen(config.PORT, config.HOST, () => {
      logger.info('server-started', {
        host: config.HOST,
        port: config.PORT,
        pid: process.pid,
        env: config.NODE_ENV,
        cluster: config.ENABLE_CLUSTER ? 'worker' : 'standalone',
      });
    });

    // Signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
      logger.error('uncaughtException', { message: err.message, stack: err.stack });
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('unhandledRejection', {
        reason: reason && reason.message ? reason.message : String(reason),
      });
    });
  } catch (error) {
    logger.error('startup-failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Boot
if (require.main === module) {
  start().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
