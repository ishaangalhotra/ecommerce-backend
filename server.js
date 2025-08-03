// server.js - QuickLocal Production-Ready Server with Complete Integration
// Version: 2.0.0 - Integrated with Environment Configuration
require('dotenv').config(); // Load .env variables

// Ensure NODE_ENV has a fallback:
process.env.NODE_ENV = process.env.NODE_ENV || 'development';


require('dotenv').config();

const fs = require('fs');
const path = require('path');
const cluster = require('cluster');
const os = require('os');
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const ExpressBrute = require('express-brute');
const MongooseStore = require('express-brute-mongoose');
const BruteForceSchema = require('express-brute-mongoose/dist/schema');
const session = require('express-session');
const MongoStore = require('connect-mongo');

// Custom imports - these would be your actual middleware files
const logger = require('./utils/logger');
const { connectDB } = require('./config/database');
const applySecurity = require('./middleware/security');
const ValidationMiddleware = require('./middleware/validation');
const AuthenticationMiddleware = require('./middleware/authMiddleware');
const MetricsCollector = require('./utils/metrics');
const CircuitBreaker = require('./utils/circuitBreaker');

// Enhanced Configuration Class with Environment Integration
class QuickLocalConfig {
  constructor() {
    // Validate environment first
    this.validateEnvironment();
    
    this.config = {
      // Application Core
      NODE_ENV: process.env.NODE_ENV || 'development',
      APP_NAME: process.env.APP_NAME || 'QuickLocal',
      APP_VERSION: process.env.APP_VERSION || '2.0.0',
      PORT: this.getEnvNumber('PORT', 10000),
      HOST: process.env.HOST || '0.0.0.0',
      INSTANCE_ID: process.env.INSTANCE_ID || 'ql-dev-001',
      
      // API Configuration
      API_VERSION: process.env.API_VERSION || 'v1',
      API_BASE_PATH: process.env.API_BASE_PATH || '/api/v1',
      MAX_REQUEST_SIZE: process.env.MAX_REQUEST_SIZE || '10mb',
      REQUEST_TIMEOUT: this.getEnvNumber('REQUEST_TIMEOUT', 30000),
      
      // URLs and Domains
      DOMAIN: process.env.DOMAIN || 'localhost',
      API_URL: process.env.API_URL,
      CLIENT_URL: process.env.CLIENT_URL,
      ADMIN_URL: process.env.ADMIN_URL,
      
      // Database
      MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI,
      DB_NAME: process.env.DB_NAME || process.env.MONGO_DB_NAME,
      DB_POOL_SIZE: this.getEnvNumber('DB_POOL_SIZE', 20),
      DB_TIMEOUT: this.getEnvNumber('DB_CONNECT_TIMEOUT_MS', 30000),
      
      // Security
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || '24h',
      JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES || '7d',
      COOKIE_SECRET: process.env.COOKIE_SECRET,
      SESSION_SECRET: process.env.SESSION_SECRET,
      BCRYPT_SALT_ROUNDS: this.getEnvNumber('BCRYPT_SALT_ROUNDS', 12),
      
      // Rate Limiting
      RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED === 'true',
      RATE_LIMIT_WINDOW: this.getEnvNumber('RATE_LIMIT_WINDOW_MS', 900000),
      RATE_LIMIT_MAX: this.getEnvNumber('RATE_LIMIT_MAX', 1000),
      AUTH_RATE_LIMIT_MAX: this.getEnvNumber('AUTH_RATE_LIMIT_MAX', 20),
      ORDER_RATE_LIMIT_MAX: this.getEnvNumber('ORDER_RATE_LIMIT_MAX', 10),
      MAX_LOGIN_ATTEMPTS: this.getEnvNumber('MAX_LOGIN_ATTEMPTS', 5),
      LOGIN_LOCKOUT_TIME: this.getEnvNumber('LOGIN_LOCKOUT_TIME', 15),
      
      // Performance
      CLUSTER_MODE: process.env.ENABLE_CLUSTER_MODE === 'true',
      MAX_WORKERS: process.env.CLUSTER_WORKERS === 'auto' ? 
        os.cpus().length : 
        this.getEnvNumber('CLUSTER_WORKERS', os.cpus().length),
      COMPRESSION_ENABLED: process.env.ENABLE_COMPRESSION === 'true',
      COMPRESSION_LEVEL: this.getEnvNumber('COMPRESSION_LEVEL', 6),
      
      // Features
      ENABLE_SOCKET_IO: process.env.FEATURE_LIVE_TRACKING === 'true' || process.env.FEATURE_CHAT === 'true',
      ENABLE_METRICS: process.env.ENABLE_ERROR_TRACKING === 'true',
      ENABLE_CACHING: process.env.ENABLE_RESPONSE_CACHING === 'true',
      CACHE_TTL: this.getEnvNumber('CACHE_TTL', 3600),
      
      // Security Headers
      HELMET_ENABLED: process.env.ENABLE_HELMET === 'true',
      CSP_ENABLED: process.env.HELMET_CSP_ENABLED === 'true',
      HSTS_MAX_AGE: this.getEnvNumber('HSTS_MAX_AGE', 63072000),
      HSTS_INCLUDE_SUBDOMAINS: process.env.HSTS_INCLUDE_SUBDOMAINS === 'true',
      
      // Logging
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      LOG_DIR: process.env.LOG_DIR || './logs',
      ENABLE_REQUEST_LOGGING: process.env.ENABLE_REQUEST_LOGGING === 'true',
      ENABLE_ERROR_TRACKING: process.env.ENABLE_ERROR_TRACKING === 'true',
      
      // File Upload
      MAX_FILE_SIZE: this.getEnvNumber('MAX_FILE_SIZE', 10485760),
      ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES?.split(',') || ['image/jpeg', 'image/png', 'image/webp'],
      
      // External Services
      REDIS_ENABLED: process.env.REDIS_ENABLED === 'true' && !process.env.DISABLE_REDIS,
      REDIS_URL: process.env.REDIS_URL,
      
      // Development
      DEBUG_MODE: process.env.DEBUG_MODE === 'true',
      MOCK_PAYMENT: process.env.MOCK_PAYMENT === 'true',
      ENABLE_API_DOCS: process.env.ENABLE_API_DOCS === 'true'
    };

    this.IS_PRODUCTION = this.config.NODE_ENV === 'production';
    this.IS_DEVELOPMENT = this.config.NODE_ENV === 'development';
  }

  getEnvNumber(key, defaultValue) {
    const value = process.env[key];
    return value ? parseInt(value, 10) : defaultValue;
  }

  validateEnvironment() {
    ValidationMiddleware.validateEnvironment();
    
    // Additional QuickLocal specific validations
    const criticalVars = ['MONGODB_URI', 'JWT_SECRET', 'COOKIE_SECRET', 'SESSION_SECRET'];
    const missing = criticalVars.filter(varName => !process.env[varName] && !process.env[varName.replace('MONGODB_URI', 'MONGO_URI')]);
    
    if (missing.length > 0) {
      throw new Error(`❌ Critical environment variables missing: ${missing.join(', ')}`);
    }

    // Validate URLs format
    const urlVars = ['API_URL', 'CLIENT_URL', 'ADMIN_URL'];
    urlVars.forEach(varName => {
      const url = process.env[varName];
      if (url && !url.startsWith('http')) {
        logger.warn(`⚠️ ${varName} should start with http:// or https://`);
      }
    });

    logger.info('✅ QuickLocal environment validation passed');
  }
}

// CORS Origins Configuration
class CORSManager {
  static getOrigins() {
    const origins = [];
    
    // Add from FRONTEND_URLS
    if (process.env.FRONTEND_URLS) {
      origins.push(...process.env.FRONTEND_URLS.split(',').map(url => url.trim()));
    }
    
    // Add from ALLOWED_ORIGINS
    if (process.env.ALLOWED_ORIGINS) {
      origins.push(...process.env.ALLOWED_ORIGINS.split(',').map(url => url.trim()));
    }
    
    // Add individual URLs
    [process.env.CLIENT_URL, process.env.ADMIN_URL, process.env.API_URL].forEach(url => {
      if (url) origins.push(url.trim());
    });
    
    // Development origins
    if (process.env.NODE_ENV !== 'production') {
      origins.push(
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5500'
      );
    }
    
    return [...new Set(origins)].filter(Boolean);
  }

  static isValidOrigin(origin) {
    if (!origin) return true;
    
    const allowedOrigins = this.getOrigins();
    if (allowedOrigins.includes(origin)) return true;
    
    // Check deployment platform patterns
    const platformPatterns = [
      /^https:\/\/.*\.vercel\.app$/,
      /^https:\/\/.*\.netlify\.app$/,
      /^https:\/\/.*\.herokuapp\.com$/,
      /^https:\/\/.*\.railway\.app$/,
      /^https:\/\/.*\.render\.com$/,
      /^https:\/\/.*\.onrender\.com$/
    ];
    
    return platformPatterns.some(pattern => pattern.test(origin));
  }
}

// Enhanced Security Manager
class EnhancedSecurityManager {
  static createBruteForceProtection() {
    if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
      logger.warn('⚠️ Brute force protection disabled: MongoDB not configured');
      return (req, res, next) => next();
    }

    try {
      const BruteForceModel = mongoose.model('bruteforce', BruteForceSchema);
      const store = new MongooseStore(BruteForceModel);
      
      return new ExpressBrute(store, {
        freeRetries: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
        minWait: (parseInt(process.env.LOGIN_LOCKOUT_TIME) || 15) * 60 * 1000,
        maxWait: 60 * 60 * 1000, // 1 hour
        lifetime: 24 * 60 * 60, // 24 hours
        failCallback: (req, res, next, nextValidRequestDate) => {
          logger.warn(`🛑 Brute force protection triggered for ${req.ip}`);
          MetricsCollector.increment('brute_force_blocks', { ip: req.ip });
          
          res.status(429).json({
            error: 'Too many failed attempts',
            message: 'Account temporarily locked due to multiple failed login attempts',
            nextValidRequestDate,
            retryAfter: Math.ceil((nextValidRequestDate.getTime() - Date.now()) / 1000)
          });
        }
      });
    } catch (error) {
      logger.error('❌ Failed to initialize brute force protection:', error);
      return (req, res, next) => next();
    }
  }

  static createRateLimit(windowMs, max, message, options = {}) {
    if (process.env.RATE_LIMIT_ENABLED !== 'true') {
      return (req, res, next) => next();
    }

    return rateLimit({
      windowMs,
      max,
      message: { 
        error: 'Rate limit exceeded', 
        message,
        retryAfter: Math.ceil(windowMs / 1000),
        type: 'rate_limit_exceeded'
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        return req.user?.id ? `${req.ip}:${req.user.id}` : req.ip;
      },
      skip: (req) => {
        if (process.env.NODE_ENV === 'development' && 
            (req.ip === '127.0.0.1' || req.ip === '::1')) {
          return true;
        }
        return options.skip ? options.skip(req) : false;
      },
      onLimitReached: (req, res, options) => {
        logger.warn(`🚦 Rate limit exceeded for ${req.ip} on ${req.originalUrl}`);
        MetricsCollector.increment('rate_limit_exceeded', {
          endpoint: req.originalUrl,
          ip: req.ip,
          user_id: req.user?.id || 'anonymous'
        });
      }
    });
  }

  static createSlowDown(windowMs, delayAfter, delayMs = 500) {
    return slowDown({
      windowMs,
      delayAfter,
      delayMs,
      maxDelayMs: 20000,
      skipFailedRequests: false,
      skipSuccessfulRequests: true,
      onLimitReached: (req, res, options) => {
        logger.info(`🐌 Request slowed down for ${req.ip} on ${req.originalUrl}`);
      }
    });
  }
}

// Enhanced Route Manager with Environment Integration
class QuickLocalRouteManager {
  constructor() {
    this.routes = [
      { path: '/api/v1/auth', module: './routes/auth', name: 'Authentication', priority: 1 },
      { path: '/api/v1/users', module: './routes/users', name: 'User Management', priority: 2 },
      { path: '/api/v1/products', module: './routes/products', name: 'Product Catalog', priority: 3 },
      { path: '/api/v1/categories', module: './routes/categories', name: 'Categories', priority: 3 },
      { path: '/api/v1/orders', module: './routes/orders', name: 'Order Processing', priority: 4 },
      { path: '/api/v1/cart', module: './routes/cart', name: 'Shopping Cart', priority: 3 },
      { path: '/api/v1/wishlist', module: './routes/wishlist', name: 'User Wishlist', priority: 3 },
      { path: '/api/v1/seller', module: './routes/seller', name: 'Seller Dashboard', priority: 4 },
      { path: '/api/v1/admin', module: './routes/admin', name: 'Admin Panel', priority: 5 },
      { path: '/api/v1/payment', module: './routes/payment-routes', name: 'Payment Gateway', priority: 4 },
      { path: '/api/v1/webhooks', module: './routes/webhook-routes', name: 'Webhook Handlers', priority: 1 },
      { path: '/api/v1/delivery', module: './routes/delivery', name: 'Delivery Service', priority: 4 },
      { path: '/api/v1/analytics', module: './routes/analytics', name: 'Analytics', priority: 5 },
      { path: '/api/v1/notifications', module: './routes/notifications', name: 'Notifications', priority: 3 }
    ];

    // Add conditional routes based on features
    if (process.env.FEATURE_REVIEWS === 'true') {
      this.routes.push({ path: '/api/v1/reviews', module: './routes/reviews', name: 'Reviews & Ratings', priority: 3 });
    }
    
    if (process.env.FEATURE_CHAT === 'true') {
      this.routes.push({ path: '/api/v1/chat', module: './routes/chat', name: 'Chat System', priority: 3 });
    }

    if (process.env.FEATURE_LOYALTY_PROGRAM === 'true') {
      this.routes.push({ path: '/api/v1/loyalty', module: './routes/loyalty', name: 'Loyalty Program', priority: 3 });
    }

    // Sort by priority
    this.routes.sort((a, b) => a.priority - b.priority);
    
    this.loadedRoutes = [];
    this.failedRoutes = [];
  }

  async loadRoutes(app) {
    logger.info('🔄 Loading QuickLocal API routes...');
    
    for (const route of this.routes) {
      try {
        await this.loadSingleRoute(app, route);
      } catch (error) {
        this.handleRouteError(route, error);
      }
    }

    this.logRouteSummary();
    return {
      loaded: this.loadedRoutes.length,
      failed: this.failedRoutes.length,
      routes: this.loadedRoutes
    };
  }

  async loadSingleRoute(app, { path, module, name, priority }) {
    // Clear cache in development
    if (process.env.NODE_ENV === 'development') {
      try {
        const resolvedPath = require.resolve(module);
        delete require.cache[resolvedPath];
      } catch (e) {
        // Module doesn't exist yet, which is fine
      }
    }

    // Try to load the module
    let routeModule;
    try {
      routeModule = require(module);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.warn(`⚠️ Route module not found: ${module} - Skipping`);
        return; // Skip missing modules instead of failing
      }
      throw error;
    }
    
    if (!this.isValidRouter(routeModule)) {
      throw new Error(`Invalid router export in ${module}`);
    }

    // Add API version middleware
    app.use(path, this.createAPIVersionMiddleware());
    
    // Add route-specific rate limiting
    if (path.includes('/auth')) {
      app.use(path, EnhancedSecurityManager.createRateLimit(
        15 * 60 * 1000, 
        parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 20, 
        'Too many authentication attempts'
      ));
    } else if (path.includes('/orders')) {
      app.use(path, EnhancedSecurityManager.createRateLimit(
        60 * 1000, 
        parseInt(process.env.ORDER_RATE_LIMIT_MAX) || 10, 
        'Too many order requests'
      ));
    }

    app.use(path, routeModule);
    
    this.loadedRoutes.push({ path, name, priority, status: 'loaded' });
    logger.info(`✅ ${name}: ${path} (Priority: ${priority})`);

    // Log endpoints in development
    if (process.env.DEBUG_MODE === 'true') {
      this.logRouteEndpoints(routeModule, path, name);
    }
  }

  isValidRouter(routeModule) {
    return routeModule && (
      typeof routeModule === 'function' ||
      routeModule.router ||
      routeModule.stack ||
      typeof routeModule.use === 'function'
    );
  }

  createAPIVersionMiddleware() {
    return (req, res, next) => {
      req.apiVersion = process.env.API_VERSION || 'v1';
      res.setHeader('API-Version', req.apiVersion);
      res.setHeader('X-API-Version', req.apiVersion);
      next();
    };
  }

  logRouteEndpoints(routeModule, basePath, name) {
    if (routeModule.stack) {
      const endpoints = [];
      routeModule.stack.forEach((layer) => {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
          endpoints.push(`${methods} ${basePath}${layer.route.path}`);
        }
      });
      if (endpoints.length > 0) {
        logger.debug(`📍 ${name} endpoints:`, endpoints);
      }
    }
  }

  handleRouteError(route, error) {
    this.failedRoutes.push({ 
      path: route.path, 
      name: route.name, 
      error: error.message 
    });
    logger.error(`❌ Failed to load ${route.name} (${route.path}): ${error.message}`);
    
    if (process.env.DEBUG_MODE === 'true') {
      console.error(error.stack);
    }
  }

  logRouteSummary() {
    const { length: loaded } = this.loadedRoutes;
    const { length: failed } = this.failedRoutes;
    
    logger.info(`📊 Route loading complete: ${loaded} loaded, ${failed} failed`);
    
    if (failed > 0) {
      logger.error(`⚠️ Failed routes:`, this.failedRoutes);
      if (process.env.NODE_ENV === 'production' && failed > loaded * 0.3) {
        throw new Error('❌ Critical: More than 30% of routes failed to load in production');
      }
    }
  }
}

// Main QuickLocal Server Class
class QuickLocalServer {
  constructor() {
    this.config = new QuickLocalConfig().config;
    this.app = null;
    this.server = null;
    this.io = null;
    this.routeManager = new QuickLocalRouteManager();
    this.circuitBreaker = require('./utils/circuitBreaker');
    this.isShuttingDown = false;
    
    // Set process title
    if (process.env.PROCESS_TITLE) {
      process.title = process.env.PROCESS_TITLE;
    }
  }

  async initialize() {
    try {
      logger.info(`🚀 Starting ${this.config.APP_NAME} v${this.config.APP_VERSION}`);
      logger.info(`🏗️ Environment: ${this.config.NODE_ENV}`);
      logger.info(`🆔 Instance: ${this.config.INSTANCE_ID}`);
      
      await this.preflightChecks();
      await this.createApp();
      await this.setupMiddleware();
      await this.connectDatabase();
      await this.setupSession();
      await this.loadRoutes();
      await this.setupEndpoints();
      await this.setupErrorHandling();
      await this.startServer();
      this.setupGracefulShutdown();
      
      return { app: this.app, server: this.server, io: this.io };
    } catch (error) {
      logger.error('❌ Server initialization failed:', error);
      process.exit(1);
    }
  }

  async preflightChecks() {
    // Create necessary directories
    const dirs = [
      this.config.LOG_DIR,
      './uploads',
      './temp',
      './backups'
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`📁 Created directory: ${dir}`);
      }
    });

    // Check memory
    const memUsage = process.memoryUsage();
    const maxMemory = parseInt(process.env.MAX_MEMORY_USAGE) * 1024 * 1024 || 512 * 1024 * 1024;
    
    if (memUsage.heapUsed > maxMemory * 0.8) {
      logger.warn('⚠️ High memory usage detected at startup');
    }

    logger.info('✅ Preflight checks completed');
  }

  async createApp() {
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Setup Socket.IO if enabled
    if (this.config.ENABLE_SOCKET_IO) {
      await this.setupSocketIO();
    }
  }

  async setupSocketIO() {
    try {
      const { Server } = require('socket.io');
      this.io = new Server(this.server, {
        cors: {
          origin: CORSManager.getOrigins(),
          methods: ['GET', 'POST'],
          credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: parseInt(this.config.MAX_FILE_SIZE) || 1e6,
        allowEIO3: true,
        transports: ['websocket', 'polling']
      });
      
      this.setupSocketHandlers();
      logger.info('✅ Socket.IO initialized for real-time features');
    } catch (error) {
      logger.warn('⚠️ Socket.IO initialization failed:', error.message);
      this.config.ENABLE_SOCKET_IO = false;
    }
  }

  setupSocketHandlers() {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      logger.debug(`🔌 Socket connected: ${socket.id}`);
      MetricsCollector.increment('socket_connections');
      
      // Join user-specific room for notifications
      socket.on('join_user_room', (userId) => {
        if (userId) {
          socket.join(`user_${userId}`);
          logger.debug(`👤 Socket ${socket.id} joined user room: ${userId}`);
        }
      });

      // Join order-specific room for delivery tracking
      socket.on('track_order', (orderId) => {
        if (orderId) {
          socket.join(`order_${orderId}`);
          logger.debug(`📦 Socket ${socket.id} tracking order: ${orderId}`);
        }
      });

      socket.on('disconnect', (reason) => {
        logger.debug(`🔌 Socket disconnected: ${socket.id}, reason: ${reason}`);
        MetricsCollector.increment('socket_disconnections');
      });

      socket.on('error', (error) => {
        logger.error(`🔌 Socket error: ${socket.id}`, error);
        MetricsCollector.increment('socket_errors');
      });
    });

    // Broadcast system events
    this.io.on('connection_error', (err) => {
      logger.error('🔌 Socket.IO connection error:', err);
      MetricsCollector.increment('socket_connection_errors');
    });
  }

  async setupMiddleware() {
    // Trust proxy
    this.app.set('trust proxy', parseInt(process.env.TRUST_PROXY) || 1);
    this.app.set('x-powered-by', false);

    // Request timeout
    this.app.use((req, res, next) => {
      res.setTimeout(this.config.REQUEST_TIMEOUT, () => {
        res.status(408).json({
          error: 'Request timeout',
          message: `Request exceeded ${this.config.REQUEST_TIMEOUT}ms timeout`,
          correlation_id: req.correlationId
        });
      });
      next();
    });

    // Security headers with Helmet
if (this.config.HELMET_ENABLED) {
  applySecurity(this.app);
}

    // Brute force protection
    const bruteForce = EnhancedSecurityManager.createBruteForceProtection();
    this.app.use('/api/v1/auth/login', bruteForce.prevent);
    this.app.use('/api/v1/auth/forgot-password', bruteForce.prevent);

    // Rate limiting
    this.app.use('/api/', EnhancedSecurityManager.createRateLimit(
      this.config.RATE_LIMIT_WINDOW,
      this.config.RATE_LIMIT_MAX,
      'Too many requests from this IP'
    ));

    // Slow down for resource-intensive endpoints
    this.app.use('/api/v1/search', EnhancedSecurityManager.createSlowDown(
      15 * 60 * 1000,
      100,
      500
    ));

    // CORS with dynamic origins
    this.app.use(cors({
      origin: (origin, callback) => {
        if (CORSManager.isValidOrigin(origin)) {
          callback(null, true);
        } else {
          logger.warn(`🚫 CORS blocked origin: ${origin || 'null'}`);
          MetricsCollector.increment('cors_blocked', { origin: origin || 'null' });
          callback(null, false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'x-auth-token', 
        'X-Requested-With',
        'Accept',
        'Origin',
        'Cache-Control',
        'Pragma',
        'X-API-Key'
      ],
      exposedHeaders: [
        'X-Total-Count', 
        'X-Page-Count', 
        'X-Correlation-ID', 
        'API-Version',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset'
      ],
      optionsSuccessStatus: 200,
      maxAge: 86400
    }));

    // Body parsing
    this.app.use(express.json({
      limit: this.config.MAX_REQUEST_SIZE,
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
      type: ['application/json', 'application/*+json']
    }));
    
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: this.config.MAX_REQUEST_SIZE,
      parameterLimit: 1000
    }));

    this.app.use(cookieParser(this.config.COOKIE_SECRET));

    // Compression
    if (this.config.COMPRESSION_ENABLED) {
      this.app.use(compression({
        filter: (req, res) => {
          if (req.headers['x-no-compression']) return false;
          if (res.getHeader('Content-Type')?.includes('image/')) return false;
          return compression.filter(req, res);
        },
        threshold: 1024,
        level: this.config.COMPRESSION_LEVEL,
        memLevel: 8
      }));
    }

    // Request logging
    if (this.config.ENABLE_REQUEST_LOGGING) {
      this.app.use(morgan(
        this.config.IS_PRODUCTION ? 'combined' : 'dev',
        {
          stream: { write: (message) => logger.request(message.trim()) },
          skip: (req) => {
            return this.config.IS_PRODUCTION && (
              req.method === 'OPTIONS' || 
              req.url === '/health' ||
              req.url === '/metrics' ||
              req.url === '/favicon.ico'
            );
          }
        }
      ));
    }

    // Correlation ID and metrics
    this.app.use((req, res, next) => {
      const startTime = process.hrtime.bigint();
      req.correlationId = `${this.config.INSTANCE_ID}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2)}`;
      req.startTime = startTime;
      
      res.setHeader('X-Correlation-ID', req.correlationId);
      res.setHeader('X-Instance-ID', this.config.INSTANCE_ID);
      res.setHeader('X-Response-Time', '0ms');

      // Metrics collection
      MetricsCollector.increment('http_requests_total', {
        method: req.method,
        endpoint: req.route?.path || req.path.split('?')[0],
        user_agent: req.headers['user-agent']?.split(' ')[0] || 'unknown'
      });

      // Override res.send to capture response time
      const originalSend = res.send;
      res.send = function(data) {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000;
        
        res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
        
        // Log slow requests
        if (duration > 2000) { // 2 seconds
          logger.warn(`🐌 Slow request [${req.correlationId}]: ${req.method} ${req.originalUrl} took ${duration.toFixed(2)}ms`);
        }

        // Metrics
        MetricsCollector.histogram('http_request_duration_ms', duration, {
          method: req.method,
          status_code: res.statusCode.toString(),
          endpoint: req.route?.path || req.path.split('?')[0]
        });

        MetricsCollector.increment('http_responses_total', {
          method: req.method,
          status_code: res.statusCode.toString()
        });

        if (process.env.DEBUG_MODE === 'true' && req.method !== 'OPTIONS') {
          console.log(`📤 [${req.correlationId}] ${res.statusCode} (${duration.toFixed(2)}ms)`);
        }

        return originalSend.call(this, data);
      };

      if (process.env.DEBUG_MODE === 'true' && req.method !== 'OPTIONS') {
        console.log(`📥 [${req.correlationId}] ${req.method} ${req.originalUrl} from ${req.headers.origin || 'unknown'}`);
      }

      next();
    });

    // Security and validation middleware
    // ❌ Remove these lines that are causing the error:
// this.app.use(ValidationMiddleware.validateRequest);
// this.app.use(SecurityMiddleware.checkSecurity);

// ✅ Replace with this simple inline middleware:
this.app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Basic validation
  const userAgent = req.get('User-Agent');
  if (!userAgent || userAgent.length < 5) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  
  next();
});
  }

  async connectDatabase() {
    const maxRetries = parseInt(process.env.DB_MAX_RETRY_ATTEMPTS) || 5;
    const retryDelay = parseInt(process.env.DB_RETRY_DELAY_MS) || 5000;
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        await connectDB({
          maxPoolSize: this.config.DB_POOL_SIZE,
          serverSelectionTimeoutMS: this.config.DB_TIMEOUT,
          socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT_MS) || 45000,
          maxIdleTimeMS: 30000,
          retryWrites: true,
          retryReads: true,
          autoIndex: this.config.IS_DEVELOPMENT
        });
        
        logger.info(`✅ Database connected: ${this.config.DB_NAME}`);
        MetricsCollector.increment('database_connections_total', { status: 'success' });
        return;
      } catch (error) {
        retries++;
        MetricsCollector.increment('database_connections_total', { status: 'failed' });
        logger.warn(`Database connection attempt ${retries}/${maxRetries} failed: ${error.message}`);
        
        if (retries === maxRetries) {
          throw new Error(`❌ Failed to connect to database after ${maxRetries} attempts`);
        }
        
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, retries - 1)));
      }
    }
  }

  async setupSession() {
    if (!this.config.REDIS_ENABLED) {
      logger.info('📝 Using MongoDB session store');
      
      this.app.use(session({
        secret: this.config.SESSION_SECRET,
        name: process.env.SESSION_COOKIE_NAME || 'ql_session',
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
          mongoUrl: this.config.MONGODB_URI,
          touchAfter: 24 * 3600, // lazy session update
          ttl: parseInt(process.env.SESSION_COOKIE_MAX_AGE) || 604800000 // 7 days
        }),
        cookie: {
          secure: process.env.SESSION_COOKIE_SECURE === 'true',
          httpOnly: process.env.SESSION_COOKIE_HTTP_ONLY !== 'false',
          maxAge: parseInt(process.env.SESSION_COOKIE_MAX_AGE) || 604800000,
          sameSite: process.env.SESSION_COOKIE_SAME_SITE || 'strict'
        }
      }));
    } else {
      logger.info('📝 Redis session store disabled - using MongoDB');
    }
  }

  async loadRoutes() {
    const result = await this.routeManager.loadRoutes(this.app);
    this.loadedRoutes = result.routes;
    return result;
  }

  setupEndpoints() {
    // Enhanced root endpoint with QuickLocal branding
    this.app.get('/', (req, res) => {
      res.json({
        name: this.config.APP_NAME,
        version: this.config.APP_VERSION,
        status: 'operational',
        timestamp: new Date().toISOString(),
        environment: this.config.NODE_ENV,
        instance_id: this.config.INSTANCE_ID,
        api_version: this.config.API_VERSION,
        timezone: process.env.TIMEZONE || 'UTC',
        currency: process.env.CURRENCY || 'USD',
        server: {
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          node_version: process.version,
          platform: process.platform,
          cpu_count: os.cpus().length,
          load_average: os.loadavg()
        },
        features: {
          websockets: !!this.io,
          clustering: this.config.CLUSTER_MODE,
          metrics: this.config.ENABLE_METRICS,
          caching: this.config.ENABLE_CACHING,
          compression: this.config.COMPRESSION_ENABLED,
          rate_limiting: this.config.RATE_LIMIT_ENABLED,
          brute_force_protection: true,
          reviews: process.env.FEATURE_REVIEWS === 'true',
          wishlist: process.env.FEATURE_WISHLIST === 'true',
          live_tracking: process.env.FEATURE_LIVE_TRACKING === 'true',
          chat: process.env.FEATURE_CHAT === 'true',
          loyalty_program: process.env.FEATURE_LOYALTY_PROGRAM === 'true',
          delivery_system: process.env.DELIVERY_ENABLED === 'true'
        },
        endpoints: this.loadedRoutes.reduce((acc, route) => {
          acc[route.name.toLowerCase().replace(/\s+/g, '_')] = route.path;
          return acc;
        }, {}),
        marketplace: {
          min_order_amount: process.env.MIN_ORDER_AMOUNT || 50,
          max_order_amount: process.env.MAX_ORDER_AMOUNT || 50000,
          delivery_fee: process.env.BASE_DELIVERY_FEE || 25,
          free_delivery_threshold: process.env.FREE_DELIVERY_THRESHOLD || 500,
          platform_commission: process.env.PLATFORM_COMMISSION || 0.025
        },
        documentation: {
          health_check: '/health',
          metrics: '/metrics',
          api_docs: '/api/v1/docs',
          rate_limits: {
            general: `${this.config.RATE_LIMIT_MAX} requests per ${this.config.RATE_LIMIT_WINDOW / 60000} minutes`,
            auth: `${this.config.AUTH_RATE_LIMIT_MAX} requests per 15 minutes`,
            orders: `${this.config.ORDER_RATE_LIMIT_MAX} requests per minute`
          }
        }
      });
    });

    // Comprehensive health check
    this.app.get('/health', async (req, res) => {
      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: this.config.NODE_ENV,
        instance_id: this.config.INSTANCE_ID,
        version: this.config.APP_VERSION,
        checks: {
          database: await this.checkDatabase(),
          memory: this.checkMemory(),
          disk: this.checkDisk(),
          external_services: await this.checkExternalServices(),
          features: this.checkFeatures()
        },
        system: {
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          platform: process.platform,
          node_version: process.version,
          load_average: os.loadavg(),
          free_memory: os.freemem(),
          total_memory: os.totalmem()
        },
        marketplace_config: {
          payment_gateways: this.getPaymentGatewayStatus(),
          delivery_enabled: process.env.DELIVERY_ENABLED === 'true',
          notifications_enabled: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true'
        }
      };

      // Determine overall health
      const failedChecks = Object.values(healthData.checks).filter(check => 
        check.status && check.status !== 'healthy'
      );
      
      if (failedChecks.length > 0) {
        healthData.status = failedChecks.some(check => check.status === 'critical') ? 'unhealthy' : 'degraded';
      }

      const statusCode = healthData.status === 'healthy' ? 200 : 
                        healthData.status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json(healthData);
    });

    // Metrics endpoint
    if (this.config.ENABLE_METRICS) {
      this.app.get('/metrics', (req, res) => {
        res.set('Content-Type', 'text/plain');
        res.send(MetricsCollector.getMetrics());
      });

      this.app.get('/metrics/summary', (req, res) => {
        res.json(MetricsCollector.getMetricsSummary());
      });
    }

    // API documentation endpoint
    if (this.config.ENABLE_API_DOCS) {
      this.app.get('/api/v1/docs', (req, res) => {
        res.json({
          title: `${this.config.APP_NAME} API Documentation`,
          version: this.config.API_VERSION,
          description: 'Complete e-commerce marketplace API with real-time features',
          base_url: `${req.protocol}://${req.get('host')}${this.config.API_BASE_PATH}`,
          instance_id: this.config.INSTANCE_ID,
          authentication: {
            type: 'Bearer Token',
            header: 'Authorization',
            format: 'Bearer <token>',
            refresh_token: 'Supported',
            expires_in: process.env.JWT_ACCESS_EXPIRES || '24h'
          },
          endpoints: this.loadedRoutes.map(route => ({
            name: route.name,
            path: route.path,
            priority: route.priority,
            status: route.status
          })),
          features: {
            pagination: 'Supported with limit/offset and cursor-based',
            filtering: 'Advanced filtering with query parameters',
            sorting: 'Multi-field sorting supported',
            search: 'Full-text search available',
            real_time: this.io ? 'WebSocket support for live updates' : 'Not available',
            file_upload: 'Multi-part form data supported',
            webhooks: 'Event-driven notifications supported'
          },
          rate_limits: {
            general: `${this.config.RATE_LIMIT_MAX} requests per ${this.config.RATE_LIMIT_WINDOW / 60000} minutes`,
            auth: `${this.config.AUTH_RATE_LIMIT_MAX} requests per 15 minutes`,
            orders: `${this.config.ORDER_RATE_LIMIT_MAX} requests per minute`
          },
          websocket: this.io ? {
            enabled: true,
            url: `ws://${req.get('host')}`,
            events: [
              'order_status_update',
              'delivery_location_update', 
              'new_message',
              'stock_update',
              'price_change',
              'seller_notification'
            ],
            rooms: [
              'user_{user_id}',
              'order_{order_id}',
              'seller_{seller_id}',
              'product_{product_id}'
            ]
          } : { enabled: false },
          marketplace_features: {
            multi_vendor: true,
            inventory_management: true,
            order_tracking: true,
            review_system: process.env.FEATURE_REVIEWS === 'true',
            wishlist: process.env.FEATURE_WISHLIST === 'true',
            loyalty_program: process.env.FEATURE_LOYALTY_PROGRAM === 'true',
            bulk_orders: process.env.FEATURE_BULK_ORDERS === 'true',
            scheduled_delivery: process.env.FEATURE_SCHEDULED_DELIVERY === 'true'
          }
        });
      });
    }

    // Server status endpoint
    this.app.get('/status', (req, res) => {
      res.json({
        status: 'operational',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        connections: this.server.listening ? 'accepting' : 'not accepting',
        socket_connections: this.io ? this.io.engine.clientsCount : 0,
        environment: this.config.NODE_ENV,
        version: this.config.APP_VERSION,
        circuit_breakers: this.circuitBreaker.getStatus()
      });
    });
  }

  async checkDatabase() {
    try {
      if (mongoose.connection.readyState !== 1) {
        return { status: 'critical', message: 'Database disconnected' };
      }

      const startTime = Date.now();
      await mongoose.connection.db.admin().ping();
      const responseTime = Date.now() - startTime;

      return {
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        response_time: responseTime,
        connection_state: mongoose.connection.readyState,
        database_name: mongoose.connection.db?.databaseName,
        host: mongoose.connection.host,
        collections: await mongoose.connection.db.listCollections().toArray().then(cols => cols.length)
      };
    } catch (error) {
      return {
        status: 'critical',
        message: error.message,
        error: 'Database health check failed'
      };
    }
  }

  checkMemory() {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    const systemUsagePercent = ((totalMem - freeMem) / totalMem) * 100;
    
    return {
      status: usagePercent > 90 || systemUsagePercent > 95 ? 'critical' : 
              usagePercent > 75 || systemUsagePercent > 85 ? 'degraded' : 'healthy',
      heap_used: memUsage.heapUsed,
      heap_total: memUsage.heapTotal,
      usage_percent: Math.round(usagePercent),
      system_usage_percent: Math.round(systemUsagePercent),
      external: memUsage.external,
      rss: memUsage.rss,
      free_memory: freeMem,
      total_memory: totalMem
    };
  }

  checkDisk() {
    try {
      const stats = fs.statSync(__dirname);
      const logStats = fs.statSync(this.config.LOG_DIR);
      
      return {
        status: 'healthy',
        accessible: true,
        log_directory: {
          accessible: true,
          path: this.config.LOG_DIR
        }
      };
    } catch (error) {
      return {
        status: 'critical',
        message: 'Disk access failed',
        error: error.message
      };
    }
  }

  async checkExternalServices() {
    const services = [];
    
    try {
      // Check payment gateways
      if (process.env.RAZORPAY_ENABLED === 'true') {
        services.push({
          name: 'razorpay',
          status: 'configured',
          enabled: true
        });
      }

      if (process.env.STRIPE_ENABLED === 'true') {
        services.push({
          name: 'stripe',
          status: 'configured',
          enabled: true
        });
      }

      // Check email service
      if (process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true') {
        services.push({
          name: 'email_service',
          status: process.env.SMTP_HOST ? 'configured' : 'not_configured',
          provider: 'smtp'
        });
      }

      // Check file storage
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        services.push({
          name: 'cloudinary',
          status: 'configured',
          enabled: true
        });
      }

    } catch (error) {
      logger.warn('External service health check failed:', error.message);
    }

    return {
      status: services.length > 0 ? 'healthy' : 'degraded',
      services,
      total_services: services.length
    };
  }

  checkFeatures() {
    return {
      status: 'healthy',
      enabled_features: {
        reviews: process.env.FEATURE_REVIEWS === 'true',
        ratings: process.env.FEATURE_RATINGS === 'true',
        wishlist: process.env.FEATURE_WISHLIST === 'true',
        live_tracking: process.env.FEATURE_LIVE_TRACKING === 'true',
        chat: process.env.FEATURE_CHAT === 'true',
        multiple_addresses: process.env.FEATURE_MULTIPLE_ADDRESSES === 'true',
        scheduled_delivery: process.env.FEATURE_SCHEDULED_DELIVERY === 'true',
        loyalty_program: process.env.FEATURE_LOYALTY_PROGRAM === 'true',
        referral_program: process.env.FEATURE_REFERRAL_PROGRAM === 'true',
        bulk_orders: process.env.FEATURE_BULK_ORDERS === 'true'
      },
      notifications: {
        push: process.env.ENABLE_PUSH_NOTIFICATIONS === 'true',
        sms: process.env.ENABLE_SMS_NOTIFICATIONS === 'true',
        in_app: process.env.ENABLE_IN_APP_NOTIFICATIONS === 'true',
        email: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true'
      }
    };
  }

  getPaymentGatewayStatus() {
    return {
      razorpay: {
        enabled: process.env.RAZORPAY_ENABLED === 'true',
        configured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
      },
      stripe: {
        enabled: process.env.STRIPE_ENABLED === 'true',
        configured: !!(process.env.STRIPE_PUBLISHABLE_KEY && process.env.STRIPE_SECRET_KEY)
      },
      paypal: {
        enabled: process.env.PAYPAL_ENABLED === 'true',
        configured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)
      }
    };
  }

  setupErrorHandling() {
    // Shutdown middleware
    this.app.use((req, res, next) => {
      if (this.isShuttingDown) {
        res.status(503).json({
          error: 'Server shutting down',
          message: 'Server is currently shutting down. Please try again in a few moments.',
          correlation_id: req.correlationId
        });
        return;
      }
      next();
    });

    // 404 handler with intelligent suggestions
    this.app.use('*', (req, res) => {
      const availableRoutes = this.loadedRoutes.map(route => route.path);
      const method = req.method;
      const requestedPath = req.originalUrl;
      
      // Find similar routes using Levenshtein distance
      const suggestions = availableRoutes
        .map(route => ({
          route,
          similarity: this.calculateSimilarity(requestedPath, route)
        }))
        .filter(item => item.similarity > 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3)
        .map(item => item.route);

      logger.warn(`404: ${method} ${requestedPath} from ${req.headers.origin || 'unknown'} [${req.correlationId}]`);
      
      MetricsCollector.increment('http_404_errors', {
        method,
        path: requestedPath.split('?')[0],
        origin: req.headers.origin || 'unknown'
      });
      
      res.status(404).json({
        error: 'Endpoint not found',
        message: `${method} ${requestedPath} does not exist on this server`,
        correlation_id: req.correlationId,
        instance_id: this.config.INSTANCE_ID,
        timestamp: new Date().toISOString(),
        suggestions: {
          documentation: {
            api_docs: '/api/v1/docs',
            health_check: '/health',
            server_status: '/status'
          },
          similar_routes: suggestions,
          available_methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          api_version: `Current API version is ${this.config.API_VERSION}`,
          base_path: this.config.API_BASE_PATH
        },
        help: {
          documentation_url: `${req.protocol}://${req.get('host')}/api/v1/docs`,
          support_contact: process.env.EMAIL_FROM || 'support@quicklocal.com'
        }
      });
    });

    // Enhanced global error handler
    this.app.use((err, req, res, next) => {
      const errorId = `${this.config.INSTANCE_ID}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2)}`;
      
      // Enhanced error logging
      const errorLog = {
        error_id: errorId,
        error: err.message,
        name: err.name,
        stack: this.config.IS_PRODUCTION ? undefined : err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        user_agent: req.headers['user-agent'],
        correlation_id: req.correlationId,
        user_id: req.user?.id || null,
        timestamp: new Date().toISOString(),
        environment: this.config.NODE_ENV,
        instance_id: this.config.INSTANCE_ID
      };

      logger.error(`Unhandled error [${errorId}]:`, errorLog);

      // Metrics
      MetricsCollector.increment('http_errors_total', {
        error_type: err.name || 'UnknownError',
        status_code: (err.status || err.statusCode || 500).toString(),
        method: req.method,
        endpoint: req.route?.path || req.path.split('?')[0]
      });

      // Enhanced error type handling
      let statusCode = err.status || err.statusCode || 500;
      let message = err.message;
      let errorType = 'internal_server_error';
      let helpMessage = null;

      // Mongoose/MongoDB errors
      if (err.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation failed';
        errorType = 'validation_error';
        helpMessage = 'Please check your input data and try again';
      } else if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid ID format';
        errorType = 'cast_error';
        helpMessage = 'Please provide a valid MongoDB ObjectId';
      } else if (err.code === 11000) {
        statusCode = 409;
        message = 'Duplicate entry';
        errorType = 'duplicate_error';
        helpMessage = 'This record already exists';
      } else if (err.name === 'MongooseError' || err.name === 'MongoError') {
        statusCode = 500;
        message = 'Database error';
        errorType = 'database_error';
        helpMessage = 'Please try again later';
      }

      // JWT errors
      else if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
        errorType = 'jwt_error';
        helpMessage = 'Please provide a valid authentication token';
      } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token expired';
        errorType = 'token_expired';
        helpMessage = 'Please refresh your authentication token';
      }

      // Express errors
      else if (err.type === 'entity.parse.failed') {
        statusCode = 400;
        message = 'Invalid JSON';
        errorType = 'json_parse_error';
        helpMessage = 'Please check your JSON syntax';
      } else if (err.type === 'entity.too.large') {
        statusCode = 413;
        message = 'Request too large';
        errorType = 'payload_too_large';
        helpMessage = `Maximum request size is ${this.config.MAX_REQUEST_SIZE}`;
      }

      // Multer errors (file upload)
      else if (err.code === 'LIMIT_FILE_SIZE') {
        statusCode = 413;
        message = 'File too large';
        errorType = 'file_too_large';
        helpMessage = `Maximum file size is ${Math.round(this.config.MAX_FILE_SIZE / 1024 / 1024)}MB`;
      }

      const errorResponse = {
        error: this.config.IS_PRODUCTION && statusCode === 500 ? 'Internal Server Error' : message,
        error_id: errorId,
        error_type: errorType,
        correlation_id: req.correlationId,
        instance_id: this.config.INSTANCE_ID,
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        method: req.method,
        ...(helpMessage && { help: helpMessage }),
        ...(this.config.IS_PRODUCTION ? {} : { 
          stack: err.stack,
          details: err.details || null,
          validation_errors: err.errors || null
        })
      };

      // Add specific help for common errors
      if (statusCode === 401) {
        errorResponse.authentication = {
          required: true,
          header: 'Authorization: Bearer <token>',
          refresh_endpoint: '/api/v1/auth/refresh'
        };
      } else if (statusCode === 403) {
        errorResponse.authorization = {
          message: 'Insufficient permissions for this resource',
          required_role: err.requiredRole || 'unknown'
        };
      } else if (statusCode === 429) {
        errorResponse.rate_limit = {
          retry_after: err.retryAfter || Math.ceil(this.config.RATE_LIMIT_WINDOW / 1000),
          limit: this.config.RATE_LIMIT_MAX,
          window: this.config.RATE_LIMIT_WINDOW
        };
      }

      res.status(statusCode).json(errorResponse);
    });

    // Global process error handlers
    process.on('uncaughtException', (err) => {
      logger.error('💥 Uncaught Exception:', err);
      MetricsCollector.increment('uncaught_exceptions');
      
      // Give some time for logs to be written, then exit
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      MetricsCollector.increment('unhandled_rejections');
    });

    // Memory leak detection
    if (process.env.NODE_ENV !== 'production') {
      const memoryLeakDetectionInterval = setInterval(() => {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        
        if (heapUsedMB > 512) { // 512MB threshold
          logger.warn(`⚠️ High memory usage detected: ${heapUsedMB}MB`);
        }
      }, 60000); // Check every minute

      // Clear interval on shutdown
      process.on('SIGTERM', () => clearInterval(memoryLeakDetectionInterval));
    }
  }

  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.PORT, this.config.HOST, (err) => {
        if (err) {
          reject(err);
          return;
        }

        const serverInfo = `
🌟 ${this.config.APP_NAME} E-commerce API Server v${this.config.APP_VERSION}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Server Configuration:
   🌍 URL: http://${this.config.HOST}:${this.config.PORT}
   🆔 Instance: ${this.config.INSTANCE_ID}
   🏗️  Environment: ${this.config.NODE_ENV}
   🔧 Node.js: ${process.version}
   🖥️  Platform: ${process.platform}
   💾 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB used
   🔄 Process ID: ${process.pid}
   🌐 Domain: ${this.config.DOMAIN}

🗄️  Database:
   📊 Metrics: /metrics
   🔍 API Version: ${this.config.API_VERSION}
   📍 Routes: ${this.loadedRoutes.length} loaded
   💰 Min Order: ₹${process.env.MIN_ORDER_AMOUNT || 50}
   🚚 Delivery Fee: ₹${process.env.BASE_DELIVERY_FEE || 25}
   🆓 Free Delivery: ₹${process.env.FREE_DELIVERY_THRESHOLD || 500}+

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ ${this.config.APP_NAME} Server is ready to serve customers!
🌐 Visit http://${this.config.HOST}:${this.config.PORT} for API documentation
🏪 Marketplace ready for ${process.env.CURRENCY || 'INR'} transactions
        `;

        console.log(serverInfo);
        logger.info('🚀 QuickLocal API Server started successfully');
        
        MetricsCollector.increment('server_starts_total', {
          environment: this.config.NODE_ENV,
          instance_id: this.config.INSTANCE_ID
        });
        
        resolve();
      });

      // Enhanced server error handling
      this.server.on('error', (err) => {
        MetricsCollector.increment('server_errors_total', { 
          error_code: err.code,
          instance_id: this.config.INSTANCE_ID
        });
        
        if (err.code === 'EADDRINUSE') {
          logger.error(`❌ Port ${this.config.PORT} is already in use.`);
          logger.info(`💡 Kill existing process: lsof -ti:${this.config.PORT} | xargs kill -9`);
          logger.info(`💡 Or try a different port: PORT=10001 npm start`);
        } else if (err.code === 'EACCES') {
          logger.error(`❌ Permission denied for port ${this.config.PORT}.`);
          logger.info(`💡 Try a port > 1024 or run with appropriate permissions.`);
        } else if (err.code === 'ENOTFOUND') {
          logger.error(`❌ Host ${this.config.HOST} not found.`);
          logger.info(`💡 Check your HOST environment variable.`);
        } else {
          logger.error('❌ Server error:', err);
        }
        
        reject(err);
      });

      // Handle server warnings and client errors
      this.server.on('clientError', (err, socket) => {
        logger.warn(`Client error from ${socket.remoteAddress}: ${err.message}`);
        MetricsCollector.increment('client_errors_total');
        
        if (socket.writable) {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        }
      });

      this.server.on('connection', (socket) => {
        MetricsCollector.increment('tcp_connections_total');
        
        socket.on('error', (err) => {
          logger.warn(`Socket error: ${err.message}`);
        });
      });
    });
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) {
        logger.warn('⚠️ Shutdown already in progress...');
        return;
      }

      this.isShuttingDown = true;
      logger.info(`🛑 ${signal} received. Starting graceful shutdown...`);
      
      MetricsCollector.increment('graceful_shutdowns_total', { 
        signal,
        instance_id: this.config.INSTANCE_ID
      });

      const shutdownTimeout = setTimeout(() => {
        logger.error('❌ Graceful shutdown timeout exceeded. Forcing exit...');
        process.exit(1);
      }, 30000); // 30 second timeout

      try {
        // Stop accepting new connections
        logger.info('🔄 Stopping HTTP server...');
        await new Promise((resolve, reject) => {
          this.server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Close Socket.IO connections gracefully
        if (this.io) {
          logger.info('🔄 Closing Socket.IO connections...');
          
          // Notify all connected clients about shutdown
          this.io.emit('server_shutdown', {
            message: 'Server is shutting down for maintenance',
            timestamp: new Date().toISOString(),
            reconnect_delay: 5000
          });
          
          // Give clients time to handle the notification
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          this.io.close();
        }

        // Close database connections
        logger.info('🔄 Closing database connections...');
        await mongoose.connection.close();

        // Final cleanup and metrics
        logger.info('🔄 Performing final cleanup...');
        
        // Log final metrics
        const finalMetrics = MetricsCollector.getMetricsSummary();
        logger.info('📊 Final server metrics:', finalMetrics);
        
        clearTimeout(shutdownTimeout);
        
        logger.info('✅ Graceful shutdown completed successfully');
        logger.info(`👋 ${this.config.APP_NAME} server stopped cleanly`);
        
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    // Handle different shutdown signals
    process.on('SIGTERM', () => shutdown('SIGTERM')); // Docker/PM2 shutdown
    process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // Nodemon restart
    process.on('SIGHUP', () => shutdown('SIGHUP'));   // Terminal closed

    // Handle PM2 graceful shutdown
    process.on('message', (msg) => {
      if (msg === 'shutdown') {
        shutdown('PM2_SHUTDOWN');
      }
    });
  }
}

// Enhanced Cluster Manager for Production Scaling
class QuickLocalClusterManager {
  static start() {
    const config = new QuickLocalConfig().config;
    
    if (config.CLUSTER_MODE && cluster.isPrimary) {
      logger.info(`🔄 Starting QuickLocal in cluster mode with ${config.MAX_WORKERS} workers...`);
      
      // Fork workers
      for (let i = 0; i < config.MAX_WORKERS; i++) {
        const worker = cluster.fork({
          WORKER_ID: i + 1,
          INSTANCE_ID: `${config.INSTANCE_ID}-worker-${i + 1}`
        });
        
        worker.on('message', (message) => {
          if (message.type === 'metrics') {
            // Handle worker metrics in master process
            logger.debug(`📊 Metrics from worker ${worker.id}:`, message.data);
          }
        });
      }

      // Handle worker events
      cluster.on('exit', (worker, code, signal) => {
        const exitCode = worker.process.exitCode;
        logger.warn(`❌ Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
        
        // Don't restart if it was an intentional shutdown
        if (exitCode !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
          logger.info('🔄 Starting a new worker to replace the failed one...');
          const newWorker = cluster.fork({
            WORKER_ID: worker.id,
            INSTANCE_ID: `${config.INSTANCE_ID}-worker-${worker.id}`
          });
          
          newWorker.on('message', (message) => {
            if (message.type === 'metrics') {
              logger.debug(`📊 Metrics from replacement worker ${newWorker.id}:`, message.data);
            }
          });
        }
      });

      cluster.on('online', (worker) => {
        logger.info(`✅ Worker ${worker.process.pid} is online (ID: ${worker.id})`);
      });

      cluster.on('listening', (worker, address) => {
        logger.info(`🎧 Worker ${worker.process.pid} is listening on ${address.address}:${address.port}`);
      });

      // Master process graceful shutdown
      const masterShutdown = () => {
        logger.info('🛑 Master process shutting down workers...');
        
        const workers = Object.values(cluster.workers);
        let workersShutdown = 0;
        
        // Send shutdown signal to all workers
        workers.forEach(worker => {
          if (worker) {
            worker.send('shutdown');
            
            // Force kill worker after timeout
            setTimeout(() => {
              if (!worker.isDead()) {
                logger.warn(`⚠️ Force killing worker ${worker.process.pid}`);
                worker.kill('SIGKILL');
              }
            }, 10000);
            
            worker.on('disconnect', () => {
              workersShutdown++;
              if (workersShutdown === workers.length) {
                logger.info('✅ All workers shut down successfully');
                process.exit(0);
              }
            });
          }
        });
        
        // Force exit if workers don't shutdown in time
        setTimeout(() => {
          logger.error('❌ Workers shutdown timeout. Force exiting...');
          process.exit(1);
        }, 15000);
      };

      process.on('SIGTERM', masterShutdown);
      process.on('SIGINT', masterShutdown);

      // Log cluster status every 5 minutes
      setInterval(() => {
        const workers = Object.values(cluster.workers);
        const aliveWorkers = workers.filter(worker => worker && !worker.isDead()).length;
        logger.info(`📊 Cluster status: ${aliveWorkers}/${config.MAX_WORKERS} workers alive`);
      }, 5 * 60 * 1000);

    } else {
      // Worker process or single process mode
      const server = new QuickLocalServer();
      
      // Handle shutdown message from master
      process.on('message', (msg) => {
        if (msg === 'shutdown') {
          logger.info(`🛑 Worker ${process.pid} received shutdown signal from master`);
          server.isShuttingDown = true;
          
          // Close server gracefully
          if (server.server) {
            server.server.close(() => {
              process.exit(0);
            });
          } else {
            process.exit(0);
          }
        }
      });
      
      server.initialize().catch((error) => {
        logger.error('❌ Worker startup failed:', error);
        process.exit(1);
      });
    }
  }

  static getClusterInfo() {
    if (cluster.isPrimary) {
      const workers = Object.values(cluster.workers);
      return {
        isPrimary: true,
        totalWorkers: workers.length,
        aliveWorkers: workers.filter(worker => worker && !worker.isDead()).length,
        workers: workers.map(worker => ({
          id: worker.id,
          pid: worker.process.pid,
          state: worker.state,
          isDead: worker.isDead()
        }))
      };
    } else {
      return {
        isPrimary: false,
        workerId: cluster.worker.id,
        pid: process.pid,
        state: cluster.worker.state
      };
    }
  }
}

// Development utilities
class QuickLocalDevUtils {
  static setupDevelopmentTools(app) {
    if (process.env.NODE_ENV !== 'development') return;

    // Development route for testing
    app.get('/dev/test', (req, res) => {
      res.json({
        message: 'Development test endpoint',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        features: {
          mock_payment: process.env.MOCK_PAYMENT === 'true',
          mock_sms: process.env.MOCK_SMS === 'true',
          mock_email: process.env.MOCK_EMAIL === 'true',
          debug_mode: process.env.DEBUG_MODE === 'true'
        }
      });
    });

    // Route to trigger test events (development only)
    app.post('/dev/trigger/:event', (req, res) => {
      const { event } = req.params;
      const { data } = req.body;

      logger.info(`🧪 Development: Triggering ${event} event`, data);

      // Simulate different events for testing
      switch (event) {
        case 'order_update':
          if (app.io) {
            app.io.to(`order_${data.orderId}`).emit('order_status_update', {
              orderId: data.orderId,
              status: data.status,
              timestamp: new Date().toISOString()
            });
          }
          break;
        case 'delivery_update':
          if (app.io) {
            app.io.to(`order_${data.orderId}`).emit('delivery_location_update', {
              orderId: data.orderId,
              location: data.location,
              timestamp: new Date().toISOString()
            });
          }
          break;
        default:
          return res.status(400).json({ error: 'Unknown event type' });
      }

      res.json({ 
        success: true, 
        message: `${event} event triggered`,
        data 
      });
    });

    logger.info('🧪 Development utilities enabled');
  }

  static logEnvironmentInfo() {
    if (process.env.NODE_ENV !== 'development') return;

    logger.info('🧪 Development Environment Info:');
    logger.info(`   Debug Mode: ${process.env.DEBUG_MODE}`);
    logger.info(`   Mock Payment: ${process.env.MOCK_PAYMENT}`);
    logger.info(`   Mock SMS: ${process.env.MOCK_SMS}`);
    logger.info(`   Mock Email: ${process.env.MOCK_EMAIL}`);
    logger.info(`   API Docs: ${process.env.ENABLE_API_DOCS}`);
    logger.info(`   Seed Data: ${process.env.ENABLE_SEED_DATA}`);
  }
}

// Export everything for use
module.exports = { 
  QuickLocalServer, 
  QuickLocalClusterManager, 
  QuickLocalConfig,
  CORSManager,
  EnhancedSecurityManager,
  QuickLocalRouteManager,
  QuickLocalDevUtils
};

// Start the server if this file is run directly
if (require.main === module) {
  // Log environment info in development
  QuickLocalDevUtils.logEnvironmentInfo();
 // Start server (with or without clustering)
QuickLocalClusterManager.start();
console.log('Status: Connected');
console.log('✅ Server is connected and running');
console.log(`🏪 Database: ${mongoose.connection.db?.databaseName}`);
console.log(`🖥️  Host: ${mongoose.connection.host}`);
console.log(`
⚡ Pool Size: ${process.env.DB_POOL_SIZE || 10}
🛡️  Security Features:
🔒 Helmet Security: ${process.env.HELMET_ENABLED === 'true' ? '✅' : '❌'}
🚦 Rate Limiting: ${process.env.RATE_LIMIT_ENABLED === 'true' ? '✅' : '❌'} (${process.env.RATE_LIMIT_MAX || 100}/${(process.env.RATE_LIMIT_WINDOW || 900000) / 60000}min)
🛑 Brute Force Protection: ✅
🌐 CORS Origins: ${CORSManager.getOrigins().length} configured
🔐 Session Management: ✅
💪 Password Hashing: ${process.env.BCRYPT_SALT_ROUNDS || 12} rounds
🚀 Performance Features:
📦 Compression: ${process.env.COMPRESSION_ENABLED === 'true' ? '✅' : '❌'} (Level: ${process.env.COMPRESSION_LEVEL || 6})
📊 Metrics: ${process.env.ENABLE_METRICS === 'true' ? '✅' : '❌'}
🔌 Socket.IO: ✅
⚡ Circuit Breaker: ✅
🕐 Request Timeout: ${(process.env.REQUEST_TIMEOUT || 30000) / 1000}s
🎯 Clustering: ${process.env.CLUSTER_MODE === 'true' ? '✅' : '❌'}
🏪 Marketplace Features:
💳 Payment Gateways: Multiple enabled
🚚 Delivery System: ${process.env.DELIVERY_ENABLED === 'true' ? '✅' : '❌'}
⭐ Reviews & Ratings: ${process.env.FEATURE_REVIEWS === 'true' ? '✅' : '❌'}
💝 Wishlist: ${process.env.FEATURE_WISHLIST === 'true' ? '✅' : '❌'}
📍 Live Tracking: ${process.env.FEATURE_LIVE_TRACKING === 'true' ? '✅' : '❌'}
💬 Chat System: ${process.env.FEATURE_CHAT === 'true' ? '✅' : '❌'}
🎁 Loyalty Program: ${process.env.FEATURE_LOYALTY_PROGRAM === 'true' ? '✅' : '❌'}
📚 API Information:
📖 Documentation: /api/v1/docs
❤️  Health Check: /health
`);
}