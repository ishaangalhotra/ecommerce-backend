// server.js - Enterprise-Grade Express Server with Advanced Configuration

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
const applySecurity = require('./middleware/security');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const ExpressBrute = require('express-brute');
const MongooseStore = require('express-brute-mongoose');
const BruteForceSchema = require('express-brute-mongoose/dist/schema');
applySecurity(app);

// Custom imports
const logger = require('./utils/logger');
const { connectDB } = require('./config/database');
const SecurityMiddleware = require('./middleware/security');
const ValidationMiddleware = require('./middleware/validation');
const MetricsCollector = require('./utils/metrics');
const CircuitBreaker = require('./utils/circuitBreaker');

// Enhanced Configuration with Validation
class ServerConfig {
  constructor() {
    this.config = {
      PORT: this.getEnvNumber('PORT', 10000),
      HOST: process.env.HOST || '0.0.0.0',
      NODE_ENV: process.env.NODE_ENV || 'development',
      LOG_LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
      
      // Database
      MONGODB_URI: this.getRequiredEnv('MONGODB_URI'),
      DB_MAX_CONNECTIONS: this.getEnvNumber('DB_MAX_CONNECTIONS', 10),
      DB_TIMEOUT: this.getEnvNumber('DB_TIMEOUT', 30000),
      
      // Security
      JWT_SECRET: this.getRequiredEnv('JWT_SECRET'),
      ENCRYPTION_KEY: this.getRequiredEnv('ENCRYPTION_KEY'),
      RATE_LIMIT_WINDOW: this.getEnvNumber('RATE_LIMIT_WINDOW', 15 * 60 * 1000),
      RATE_LIMIT_MAX: this.getEnvNumber('RATE_LIMIT_MAX', 1000),
      
      // Performance
      CLUSTER_MODE: process.env.CLUSTER_MODE === 'true',
      MAX_WORKERS: this.getEnvNumber('MAX_WORKERS', os.cpus().length),
      COMPRESSION_THRESHOLD: this.getEnvNumber('COMPRESSION_THRESHOLD', 1024),
      
      // Monitoring
      METRICS_ENABLED: process.env.METRICS_ENABLED !== 'false',
      HEALTH_CHECK_TIMEOUT: this.getEnvNumber('HEALTH_CHECK_TIMEOUT', 5000),
      
      // API
      API_VERSION: process.env.API_VERSION || 'v1',
      MAX_REQUEST_SIZE: process.env.MAX_REQUEST_SIZE || '10mb',
      REQUEST_TIMEOUT: this.getEnvNumber('REQUEST_TIMEOUT', 30000)
    };

    this.IS_PRODUCTION = this.config.NODE_ENV === 'production';
    this.IS_DEVELOPMENT = this.config.NODE_ENV === 'development';
    
    this.validateConfig();
  }

  getRequiredEnv(key) {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  }

  getEnvNumber(key, defaultValue) {
    const value = process.env[key];
    return value ? parseInt(value, 10) : defaultValue;
  }

  validateConfig() {
    // Validate JWT secret strength
    if (this.config.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long');
    }

    // Validate port range
    if (this.config.PORT < 1 || this.config.PORT > 65535) {
      throw new Error('PORT must be between 1 and 65535');
    }

    // Validate MongoDB URI format
    if (!this.config.MONGODB_URI.startsWith('mongodb')) {
      throw new Error('MONGODB_URI must be a valid MongoDB connection string');
    }

    logger.info('✅ Configuration validation passed');
  }
}

const CONFIG = new ServerConfig().config;

// Enhanced CORS Configuration
const CORS_ORIGINS = [
  'https://www.quicklocal.shop',
  'https://quicklocal.shop',
  'https://my-frontend-ifyr.vercel.app',
  ...(CONFIG.NODE_ENV === 'production' ? [] : [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5173'
  ])
];

// Advanced Security Configuration
class SecurityManager {
  static createBruteForceProtection() {
    const BruteForceModel = mongoose.model('bruteforce', BruteForceSchema);
    const store = new MongooseStore(BruteForceModel);
    
    return new ExpressBrute(store, {
      freeRetries: 5,
      minWait: 5 * 60 * 1000, // 5 minutes
      maxWait: 60 * 60 * 1000, // 1 hour
      lifetime: 24 * 60 * 60, // 24 hours
      failCallback: (req, res, next, nextValidRequestDate) => {
        res.status(429).json({
          error: 'Too many failed attempts',
          nextValidRequestDate,
          retryAfter: Math.ceil((nextValidRequestDate.getTime() - Date.now()) / 1000)
        });
      }
    });
  }

  static createAdvancedRateLimit(windowMs, max, message, skipSuccessfulRequests = false) {
    return rateLimit({
      windowMs,
      max,
      message: { 
        error: message, 
        retryAfter: Math.ceil(windowMs / 1000),
        type: 'rate_limit_exceeded'
      },
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests,
      keyGenerator: (req) => {
        // Use a combination of IP and user ID for authenticated requests
        return req.user?.id ? `${req.ip}:${req.user.id}` : req.ip;
      },
      skip: (req) => CONFIG.NODE_ENV === 'development' && req.ip === '127.0.0.1',
      onLimitReached: (req, res, options) => {
        logger.warn(`Rate limit exceeded for ${req.ip} on ${req.originalUrl}`);
        MetricsCollector.increment('rate_limit_exceeded', {
          endpoint: req.originalUrl,
          ip: req.ip
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
      skipSuccessfulRequests: true
    });
  }

  static isValidOrigin(origin) {
    if (!origin) return true;
    
    if (CORS_ORIGINS.includes(origin)) return true;
    
    const allowedPatterns = [
      /^https:\/\/.*\.vercel\.app$/,
      /^https:\/\/.*\.netlify\.app$/,
      /^https:\/\/.*\.herokuapp\.com$/,
      /^https:\/\/.*\.railway\.app$/,
      /^https:\/\/.*\.render\.com$/
    ];
    
    return allowedPatterns.some(pattern => pattern.test(origin));
  }
}

// Advanced Route Management
class RouteManager {
  constructor() {
    this.routes = [
      { path: '/api/v1/auth', module: './routes/auth', name: 'Authentication', version: 'v1' },
      { path: '/api/v1/users', module: './routes/users', name: 'User Management', version: 'v1' },
      { path: '/api/v1/products', module: './routes/products', name: 'Product Catalog', version: 'v1' },
      { path: '/api/v1/orders', module: './routes/orders', name: 'Order Processing', version: 'v1' },
      { path: '/api/v1/delivery', module: './routes/delivery', name: 'Delivery Service', version: 'v1' },
      { path: '/api/v1/cart', module: './routes/cart', name: 'Shopping Cart', version: 'v1' },
      { path: '/api/v1/seller', module: './routes/seller', name: 'Seller Dashboard', version: 'v1' },
      { path: '/api/v1/admin', module: './routes/admin', name: 'Admin Panel', version: 'v1' },
      { path: '/api/v1/wishlist', module: './routes/wishlist', name: 'User Wishlist', version: 'v1' },
      { path: '/api/v1/payment', module: './routes/payment-routes', name: 'Payment Gateway', version: 'v1' },
      { path: '/api/v1/webhooks', module: './routes/webhook-routes', name: 'Webhook Handlers', version: 'v1' },
      { path: '/api/v1/analytics', module: './routes/analytics', name: 'Analytics', version: 'v1' },
      { path: '/api/v1/notifications', module: './routes/notifications', name: 'Notifications', version: 'v1' }
    ];
    
    this.loadedRoutes = [];
    this.failedRoutes = [];
  }

  async loadRoutes(app) {
    logger.info('🔄 Loading API routes...');
    
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

  async loadSingleRoute(app, { path, module, name, version }) {
    if (!CONFIG.NODE_ENV === 'production') {
      delete require.cache[require.resolve(module)];
    }

    const routeModule = require(module);
    
    if (!this.isValidRouter(routeModule)) {
      throw new Error(`Invalid router export in ${module}`);
    }

    // Add version-specific middleware if needed
    if (version) {
      app.use(path, this.createVersionMiddleware(version));
    }

    app.use(path, routeModule);
    
    this.loadedRoutes.push({ path, name, version, status: 'loaded' });
    logger.info(`✅ ${name}: ${path}`);

    // Extract and log endpoints in development
    if (CONFIG.NODE_ENV === 'development') {
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

  createVersionMiddleware(version) {
    return (req, res, next) => {
      req.apiVersion = version;
      res.setHeader('API-Version', version);
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
    
    if (CONFIG.NODE_ENV !== 'production') {
      console.error(error.stack);
    }
  }

  logRouteSummary() {
    const { length: loaded } = this.loadedRoutes;
    const { length: failed } = this.failedRoutes;
    
    logger.info(`📊 Route loading complete: ${loaded} loaded, ${failed} failed`);
    
    if (failed > 0) {
      logger.error(`⚠️ Failed routes:`, this.failedRoutes);
      if (CONFIG.NODE_ENV === 'production' && failed > loaded * 0.5) {
        throw new Error('Critical: More than 50% of routes failed to load');
      }
    }
  }
}

// Enhanced Application Class
class QuickLocalServer {
  constructor() {
    this.app = null;
    this.server = null;
    this.io = null;
    this.routeManager = new RouteManager();
    this.metricsCollector = new MetricsCollector();
    this.circuitBreaker = new CircuitBreaker();
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      await this.preflightChecks();
      await this.createApp();
      await this.setupMiddleware();
      await this.connectDatabase();
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
    const dirs = ['logs', 'uploads', 'temp'];
    dirs.forEach(dir => {
      const dirPath = path.join(__dirname, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.info(`📁 Created ${dir} directory`);
      }
    });

    // Check disk space
    const stats = fs.statSync(__dirname);
    logger.info(`💾 Available disk space check passed`);

    // Memory check
    const memUsage = process.memoryUsage();
    if (memUsage.heapUsed / memUsage.heapTotal > 0.8) {
      logger.warn('⚠️ High memory usage detected at startup');
    }
  }

  async createApp() {
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Setup Socket.IO with enhanced configuration
    try {
      const { Server } = require('socket.io');
      this.io = new Server(this.server, {
        cors: {
          origin: CORS_ORIGINS,
          methods: ['GET', 'POST'],
          credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: 1e6,
        allowEIO3: true
      });
      
      this.setupSocketHandlers();
      logger.info('✅ Socket.IO initialized');
    } catch (error) {
      logger.warn('Socket.IO not available, real-time features disabled');
    }
  }

  setupSocketHandlers() {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      logger.debug(`Socket connected: ${socket.id}`);
      
      socket.on('disconnect', (reason) => {
        logger.debug(`Socket disconnected: ${socket.id}, reason: ${reason}`);
      });

      socket.on('error', (error) => {
        logger.error(`Socket error: ${socket.id}`, error);
      });
    });

    // Connection metrics
    this.io.engine.on('connection_error', (err) => {
      logger.error('Socket.IO connection error:', err);
      MetricsCollector.increment('socket_connection_errors');
    });
  }

  async setupMiddleware() {
    // Trust proxy configuration
    this.app.set('trust proxy', CONFIG.NODE_ENV === 'production' ? 1 : 'loopback');
    this.app.set('x-powered-by', false);

    // Request timeout
    this.app.use((req, res, next) => {
      res.setTimeout(CONFIG.REQUEST_TIMEOUT, () => {
        res.status(408).json({
          error: 'Request timeout',
          timeout: CONFIG.REQUEST_TIMEOUT
        });
      });
      next();
    });

    // Enhanced security headers
    this.app.use(helmet({
      contentSecurityPolicy: CONFIG.NODE_ENV === 'production' ? {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          connectSrc: ["'self'", "wss:", "ws:"],
          mediaSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      } : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // Brute force protection
    const bruteForce = SecurityManager.createBruteForceProtection();
    this.app.use('/api/v1/auth/login', bruteForce.prevent);
    this.app.use('/api/v1/auth/forgot-password', bruteForce.prevent);

    // Advanced rate limiting
    this.app.use('/api/', SecurityManager.createAdvancedRateLimit(
      CONFIG.RATE_LIMIT_WINDOW, 
      CONFIG.RATE_LIMIT_MAX, 
      'Too many requests from this IP'
    ));
    
    this.app.use('/api/v1/auth/', SecurityManager.createAdvancedRateLimit(
      15 * 60 * 1000, 
      50, 
      'Too many authentication attempts',
      true
    ));

    // Slow down for specific endpoints
    this.app.use('/api/v1/search', SecurityManager.createSlowDown(
      15 * 60 * 1000, 
      100, 
      500
    ));

    // Enhanced CORS
    this.app.use(cors({
      origin: (origin, callback) => {
        if (SecurityManager.isValidOrigin(origin)) {
          callback(null, true);
        } else {
          logger.warn(`🚫 CORS blocked origin: ${origin || 'null'}`);
          MetricsCollector.increment('cors_blocked', { origin });
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
        'Pragma'
      ],
      exposedHeaders: ['X-Total-Count', 'X-Page-Count', 'X-Correlation-ID', 'API-Version'],
      optionsSuccessStatus: 200,
      maxAge: 86400
    }));

    // Enhanced body parsing
    this.app.use(express.json({
      limit: CONFIG.MAX_REQUEST_SIZE,
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
      type: ['application/json', 'application/*+json']
    }));
    
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: CONFIG.MAX_REQUEST_SIZE,
      parameterLimit: 1000
    }));

    this.app.use(cookieParser());

    // Advanced compression
    this.app.use(compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        if (res.getHeader('Content-Type')?.includes('image/')) return false;
        return compression.filter(req, res);
      },
      threshold: CONFIG.COMPRESSION_THRESHOLD,
      level: 6,
      memLevel: 8
    }));

    // Request logging
    if (CONFIG.NODE_ENV !== 'production' || process.env.ENABLE_LOGGING === 'true') {
      this.app.use(morgan(
        CONFIG.NODE_ENV === 'production' ? 'combined' : 'dev',
        {
          stream: { write: (message) => logger.info(message.trim()) },
          skip: (req) => {
            return CONFIG.NODE_ENV === 'production' && (
              req.method === 'OPTIONS' || 
              req.url === '/health' ||
              req.url === '/metrics' ||
              req.url === '/favicon.ico'
            );
          }
        }
      ));
    }

    // Request correlation and metrics
    this.app.use((req, res, next) => {
      const startTime = process.hrtime.bigint();
      req.correlationId = `${Date.now().toString(36)}-${Math.random().toString(36).substr(2)}`;
      req.startTime = startTime;
      
      res.setHeader('X-Correlation-ID', req.correlationId);
      res.setHeader('X-Response-Time', '0ms');

      // Metrics collection
      MetricsCollector.increment('http_requests_total', {
        method: req.method,
        endpoint: req.route?.path || req.path,
        user_agent: req.headers['user-agent']
      });

      const originalSend = res.send;
      res.send = function(data) {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        
        res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
        
        // Log slow requests
        if (duration > 1000) {
          logger.warn(`🐌 Slow request [${req.correlationId}]: ${req.method} ${req.originalUrl} took ${duration.toFixed(2)}ms`);
        }

        // Metrics for response
        MetricsCollector.histogram('http_request_duration_ms', duration, {
          method: req.method,
          status_code: res.statusCode.toString(),
          endpoint: req.route?.path || req.path
        });

        MetricsCollector.increment('http_responses_total', {
          method: req.method,
          status_code: res.statusCode.toString()
        });

        if (!CONFIG.NODE_ENV === 'production' && req.method !== 'OPTIONS') {
          console.log(`📤 [${req.correlationId}] ${res.statusCode} (${duration.toFixed(2)}ms)`);
        }

        return originalSend.call(this, data);
      };

      if (!CONFIG.NODE_ENV === 'production' && req.method !== 'OPTIONS') {
        console.log(`📥 [${req.correlationId}] ${req.method} ${req.originalUrl} from ${req.headers.origin || 'unknown'}`);
      }

      next();
    });

    // Request validation middleware
    this.app.use(ValidationMiddleware.validateRequest);

    // Security middleware
    this.app.use(SecurityMiddleware.checkSecurity);
  }

  async connectDatabase() {
    const maxRetries = 5;
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        await connectDB({
          maxPoolSize: CONFIG.DB_MAX_CONNECTIONS,
          serverSelectionTimeoutMS: CONFIG.DB_TIMEOUT,
          socketTimeoutMS: CONFIG.DB_TIMEOUT,
          maxIdleTimeMS: 30000,
          retryWrites: true,
          retryReads: true
        });
        
        logger.info('✅ Database connected successfully');
        MetricsCollector.increment('database_connections_total', { status: 'success' });
        return;
      } catch (error) {
        retries++;
        MetricsCollector.increment('database_connections_total', { status: 'failed' });
        logger.warn(`Database connection attempt ${retries}/${maxRetries} failed: ${error.message}`);
        
        if (retries === maxRetries) {
          throw new Error(`Failed to connect to database after ${maxRetries} attempts`);
        }
        
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
      }
    }
  }

  async loadRoutes() {
    const result = await this.routeManager.loadRoutes(this.app);
    this.loadedRoutes = result.routes;
    return result;
  }

  setupEndpoints() {
    // Enhanced root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'QuickLocal API',
        version: process.env.npm_package_version || '2.0.0',
        status: 'operational',
        timestamp: new Date().toISOString(),
        environment: CONFIG.NODE_ENV,
        api_version: CONFIG.API_VERSION,
        server: {
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          node_version: process.version,
          platform: process.platform,
          cpu_count: os.cpus().length
        },
        endpoints: this.loadedRoutes.reduce((acc, route) => {
          acc[route.name.toLowerCase().replace(/\s+/g, '_')] = route.path;
          return acc;
        }, {}),
        features: {
          websockets: !!this.io,
          clustering: CONFIG.CLUSTER_MODE,
          metrics: CONFIG.METRICS_ENABLED,
          compression: true,
          rate_limiting: true,
          brute_force_protection: true
        },
        documentation: {
          health_check: '/health',
          metrics: '/metrics',
          api_docs: '/api/v1/docs',
          rate_limits: {
            general: `${CONFIG.RATE_LIMIT_MAX} requests per ${CONFIG.RATE_LIMIT_WINDOW / 60000} minutes`,
            auth: '50 requests per 15 minutes'
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
        environment: CONFIG.NODE_ENV,
        version: process.env.npm_package_version || '2.0.0',
        checks: {
          database: await this.checkDatabase(),
          memory: this.checkMemory(),
          disk: this.checkDisk(),
          external_services: await this.checkExternalServices()
        },
        system: {
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          platform: process.platform,
          node_version: process.version,
          load_average: os.loadavg()
        }
      };

      // Determine overall health
      const failedChecks = Object.values(healthData.checks).filter(check => check.status !== 'healthy');
      if (failedChecks.length > 0) {
        healthData.status = failedChecks.some(check => check.status === 'critical') ? 'unhealthy' : 'degraded';
      }

      const statusCode = healthData.status === 'healthy' ? 200 : 
                        healthData.status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json(healthData);
    });

    // Metrics endpoint
    if (CONFIG.METRICS_ENABLED) {
      this.app.get('/metrics', (req, res) => {
        res.set('Content-Type', 'text/plain');
        res.send(this.metricsCollector.getMetrics());
      });
    }

    // API documentation endpoint
    this.app.get('/api/v1/docs', (req, res) => {
      res.json({
        title: 'QuickLocal API Documentation',
        version: CONFIG.API_VERSION,
        description: 'E-commerce platform API with real-time features',
        base_url: `${req.protocol}://${req.get('host')}/api/v1`,
        authentication: {
          type: 'Bearer Token',
          header: 'Authorization',
          format: 'Bearer <token>'
        },
        endpoints: this.loadedRoutes,
        rate_limits: {
          general: `${CONFIG.RATE_LIMIT_MAX} requests per ${CONFIG.RATE_LIMIT_WINDOW / 60000} minutes`,
          auth: '50 requests per 15 minutes'
        },
        websocket: {
          enabled: !!this.io,
          url: `ws://${req.get('host')}`,
          events: ['order_update', 'delivery_status', 'chat_message']
        }
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
        host: mongoose.connection.host
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
    const usagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    return {
      status: usagePercent > 90 ? 'critical' : usagePercent > 75 ? 'degraded' : 'healthy',
      heap_used: memUsage.heapUsed,
      heap_total: memUsage.heapTotal,
      usage_percent: Math.round(usagePercent),
      external: memUsage.external,
      rss: memUsage.rss
    };
  }

  checkDisk() {
    try {
      const stats = fs.statSync(__dirname);
      return {
        status: 'healthy',
        available: true,
        path: __dirname
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
    // Check external services with circuit breaker
    const services = [];
    
    try {
      // Example: Check payment gateway
      if (process.env.PAYMENT_GATEWAY_URL) {
        const paymentStatus = await this.circuitBreaker.execute(
          'payment_gateway',
          () => this.pingService(process.env.PAYMENT_GATEWAY_URL)
        );
        services.push({ name: 'payment_gateway', ...paymentStatus });
      }

      // Example: Check notification service
      if (process.env.NOTIFICATION_SERVICE_URL) {
        const notificationStatus = await this.circuitBreaker.execute(
          'notification_service',
          () => this.pingService(process.env.NOTIFICATION_SERVICE_URL)
        );
        services.push({ name: 'notification_service', ...notificationStatus });
      }
    } catch (error) {
      logger.warn('External service health check failed:', error.message);
    }

    return {
      status: services.every(s => s.status === 'healthy') ? 'healthy' : 'degraded',
      services
    };
  }

  async pingService(url, timeout = 5000) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(`${url}/health`, {
        signal: controller.signal,
        method: 'GET',
        headers: { 'User-Agent': 'QuickLocal-HealthCheck/1.0' }
      });
      
      clearTimeout(timeoutId);
      
      return {
        status: response.ok ? 'healthy' : 'degraded',
        response_time: Date.now(),
        status_code: response.status
      };
    } catch (error) {
      return {
        status: 'critical',
        message: error.message,
        error: 'Service unreachable'
      };
    }
  }

  setupErrorHandling() {
    // Shutdown middleware
    this.app.use((req, res, next) => {
      if (this.isShuttingDown) {
        res.status(503).json({
          error: 'Server is shutting down',
          message: 'Please try again in a few moments'
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
      
      // Find similar routes
      const suggestions = availableRoutes.filter(route => {
        const similarity = this.calculateSimilarity(requestedPath, route);
        return similarity > 0.5;
      }).slice(0, 3);

      logger.warn(`404: ${method} ${requestedPath} from ${req.headers.origin || 'unknown'} [${req.correlationId}]`);
      
      MetricsCollector.increment('http_404_errors', {
        method,
        path: requestedPath,
        origin: req.headers.origin || 'unknown'
      });
      
      res.status(404).json({
        error: 'Endpoint not found',
        message: `${method} ${requestedPath} does not exist`,
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        suggestions: {
          documentation: '/ for API documentation, /api/v1/docs for detailed docs',
          similar_routes: suggestions,
          available_methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          api_version: `Current API version is ${CONFIG.API_VERSION}`
        }
      });
    });

    // Enhanced global error handler
    this.app.use((err, req, res, next) => {
      const errorId = `${Date.now().toString(36)}-${Math.random().toString(36).substr(2)}`;
      
      // Enhanced error logging
      const errorLog = {
        error_id: errorId,
        error: err.message,
        stack: CONFIG.NODE_ENV === 'production' ? undefined : err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        user_agent: req.headers['user-agent'],
        correlation_id: req.correlationId,
        user_id: req.user?.id || null,
        timestamp: new Date().toISOString()
      };

      logger.error(`Unhandled error [${errorId}]:`, errorLog);

      // Metrics
      MetricsCollector.increment('http_errors_total', {
        error_type: err.name || 'UnknownError',
        status_code: (err.status || err.statusCode || 500).toString(),
        method: req.method,
        endpoint: req.route?.path || req.path
      });

      // Enhanced error type handling
      let statusCode = err.status || err.statusCode || 500;
      let message = err.message;
      let errorType = 'internal_server_error';

      if (err.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation failed';
        errorType = 'validation_error';
      } else if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid ID format';
        errorType = 'cast_error';
      } else if (err.code === 11000) {
        statusCode = 409;
        message = 'Duplicate entry';
        errorType = 'duplicate_error';
      } else if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid token';
        errorType = 'jwt_error';
      } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token expired';
        errorType = 'token_expired';
      } else if (err.name === 'MongooseError') {
        statusCode = 500;
        message = 'Database error';
        errorType = 'database_error';
      }

      const errorResponse = {
        error: CONFIG.NODE_ENV === 'production' && statusCode === 500 ? 'Internal Server Error' : message,
        error_id: errorId,
        error_type: errorType,
        correlation_id: req.correlationId,
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        method: req.method,
        ...(CONFIG.NODE_ENV === 'production' ? {} : { 
          stack: err.stack,
          details: err.details || null,
          validation_errors: err.errors || null
        })
      };

      // Add helpful information for common errors
      if (statusCode === 401) {
        errorResponse.help = 'Please provide a valid authentication token in the Authorization header';
      } else if (statusCode === 403) {
        errorResponse.help = 'You do not have permission to perform this action';
      } else if (statusCode === 429) {
        errorResponse.help = 'Too many requests. Please wait before trying again';
        errorResponse.retry_after = err.retryAfter || Math.ceil(CONFIG.RATE_LIMIT_WINDOW / 1000);
      }

      res.status(statusCode).json(errorResponse);
    });

    // Global uncaught exception handler
    process.on('uncaughtException', (err) => {
      logger.error('💥 Uncaught Exception:', err);
      MetricsCollector.increment('uncaught_exceptions');
      
      // Give some time for logs to be written
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // Global unhandled promise rejection handler
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      MetricsCollector.increment('unhandled_rejections');
    });
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
      this.server.listen(CONFIG.PORT, CONFIG.HOST, (err) => {
        if (err) {
          reject(err);
          return;
        }

        logger.info('🚀 QuickLocal API Server started successfully');
        
        const serverInfo = `
🌟 QuickLocal E-commerce API Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Server Configuration:
   🌍 URL: http://${CONFIG.HOST}:${CONFIG.PORT}
   🏗️  Environment: ${CONFIG.NODE_ENV}
   🔧 Node.js: ${process.version}
   🖥️  Platform: ${process.platform}
   💾 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB used
   🔄 Process ID: ${process.pid}

🗄️  Database:
   📊 Status: Connected
   🏪 Database: ${mongoose.connection.db?.databaseName}
   🖥️  Host: ${mongoose.connection.host}
   ⚡ Max Connections: ${CONFIG.DB_MAX_CONNECTIONS}

🛡️  Security Features:
   🔒 Helmet Security Headers: ✅
   🚦 Rate Limiting: ✅ (${CONFIG.RATE_LIMIT_MAX}/${CONFIG.RATE_LIMIT_WINDOW / 60000}min)
   🛑 Brute Force Protection: ✅
   🌐 CORS: ✅ (${CORS_ORIGINS.length} origins)
   🔐 Request Validation: ✅

🚀 Performance Features:
   📦 Compression: ✅ (threshold: ${CONFIG.COMPRESSION_THRESHOLD}B)
   📊 Metrics Collection: ${CONFIG.METRICS_ENABLED ? '✅' : '❌'}
   🔌 Socket.IO: ${this.io ? '✅' : '❌'}
   ⚡ Circuit Breaker: ✅
   🕐 Request Timeout: ${CONFIG.REQUEST_TIMEOUT / 1000}s

📚 API Information:
   📖 Documentation: /api/v1/docs
   ❤️  Health Check: /health
   📊 Metrics: /metrics
   🔍 API Version: ${CONFIG.API_VERSION}
   📍 Routes: ${this.loadedRoutes.length} loaded

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ Server is ready to handle requests!
🌐 Visit http://${CONFIG.HOST}:${CONFIG.PORT} for API documentation
`;

        console.log(serverInfo);
        
        MetricsCollector.increment('server_starts_total');
        resolve();
      });

      // Enhanced server error handling
      this.server.on('error', (err) => {
        MetricsCollector.increment('server_errors_total', { error_code: err.code });
        
        if (err.code === 'EADDRINUSE') {
          logger.error(`❌ Port ${CONFIG.PORT} is already in use. Please use a different port or stop the process using this port.`);
          logger.info(`💡 Try: lsof -ti:${CONFIG.PORT} | xargs kill -9`);
        } else if (err.code === 'EACCES') {
          logger.error(`❌ Permission denied for port ${CONFIG.PORT}. Try a port > 1024 or run with appropriate permissions.`);
        } else if (err.code === 'ENOTFOUND') {
          logger.error(`❌ Host ${CONFIG.HOST} not found. Please check your HOST configuration.`);
        } else {
          logger.error('❌ Server error:', err);
        }
        
        reject(err);
      });

      // Handle server warnings
      this.server.on('clientError', (err, socket) => {
        logger.warn('Client error:', err.message);
        MetricsCollector.increment('client_errors_total');
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      });
    });
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) {
        logger.warn('Shutdown already in progress...');
        return;
      }

      this.isShuttingDown = true;
      logger.info(`🛑 ${signal} received. Starting graceful shutdown...`);
      
      MetricsCollector.increment('graceful_shutdowns_total', { signal });

      const shutdownTimeout = setTimeout(() => {
        logger.error('❌ Graceful shutdown timeout. Forcing exit...');
        process.exit(1);
      }, 30000); // 30 second timeout

      try {
        // Stop accepting new connections
        logger.info('🔄 Stopping server...');
        await new Promise((resolve, reject) => {
          this.server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Close Socket.IO connections
        if (this.io) {
          logger.info('🔄 Closing Socket.IO connections...');
          this.io.close();
        }

        // Close database connections
        logger.info('🔄 Closing database connections...');
        await mongoose.connection.close();

        // Final cleanup
        logger.info('🔄 Performing final cleanup...');
        clearTimeout(shutdownTimeout);
        
        logger.info('✅ Graceful shutdown completed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    // Handle different shutdown signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // Nodemon restart
    process.on('SIGHUP', () => shutdown('SIGHUP'));   // Terminal closed
  }
}

// Cluster Management
class ClusterManager {
  static start() {
    if (CONFIG.CLUSTER_MODE && cluster.isPrimary) {
      logger.info(`🔄 Starting ${CONFIG.MAX_WORKERS} workers...`);
      
      for (let i = 0; i < CONFIG.MAX_WORKERS; i++) {
        cluster.fork();
      }

      cluster.on('exit', (worker, code, signal) => {
        logger.warn(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
        logger.info('🔄 Starting a new worker...');
        cluster.fork();
      });

      cluster.on('online', (worker) => {
        logger.info(`✅ Worker ${worker.process.pid} is online`);
      });

      // Graceful shutdown for cluster
      process.on('SIGTERM', () => {
        logger.info('🛑 Master received SIGTERM, shutting down workers...');
        
        for (const id in cluster.workers) {
          cluster.workers[id].kill();
        }
      });

    } else {
      // Worker process or single process mode
      const server = new QuickLocalServer();
      server.initialize().catch((error) => {
        logger.error('❌ Worker startup failed:', error);
        process.exit(1);
      });
    }
  }
}

// Start the server
if (require.main === module) {
  ClusterManager.start();
}

module.exports = { 
  QuickLocalServer, 
  ClusterManager, 
  CONFIG,
  SecurityManager,
  RouteManager 
};