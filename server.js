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
    setex: async () => 'OK',
    del: async () => 1,
    exists: async () => 0,
    expire: async () => 1,
    keys: async () => [],
    quit: async () => 'OK',
    ping: async () => 'PONG'
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
      logger.info('✅ Redis connected successfully');
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
      try {
        await this.client.quit();
        logger.info('Redis connection closed');
      } catch (err) {
        logger.warn('Redis close error', { error: err.message });
      }
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
      maxIdleTimeMS: 30000,
      bufferCommands: false
    };
    let attempts = 0;
    const maxRetries = 5;
    const baseDelay = 2000;
    while (attempts < maxRetries) {
      try {
        await mongoose.connect(uri, opts);
        logger.info('✅ Database connected successfully', { 
          host: mongoose.connection.host, 
          name: mongoose.connection.name 
        });
        return;
      } catch (err) {
        attempts++;
        logger.warn('DB connect failed', { 
          attempt: attempts, 
          error: err.message 
        });
        if (attempts < maxRetries) {
          await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempts - 1)));
        }
      }
    }
    throw new Error('Failed to connect to database after maximum retries');
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
      try {
        const stats = await pidusage(this.pid);
        const memory = process.memoryUsage();
        const heapUsedMB = Math.round(memory.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memory.heapTotal / 1024 / 1024);
        
        logger.info('resource-stats', { 
          cpu: stats.cpu, 
          memMB: Math.round(stats.memory / 1024 / 1024), 
          heapUsedMB, 
          heapTotalMB 
        });
        
        if (config.GC_ENABLED && heapUsedMB / heapTotalMB > config.HEAP_THRESHOLD) {
          logger.warn('high-heap-usage, triggering GC');
          global.gc();
        }
      } catch (err) {
        logger.warn('Resource monitoring error', { error: err.message });
      }
    }, this.interval);
  }
  
  stop() { 
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ================== SOCKET.IO MANAGER ==================
let io = null;
function initializeSocket(server) {
  try {
    const socketIo = require('socket.io');
    io = socketIo(server, {
      cors: { 
        origin: [
          "http://localhost:3000",
          "http://localhost:5500", 
          "http://127.0.0.1:5500",
          "https://localhost:3000",
          "https://my-frontend-ifyr-l0ubyao0q-ishans-projects-67ccbc5a.vercel.app",
          "https://www.quicklocal.shop",
          "https://my-frontend-ifyr.vercel.app"
        ], 
        methods: ["GET", "POST"] 
      }
    });
    
    io.on('connection', (socket) => {
      logger.info('Socket client connected', { id: socket.id });
      
      socket.on('disconnect', () => {
        logger.info('Socket client disconnected', { id: socket.id });
      });
    });
    
    logger.info('✅ Socket.IO initialized');
    return io;
  } catch (error) {
    logger.warn('Socket.IO not available, real-time features disabled');
    return null;
  }
}

// ================== CREATE APP ==================
async function createApp() {
  const app = express();
  await RedisManager.initialize();

  // Trust first proxy (needed for rate-limit & secure cookies on Render/Vercel)
  app.set('trust proxy', 1);

  // Request ID middleware
  app.use((req, res, next) => {
    req.id = req.get('X-Request-Id') || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // Security and performance middleware
  if (config.ENABLE_HELMET) {
    app.use(helmet({
      contentSecurityPolicy: config.NODE_ENV === 'production' ? true : false,
      crossOriginEmbedderPolicy: false
    }));
  }
  
  // CORS Configuration - Clean and flexible
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["*"];

  app.use(cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS: " + origin));
      }
    },
    credentials: true
  }));
  
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());
  app.use(xss());
  app.use(hpp());
  
  if (config.ENABLE_COMPRESSION) {
    app.use(compression());
  }

  // Request logging
  if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
    app.use(morgan('combined', { 
      stream: { 
        write: msg => logger.info('http-request', { message: msg.trim() }) 
      } 
    }));
  }

  // Rate limiting - Fixed configuration
  if (config.RATE_LIMIT_ENABLED) {
    const limiter = rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
      message: { error: 'Too many requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/health';
      }
    });
    
    const speedLimiter = slowDown({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      delayAfter: Math.floor(config.RATE_LIMIT_MAX * 0.1), // 10% of max requests
      delayMs: (hits) => hits * 100, // Increase delay by 100ms for each request
      maxDelayMs: 5000, // Maximum delay of 5 seconds
      skip: (req) => {
        // Skip speed limiting for health checks
        return req.path === '/health';
      }
    });
    
    app.use('/api', limiter);
    app.use('/api', speedLimiter);
  }

  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        redis: await checkRedisHealth(),
        version: '2.0.0',
        environment: config.NODE_ENV
      };
      res.json(health);
    } catch (error) {
      logger.error('Health check error', { error: error.message });
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Health check failed'
      });
    }
  });

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({ 
      message: 'QuickLocal Backend API', 
      version: '2.0.0',
      status: 'running',
      docs: '/api/v1/docs',
      health: '/health'
    });
  });

  // Configuration summary log
  logger.info('📋 Configuration Summary:', {
    environment: config.NODE_ENV,
    port: config.PORT,
    database: config.MONGODB_URI ? 'configured' : 'not configured',
    redis: config.REDIS_URL ? 'enabled' : 'disabled',
    features: {
      helmet: config.ENABLE_HELMET,
      compression: config.ENABLE_COMPRESSION,
      rateLimiting: config.RATE_LIMIT_ENABLED,
      cluster: config.ENABLE_CLUSTER
    }
  });

  // Load core routes with error handling
  const coreRoutes = [
    { path: '/api/v1/auth', file: './routes/auth' },
    { path: '/api/v1/imagekit', file: './routes/imagekit' }
  ];

  for (const route of coreRoutes) {
    try {
      const routeFilePath = path.resolve(__dirname, route.file);
      if (fs.existsSync(routeFilePath + '.js')) {
        const router = require(route.file);
        app.use(route.path, router);
        logger.info('✅ Core route loaded', { path: route.path, file: route.file });
      } else {
        logger.warn('Core route file not found', { path: route.path, file: route.file });
      }
    } catch (err) {
      logger.warn('Core route load failed', { 
        path: route.path, 
        file: route.file, 
        error: err.message 
      });
    }
  }

  // Dynamic route loading with better error handling
  const routesPath = path.join(__dirname, 'routes');
  const skipFiles = ['auth.js', 'imagekit.js', 'index.js'];
  
  if (fs.existsSync(routesPath)) {
    try {
      const files = fs.readdirSync(routesPath);
      
      files.forEach(file => {
        if (file.endsWith('.js') && !skipFiles.includes(file)) {
          try {
            const routePath = path.join(routesPath, file);
            
            // Check if file exists and is readable
            if (fs.existsSync(routePath)) {
              const route = require(routePath);
              const routeName = file.replace('.js', '');
              
              // Validate that the required export is a valid Express router/middleware
              if (typeof route === 'function' || (route && typeof route.use === 'function')) {
                app.use(`/api/v1/${routeName}`, route);
                logger.info('✅ Dynamic route loaded', { route: routeName, file });
              } else {
                logger.warn('Invalid route export', { file, type: typeof route });
              }
            }
          } catch (err) {
            logger.error('Route load failed', { 
              file, 
              error: err.message,
              stack: config.NODE_ENV === 'development' ? err.stack : undefined
            });
            // Continue loading other routes instead of crashing
          }
        }
      });
    } catch (err) {
      logger.error('Error reading routes directory', { error: err.message });
    }
  } else {
    logger.warn('Routes directory not found', { path: routesPath });
  }

  // 404 handler
  app.use('*', (req, res) => {
    logger.warn('Route not found', { 
      path: req.originalUrl, 
      method: req.method,
      userAgent: req.get('User-Agent')
    });
    
    res.status(404).json({ 
      error: 'Route not found',
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
      suggestion: 'Check the API documentation for available endpoints'
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    // Log error with context
    logger.error('Unhandled error', { 
      message: err.message, 
      stack: config.NODE_ENV === 'development' ? err.stack : undefined,
      path: req.path,
      method: req.method,
      body: config.NODE_ENV === 'development' ? req.body : undefined,
      query: req.query,
      params: req.params,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    
    const status = err.status || err.statusCode || 500;
    const message = config.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message;
    
    res.status(status).json({ 
      error: message,
      timestamp: new Date().toISOString(),
      requestId: req.id,
      ...(config.NODE_ENV === 'development' && { 
        stack: err.stack,
        details: err.details || undefined
      })
    });
  });

  return app;
}

// ================== REDIS HEALTH CHECK ==================
async function checkRedisHealth() {
  try {
    const client = RedisManager.getClient();
    if (client === RedisManager.mockClient) {
      return 'mock';
    }
    await client.ping();
    return 'connected';
  } catch (err) {
    logger.warn('Redis health check failed', { error: err.message });
    return 'disconnected';
  }
}

// ================== START SERVER ==================
async function start() {
  try {
    // Cluster mode
    if (config.ENABLE_CLUSTER && cluster.isPrimary) {
      logger.info('Starting cluster mode', { workers: config.MAX_WORKERS });
      
      for (let i = 0; i < config.MAX_WORKERS; i++) {
        cluster.fork();
      }
      
      cluster.on('exit', (worker, code, signal) => {
        logger.warn('Worker died, restarting...', { 
          worker: worker.process.pid, 
          code, 
          signal 
        });
        cluster.fork();
      });
      
      cluster.on('online', (worker) => {
        logger.info('Worker started', { worker: worker.process.pid });
      });
      
      return;
    }

    // Single process mode
    const app = await createApp();
    const server = http.createServer(app);
    global._server = server;

    // Initialize Socket.IO if available
    const socketIo = initializeSocket(server);
    global._io = socketIo;

    // Connect to database
    if (config.MONGODB_URI) {
      await Database.connect(config.MONGODB_URI);
    }

    // Start resource monitoring
    const monitor = new ResourceMonitor();
    monitor.start();
    global._monitor = monitor;

    // Start server with proper error handling
    server.listen(config.PORT, config.HOST, () => {
      logger.info('🚀 Server started successfully', { 
        port: config.PORT, 
        host: config.HOST,
        env: config.NODE_ENV,
        pid: process.pid,
        node: process.version,
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
      });
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${config.PORT} is already in use`);
      } else {
        logger.error('Server error', { error: error.message, code: error.code });
      }
      process.exit(1);
    });

    // Graceful shutdown handlers
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception - shutting down', { 
        error: err.message, 
        stack: err.stack 
      });
      shutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection - shutting down', { 
        reason: reason?.toString(), 
        promise: promise?.toString()
      });
      shutdown('UNHANDLED_REJECTION');
    });

  } catch (error) {
    logger.error('Server startup failed', { 
      error: error.message, 
      stack: error.stack 
    });
    process.exit(1);
  }
}

// ================== SHUTDOWN ==================
async function shutdown(signal = 'SIGTERM') {
  logger.info('Initiating graceful shutdown', { signal });
  
  const shutdownTimeout = setTimeout(() => {
    logger.error('Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 30000); // 30 second timeout
  
  try {
    // Stop accepting new connections
    if (global._server) {
      global._server.close(() => {
        logger.info('HTTP server stopped accepting new connections');
      });
    }
    
    // Stop resource monitoring
    if (global._monitor) {
      global._monitor.stop();
      logger.info('Resource monitoring stopped');
    }
    
    // Close Socket.IO
    if (global._io) {
      global._io.close();
      logger.info('Socket.IO closed');
    }
    
    // Close Redis connection
    await RedisManager.close();
    
    // Close database connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      logger.info('Database connection closed');
    }
    
    // Clear shutdown timeout
    clearTimeout(shutdownTimeout);
    
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
    
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Export for testing
module.exports = { createApp, start, shutdown, config };

// Start server if this is the main module
if (require.main === module) {
  start();
}
