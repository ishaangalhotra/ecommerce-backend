require('dotenv').config();
require('express-async-errors');

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const http = require('http');
const os = require('os');
const cluster = require('cluster');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const pidusage = require('pidusage');
const { PerformanceObserver, performance } = require('perf_hooks');
const mongoose = require('mongoose');
const logger = require('./utils/logger');

// ================== CONFIG ==================
const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  HOST: process.env.HOST || '0.0.0.0',
  ENABLE_CLUSTER: process.env.ENABLE_CLUSTER_MODE === 'true',
  MAX_WORKERS: Math.max(1, os.cpus().length),
  MONGODB_URI: process.env.MONGODB_URI,
  ENABLE_HELMET: process.env.ENABLE_HELMET === 'true',
  ENABLE_COMPRESSION: process.env.ENABLE_COMPRESSION === 'true',
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX, 10) || 1000,
  PROMETHEUS: process.env.ENABLE_METRICS === 'true',
  GC_ENABLED: typeof global.gc === 'function',
  HEAP_THRESHOLD: parseFloat(process.env.HEAP_THRESHOLD) || 0.7,
  RESOURCE_MONITOR_INTERVAL: parseInt(process.env.RESOURCE_MONITOR_INTERVAL_MS, 10) || 10000,
  REDIS_URL: process.env.REDIS_URL,
};

// ================== REDIS MANAGER ==================
class RedisManager {
  static client = null;
  static mockClient = {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    exists: async () => 0,
    expire: async () => 1,
    quit: async () => 'OK'
  };

  static async initialize() {
    if (!config.REDIS_URL) {
      logger.info('Redis URL not provided, using mock client');
      this.client = this.mockClient;
      return;
    }
    try {
      const redis = require('redis');
      this.client = redis.createClient({ url: config.REDIS_URL });
      this.client.on('error', err => {
        logger.error('Redis client error', err);
        this.client = this.mockClient;
      });
      await this.client.connect();
      logger.info('Redis client connected');
    } catch (err) {
      logger.warn('Redis init failed, using mock client', { error: err.message });
      this.client = this.mockClient;
    }
  }

  static getClient() {
    return this.client || this.mockClient;
  }

  static async close() {
    if (this.client && this.client !== this.mockClient) {
      await this.client.quit();
      logger.info('Redis connection closed');
    }
  }
}

// ================== DATABASE ==================
class Database {
  static async connect(uri) {
    if (!uri) {
      logger.warn('No DB URI provided');
      return;
    }
    mongoose.set('strictQuery', false);
    const opts = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    };
    let attempts = 0;
    const maxRetries = 5;
    const baseDelay = 2000;
    while (attempts < maxRetries) {
      try {
        await mongoose.connect(uri, opts);
        logger.info('Database connected', { host: mongoose.connection.host, name: mongoose.connection.name });
        return;
      } catch (err) {
        attempts++;
        logger.warn('DB connect failed', { attempt: attempts, error: err.message });
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempts - 1)));
      }
    }
  }
}

// ================== RESOURCE MONITOR ==================
class ResourceMonitor {
  constructor() {
    this.interval = config.RESOURCE_MONITOR_INTERVAL;
    this.pid = process.pid;
    this.timer = null;
  }
  start() {
    this.timer = setInterval(async () => {
      const stats = await pidusage(this.pid);
      const heapUsedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);
      logger.info('resource-stats', { cpu: stats.cpu, memMB: Math.round(stats.memory / 1024 / 1024), heapUsedMB, heapTotalMB });
      if (config.GC_ENABLED && heapUsedMB / heapTotalMB > config.HEAP_THRESHOLD) {
        logger.warn('high-heap-usage, triggering GC');
        global.gc();
      }
    }, this.interval);
  }
  stop() { clearInterval(this.timer); }
}

// ================== CREATE APP ==================
async function createApp() {
  const app = express();
  await RedisManager.initialize();

  app.use((req, res, next) => {
    req.id = req.get('X-Request-Id') || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  if (config.ENABLE_HELMET) app.use(helmet());
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(mongoSanitize());
  app.use(xss());
  app.use(hpp());
  if (config.ENABLE_COMPRESSION) app.use(compression());

  if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
    app.use(morgan('combined', { stream: { write: msg => logger.info('http-request', { message: msg.trim() }) } }));
  }

  if (config.RATE_LIMIT_ENABLED) {
    app.use(rateLimit({ windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX }));
    app.use(slowDown({ windowMs: config.RATE_LIMIT_WINDOW_MS, delayAfter: 100, delayMs: 50 }));
  }

  app.get('/health', async (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Core routes
  try {
    const authRouter = require('./routes/auth');
    app.use('/api/v1/auth', authRouter);
  } catch (e) {
    logger.warn('auth route missing');
  }

  try {
    const imagekitRouter = require('./routes/imagekit');
    app.use('/api/v1', imagekitRouter);
  } catch (e) {
    logger.warn('imagekit route missing');
  }

  // Dynamic route loading
  fs.readdirSync(path.join(__dirname, 'routes')).forEach(file => {
    if (file.endsWith('.js') && !['auth.js', 'imagekit.js'].includes(file)) {
      try {
        const route = require(`./routes/${file}`);
        app.use(`/api/v1/${file.replace('.js', '')}`, route);
      } catch (err) {
        logger.error('route load failed', { file, error: err.message });
      }
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

  app.use((err, req, res, next) => {
    logger.error('unhandled-error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ================== START SERVER ==================
async function start() {
  if (config.ENABLE_CLUSTER && cluster.isPrimary) {
    for (let i = 0; i < config.MAX_WORKERS; i++) cluster.fork();
    cluster.on('exit', () => cluster.fork());
    return;
  }
  const app = await createApp();
  const server = http.createServer(app);
  global._server = server;

  await Database.connect(config.MONGODB_URI);

  const monitor = new ResourceMonitor();
  monitor.start();
  global._monitor = monitor;

  server.listen(config.PORT, config.HOST, () => {
    logger.info('server-started', { port: config.PORT, env: config.NODE_ENV });
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function shutdown() {
  if (global._monitor) global._monitor.stop();
  await RedisManager.close();
  await mongoose.connection.close();
  if (global._server) global._server.close();
  process.exit(0);
}

if (require.main === module) start();

