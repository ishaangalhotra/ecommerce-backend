// Memory monitoring and optimization
const memoryMonitor = {
  checkInterval: null,
  
  start() {
    console.log('🧠 Starting memory monitoring...');
    
    // Check memory every 2 minutes instead of 5
    this.checkInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      const usage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
      
      console.log(`💾 Memory: ${heapUsedMB}MB/${heapTotalMB}MB (${usage}%)`);
      
      // Alert at 80% instead of trying to force GC
      if (usage > 80) {
        console.warn(`⚠️ HIGH MEMORY USAGE: ${usage}% (${heapUsedMB}MB/${heapTotalMB}MB)`);
        
        // Log memory breakdown for debugging
        console.log('Memory breakdown:', {
          rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
          external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
        });
      }
      
      // Critical memory warning at 95%
      if (usage > 95) {
        console.error(`🚨 CRITICAL MEMORY USAGE: ${usage}% - Server may crash soon!`);
      }
    }, 2 * 60 * 1000); // Every 2 minutes
  },
  
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('🧠 Memory monitoring stopped');
    }
  }
};

// Handle memory warnings
process.on('warning', (warning) => {
  console.warn('⚠️ Node.js warning:', {
    name: warning.name,
    message: warning.message
  });
});

// server.js - QuickLocal Production-Ready Server v2.1.0
// Enhanced and Optimized E-commerce Platform Server
require('dotenv').config();

// Ensure NODE_ENV has a fallback
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const fs = require('fs').promises;
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
const session = require('express-session');
const MongoStore = require('connect-mongo');

// Enhanced Memory Monitor with Better Performance
class MemoryMonitor {
  constructor(options = {}) {
    this.interval = options.interval || 2 * 60 * 1000; // 2 minutes
    this.warningThreshold = options.warningThreshold || 80;
    this.criticalThreshold = options.criticalThreshold || 95;
    this.checkInterval = null;
    this.lastGC = Date.now();
  }

  start() {
    console.log('🧠 Starting enhanced memory monitoring...');
    
    this.checkInterval = setInterval(() => {
      this.checkMemory();
    }, this.interval);

    // Listen for memory pressure events
    process.on('warning', this.handleWarning.bind(this));
  }

  checkMemory() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const usage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    
    const systemMem = {
      free: Math.round(os.freemem() / 1024 / 1024),
      total: Math.round(os.totalmem() / 1024 / 1024)
    };
    
    console.log(`💾 Memory: ${heapUsedMB}MB/${heapTotalMB}MB (${usage}%) | System: ${systemMem.total - systemMem.free}MB/${systemMem.total}MB`);
    
    if (usage > this.warningThreshold) {
      this.handleHighMemory(usage, heapUsedMB, heapTotalMB);
    }
    
    if (usage > this.criticalThreshold) {
      this.handleCriticalMemory(usage, heapUsedMB, heapTotalMB);
    }

    // Suggest GC if memory is high and it's been a while since last GC
    if (usage > 70 && (Date.now() - this.lastGC) > 5 * 60 * 1000) {
      this.suggestGarbageCollection();
    }
  }

  handleHighMemory(usage, heapUsed, heapTotal) {
    console.warn(`⚠️ HIGH MEMORY USAGE: ${usage}% (${heapUsed}MB/${heapTotal}MB)`);
    
    const breakdown = this.getMemoryBreakdown();
    console.log('Memory breakdown:', breakdown);
    
    // Emit warning event for monitoring systems
    process.emit('memoryWarning', { usage, heapUsed, heapTotal, breakdown });
  }

  handleCriticalMemory(usage, heapUsed, heapTotal) {
    console.error(`🚨 CRITICAL MEMORY USAGE: ${usage}% - Optimization needed!`);
    
    // Force garbage collection if available
    if (global.gc) {
      console.log('🗑️ Triggering garbage collection...');
      global.gc();
      this.lastGC = Date.now();
    }
    
    // Emit critical event for monitoring systems
    process.emit('memoryCritical', { usage, heapUsed, heapTotal });
  }

  suggestGarbageCollection() {
    if (global.gc) {
      console.log('🔄 Suggesting garbage collection for memory optimization...');
      global.gc();
      this.lastGC = Date.now();
    }
  }

  getMemoryBreakdown() {
    const memUsage = process.memoryUsage();
    return {
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
      arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024) + 'MB'
    };
  }

  handleWarning(warning) {
    if (warning.name === 'MaxListenersExceededWarning' || 
        warning.name === 'DeprecationWarning') {
      console.warn(`⚠️ Node.js warning: ${warning.name}`, {
        message: warning.message,
        stack: process.env.NODE_ENV === 'development' ? warning.stack : undefined
      });
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('🧠 Memory monitoring stopped');
    }
  }

  getStats() {
    return {
      ...this.getMemoryBreakdown(),
      uptime: Math.floor(process.uptime()),
      lastGC: new Date(this.lastGC).toISOString()
    };
  }
}

// Enhanced Configuration with Better Validation
class QuickLocalConfig {
  constructor() {
    this.validateEnvironment();
    this.config = this.buildConfig();
    this.IS_PRODUCTION = this.config.NODE_ENV === 'production';
    this.IS_DEVELOPMENT = this.config.NODE_ENV === 'development';
  }

  validateEnvironment() {
    const criticalVars = [
      'MONGODB_URI', 'JWT_SECRET', 'COOKIE_SECRET', 'SESSION_SECRET'
    ];
    
    const missing = criticalVars.filter(varName => {
      const value = process.env[varName] || process.env[varName.replace('MONGODB_URI', 'MONGO_URI')];
      return !value || value.trim().length === 0;
    });
    
    if (missing.length > 0) {
      throw new Error(`❌ Critical environment variables missing: ${missing.join(', ')}`);
    }

    // Validate configuration values
    this.validateConfigValues();
    console.log('✅ Environment validation passed');
  }

  validateConfigValues() {
    const port = parseInt(process.env.PORT);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error('❌ Invalid PORT value. Must be between 1-65535');
    }

    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS);
    if (saltRounds && (isNaN(saltRounds) || saltRounds < 8 || saltRounds > 20)) {
      console.warn('⚠️ BCRYPT_SALT_ROUNDS should be between 8-20 for optimal security');
    }

    // Validate JWT expiration format
    const jwtExpires = process.env.JWT_ACCESS_EXPIRES;
    if (jwtExpires && !/^\d+[smhd]$/.test(jwtExpires)) {
      console.warn('⚠️ JWT_ACCESS_EXPIRES format may be invalid. Use format like "24h", "7d", "30m"');
    }
  }

  buildConfig() {
    return {
      // Application Core
      NODE_ENV: process.env.NODE_ENV,
      APP_NAME: process.env.APP_NAME || 'QuickLocal',
      APP_VERSION: process.env.APP_VERSION || '2.1.0',
      PORT: this.getEnvNumber('PORT', 10000),
      HOST: process.env.HOST || '0.0.0.0',
      INSTANCE_ID: process.env.INSTANCE_ID || `ql-${Date.now().toString(36)}-${Math.random().toString(36).substr(2)}`,
      
      // API Configuration
      API_VERSION: process.env.API_VERSION || 'v1',
      API_BASE_PATH: process.env.API_BASE_PATH || '/api/v1',
      MAX_REQUEST_SIZE: process.env.MAX_REQUEST_SIZE || '10mb',
      REQUEST_TIMEOUT: this.getEnvNumber('REQUEST_TIMEOUT', 30000),
      
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
      RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
      RATE_LIMIT_WINDOW: this.getEnvNumber('RATE_LIMIT_WINDOW_MS', 900000),
      RATE_LIMIT_MAX: this.getEnvNumber('RATE_LIMIT_MAX', 1000),
      AUTH_RATE_LIMIT_MAX: this.getEnvNumber('AUTH_RATE_LIMIT_MAX', 20),
      ORDER_RATE_LIMIT_MAX: this.getEnvNumber('ORDER_RATE_LIMIT_MAX', 10),
      MAX_LOGIN_ATTEMPTS: this.getEnvNumber('MAX_LOGIN_ATTEMPTS', 5),
      LOGIN_LOCKOUT_TIME: this.getEnvNumber('LOGIN_LOCKOUT_TIME', 15),
      
      // Performance
      CLUSTER_MODE: process.env.ENABLE_CLUSTER_MODE === 'true',
      MAX_WORKERS: this.getWorkerCount(),
      COMPRESSION_ENABLED: process.env.ENABLE_COMPRESSION !== 'false',
      COMPRESSION_LEVEL: this.getEnvNumber('COMPRESSION_LEVEL', 6),
      
      // Features
      ENABLE_SOCKET_IO: this.shouldEnableSocketIO(),
      ENABLE_METRICS: process.env.ENABLE_ERROR_TRACKING === 'true',
      ENABLE_CACHING: process.env.ENABLE_RESPONSE_CACHING === 'true',
      CACHE_TTL: this.getEnvNumber('CACHE_TTL', 3600),
      
      // Security Headers
      HELMET_ENABLED: process.env.ENABLE_HELMET !== 'false',
      CSP_ENABLED: process.env.HELMET_CSP_ENABLED === 'true',
      HSTS_MAX_AGE: this.getEnvNumber('HSTS_MAX_AGE', 63072000),
      HSTS_INCLUDE_SUBDOMAINS: process.env.HSTS_INCLUDE_SUBDOMAINS === 'true',
      
      // Logging
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      LOG_DIR: process.env.LOG_DIR || './logs',
      ENABLE_REQUEST_LOGGING: process.env.ENABLE_REQUEST_LOGGING !== 'false',
      ENABLE_ERROR_TRACKING: process.env.ENABLE_ERROR_TRACKING === 'true',
      
      // File Upload
      MAX_FILE_SIZE: this.getEnvNumber('MAX_FILE_SIZE', 10485760),
      ALLOWED_FILE_TYPES: this.parseFileTypes(),
      
      // External Services
      REDIS_ENABLED: process.env.REDIS_ENABLED === 'true' && !process.env.DISABLE_REDIS,
      REDIS_URL: process.env.REDIS_URL,
      
      // Development
      DEBUG_MODE: process.env.DEBUG_MODE === 'true',
      MOCK_PAYMENT: process.env.MOCK_PAYMENT === 'true',
      ENABLE_API_DOCS: process.env.ENABLE_API_DOCS !== 'false'
    };
  }

  getEnvNumber(key, defaultValue) {
    const value = process.env[key];
    const parsed = parseInt(value, 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : defaultValue;
  }

  getWorkerCount() {
    const specified = process.env.CLUSTER_WORKERS;
    if (specified === 'auto' || !specified) {
      return Math.max(2, Math.min(os.cpus().length, 8)); // Cap at 8 workers
    }
    return this.getEnvNumber('CLUSTER_WORKERS', os.cpus().length);
  }

  shouldEnableSocketIO() {
    return process.env.FEATURE_LIVE_TRACKING === 'true' || 
           process.env.FEATURE_CHAT === 'true' ||
           process.env.ENABLE_SOCKET_IO === 'true';
  }

  parseFileTypes() {
    const types = process.env.ALLOWED_FILE_TYPES;
    return types ? types.split(',').map(t => t.trim()) : [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif'
    ];
  }
}

// Enhanced CORS Manager with Better Security
class CORSManager {
  static getOrigins() {
    const origins = new Set();
    
    // Add from environment variables
    this.addOriginsFromEnv('FRONTEND_URLS', origins);
    this.addOriginsFromEnv('ALLOWED_ORIGINS', origins);
    
    // Add individual URLs
    [
      process.env.CLIENT_URL, 
      process.env.ADMIN_URL, 
      process.env.API_URL
    ].forEach(url => {
      if (url && this.isValidUrl(url)) {
        origins.add(url.trim());
      }
    });
    
    // Development origins (only in development)
    if (process.env.NODE_ENV === 'development') {
      this.addDevelopmentOrigins(origins);
    }
    
    return Array.from(origins);
  }

  static addOriginsFromEnv(envVar, origins) {
    const urls = process.env[envVar];
    if (urls) {
      urls.split(',')
         .map(url => url.trim())
         .filter(url => this.isValidUrl(url))
         .forEach(url => origins.add(url));
    }
  }

  static addDevelopmentOrigins(origins) {
    const devOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5173',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:8080',
      'file://',  // For local HTML files
      'null'      // For some browsers
    ];
    
    devOrigins.forEach(origin => origins.add(origin));
  }

  static isValidUrl(url) {
    try {
      new URL(url);
      return url.startsWith('http://') || url.startsWith('https://');
    } catch (error) {
      return false;
    }
  }

  static isValidOrigin(origin) {
    if (!origin) return true; // Allow requests without origin header
    
    const allowedOrigins = this.getOrigins();
    if (allowedOrigins.includes(origin)) return true;
    
    // Check deployment platform patterns
    const platformPatterns = [
      /^https:\/\/.*\.vercel\.app$/,
      /^https:\/\/.*\.netlify\.app$/,
      /^https:\/\/.*\.herokuapp\.com$/,
      /^https:\/\/.*\.railway\.app$/,
      /^https:\/\/.*\.render\.com$/,
      /^https:\/\/.*\.onrender\.com$/,
      /^https:\/\/.*\.surge\.sh$/,
      /^https:\/\/.*\.github\.io$/
    ];
    
    return platformPatterns.some(pattern => pattern.test(origin));
  }

  static createCorsOptions() {
    return {
      origin: (origin, callback) => {
        if (this.isValidOrigin(origin)) {
          callback(null, true);
        } else {
          console.warn(`🚫 CORS blocked origin: ${origin}`);
          callback(new Error('CORS policy violation'), false);
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
        'X-API-Key',
        'X-Client-Version'
      ],
      exposedHeaders: [
        'X-Total-Count', 
        'X-Page-Count', 
        'X-Correlation-ID', 
        'API-Version',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset',
        'X-Response-Time'
      ],
      optionsSuccessStatus: 200,
      maxAge: 86400 // 24 hours
    };
  }
}

// Enhanced Security Manager with Better Protection
class SecurityManager {
  static createBruteForceProtection() {
    // Simple in-memory store for basic brute force protection
    const attempts = new Map();
    
    return {
      prevent: (req, res, next) => {
        const key = req.ip + req.originalUrl;
        const now = Date.now();
        const windowMs = 15 * 60 * 1000; // 15 minutes
        const maxAttempts = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
        
        if (!attempts.has(key)) {
          attempts.set(key, { count: 0, resetTime: now + windowMs });
        }
        
        const attempt = attempts.get(key);
        
        if (now > attempt.resetTime) {
          attempt.count = 0;
          attempt.resetTime = now + windowMs;
        }
        
        if (attempt.count >= maxAttempts) {
          const remainingTime = Math.ceil((attempt.resetTime - now) / 1000);
          console.warn(`🛑 Brute force protection triggered for ${req.ip}`);
          
          return res.status(429).json({
            error: 'Too many failed attempts',
            message: 'Account temporarily locked due to multiple failed login attempts',
            retryAfter: remainingTime,
            lockoutTime: Math.ceil(remainingTime / 60) + ' minutes'
          });
        }
        
        // Increment attempt count on login failure
        res.on('finish', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            attempt.count++;
          }
        });
        
        next();
      }
    };
  }

  static createRateLimit(windowMs, max, message = 'Too many requests') {
    return rateLimit({
      windowMs,
      max,
      message: {
        error: 'Rate limit exceeded',
        message,
        type: 'rate_limit_exceeded'
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        console.warn(`🚦 Rate limit exceeded for ${req.ip} on ${req.originalUrl}`);
        res.status(429).json({
          error: 'Rate limit exceeded',
          message,
          retryAfter: Math.ceil(windowMs / 1000),
          type: 'rate_limit_exceeded',
          limit: max,
          window: `${windowMs / 1000} seconds`
        });
      },
      skip: (req) => {
        // Skip rate limiting for health checks and metrics
        return req.path === '/health' || req.path === '/metrics' || req.path === '/status';
      }
    });
  }

  static createSlowDown(windowMs, delayAfter, delayMs = 500) {
    return slowDown({
      windowMs,
      delayAfter,
      delayMs: () => delayMs,
      maxDelayMs: 20000,
      skipFailedRequests: true,
      skipSuccessfulRequests: false
    });
  }

  static createSecurityHeaders() {
    return (req, res, next) => {
      // Enhanced security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      
      // Remove server information
      res.removeHeader('X-Powered-By');
      res.setHeader('Server', 'QuickLocal');
      
      next();
    };
  }

  static validateRequest() {
    return (req, res, next) => {
      // Basic request validation
      const userAgent = req.get('User-Agent');
      const host = req.get('Host');
      
      if (!userAgent || userAgent.length < 5) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: 'Invalid or missing User-Agent header'
        });
      }
      
      if (!host) {
        return res.status(400).json({
          error: 'Bad request',
          message: 'Missing Host header'
        });
      }
      
      // Check for suspicious patterns
      const suspiciousPatterns = [
        /sqlmap/i,
        /nmap/i,
        /nikto/i,
        /burp/i,
        /<script/i,
        /javascript:/i,
        /vbscript:/i
      ];
      
      const isSuspicious = suspiciousPatterns.some(pattern => {
        return pattern.test(userAgent) || pattern.test(req.originalUrl);
      });
      
      if (isSuspicious) {
        console.warn(`🚨 Suspicious request detected from ${req.ip}: ${userAgent}`);
        return res.status(403).json({
          error: 'Access denied',
          message: 'Request flagged as suspicious'
        });
      }
      
      next();
    };
  }
}

// Enhanced Route Manager with Better Error Handling
class RouteManager {
  constructor() {
    this.routes = this.defineRoutes();
    this.loadedRoutes = [];
    this.failedRoutes = [];
  }

  defineRoutes() {
    return [
      { path: '/api/v1/auth', module: './routes/auth', name: 'Authentication', priority: 1, critical: true },
      { path: '/api/v1/users', module: './routes/users', name: 'User Management', priority: 2, critical: true },
      { path: '/api/v1/products', module: './routes/products', name: 'Product Catalog', priority: 3, critical: true },
      { path: '/api/v1/categories', module: './routes/categories', name: 'Categories', priority: 3, critical: false },
      { path: '/api/v1/orders', module: './routes/orders', name: 'Order Processing', priority: 4, critical: true },
      { path: '/api/v1/cart', module: './routes/cart', name: 'Shopping Cart', priority: 3, critical: true },
      { path: '/api/v1/wishlist', module: './routes/wishlist', name: 'User Wishlist', priority: 3, critical: false },
      { path: '/api/v1/seller', module: './routes/seller', name: 'Seller Dashboard', priority: 4, critical: true },
      { path: '/api/v1/admin', module: './routes/admin', name: 'Admin Panel', priority: 5, critical: false },
      { path: '/api/v1/payment', module: './routes/payment-routes', name: 'Payment Gateway', priority: 4, critical: true },
      { path: '/api/v1/webhooks', module: './routes/webhook-routes', name: 'Webhook Handlers', priority: 1, critical: false },
      { path: '/api/v1/delivery', module: './routes/delivery', name: 'Delivery Service', priority: 4, critical: false },
      { path: '/api/v1/analytics', module: './routes/analytics', name: 'Analytics', priority: 5, critical: false },
      { path: '/api/v1/notifications', module: './routes/notifications', name: 'Notifications', priority: 3, critical: false }
    ].concat(this.getFeatureRoutes());
  }

  getFeatureRoutes() {
    const featureRoutes = [];
    
    if (process.env.FEATURE_REVIEWS === 'true') {
      featureRoutes.push({ 
        path: '/api/v1/reviews', 
        module: './routes/reviews', 
        name: 'Reviews & Ratings', 
        priority: 3, 
        critical: false 
      });
    }
    
    if (process.env.FEATURE_CHAT === 'true') {
      featureRoutes.push({ 
        path: '/api/v1/chat', 
        module: './routes/chat', 
        name: 'Chat System', 
        priority: 3, 
        critical: false 
      });
    }

    if (process.env.FEATURE_LOYALTY_PROGRAM === 'true') {
      featureRoutes.push({ 
        path: '/api/v1/loyalty', 
        module: './routes/loyalty', 
        name: 'Loyalty Program', 
        priority: 3, 
        critical: false 
      });
    }
    
    return featureRoutes.sort((a, b) => a.priority - b.priority);
  }

  async loadRoutes(app) {
    console.log('🔄 Loading QuickLocal API routes...');
    
    // Load routes by priority
    const sortedRoutes = [...this.routes].sort((a, b) => a.priority - b.priority);
    
    for (const route of sortedRoutes) {
      try {
        await this.loadSingleRoute(app, route);
      } catch (error) {
        this.handleRouteError(route, error);
      }
    }

    this.validateCriticalRoutes();
    this.logRouteSummary();
    
    return {
      loaded: this.loadedRoutes.length,
      failed: this.failedRoutes.length,
      routes: this.loadedRoutes
    };
  }

  async loadSingleRoute(app, route) {
    const { path, module, name, priority, critical } = route;
    
    // Clear cache in development for hot reloading
    if (process.env.NODE_ENV === 'development') {
      this.clearModuleCache(module);
    }

    // Try to load the module
    let routeModule;
    try {
      routeModule = require(module);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND' && !critical) {
        console.warn(`⚠️ Optional route module not found: ${module} - Skipping`);
        return;
      }
      throw error;
    }
    
    if (!this.isValidRouter(routeModule)) {
      throw new Error(`Invalid router export in ${module}`);
    }

    // Add route-specific middleware
    this.addRouteMiddleware(app, path, route);
    
    // Mount the route
    app.use(path, routeModule);
    
    this.loadedRoutes.push({ 
      path, 
      name, 
      priority, 
      status: 'loaded',
      critical,
      module 
    });
    
    console.log(`✅ ${name}: ${path} (Priority: ${priority}${critical ? ', Critical' : ''})`);
  }

  clearModuleCache(module) {
    try {
      const resolvedPath = require.resolve(module);
      delete require.cache[resolvedPath];
    } catch (e) {
      // Module doesn't exist yet
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

  addRouteMiddleware(app, path, route) {
    // API version middleware
    app.use(path, (req, res, next) => {
      req.apiVersion = process.env.API_VERSION || 'v1';
      res.setHeader('API-Version', req.apiVersion);
      next();
    });

    // Route-specific rate limiting
    if (path.includes('/auth')) {
      app.use(path, SecurityManager.createRateLimit(
        15 * 60 * 1000,
        parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 20,
        'Too many authentication attempts'
      ));
    } else if (path.includes('/orders')) {
      app.use(path, SecurityManager.createRateLimit(
        60 * 1000,
        parseInt(process.env.ORDER_RATE_LIMIT_MAX) || 10,
        'Too many order requests'
      ));
    } else if (path.includes('/payment')) {
      app.use(path, SecurityManager.createRateLimit(
        5 * 60 * 1000, // 5 minutes
        5, // 5 payment attempts per 5 minutes
        'Too many payment attempts'
      ));
    }
  }

  handleRouteError(route, error) {
    this.failedRoutes.push({
      path: route.path,
      name: route.name,
      error: error.message,
      critical: route.critical
    });
    
    const logLevel = route.critical ? 'error' : 'warn';
    console[logLevel](`${route.critical ? '❌' : '⚠️'} Failed to load ${route.name} (${route.path}): ${error.message}`);
    
    if (process.env.DEBUG_MODE === 'true') {
      console.error(error.stack);
    }
  }

  validateCriticalRoutes() {
    const failedCriticalRoutes = this.failedRoutes.filter(route => route.critical);
    if (failedCriticalRoutes.length > 0) {
      const routeNames = failedCriticalRoutes.map(r => r.name).join(', ');
      throw new Error(`❌ Critical routes failed to load: ${routeNames}`);
    }
  }

  logRouteSummary() {
    const { length: loaded } = this.loadedRoutes;
    const { length: failed } = this.failedRoutes;
    const critical = this.loadedRoutes.filter(r => r.critical).length;
    
    console.log(`📊 Route loading complete: ${loaded} loaded (${critical} critical), ${failed} failed`);
    
    if (failed > 0) {
      console.warn(`⚠️ Failed routes:`, this.failedRoutes.map(r => `${r.name} (${r.critical ? 'Critical' : 'Optional'})`));
    }
  }
}

// Enhanced Database Connection Manager
class DatabaseManager {
  static async connect(config) {
    const maxRetries = parseInt(process.env.DB_MAX_RETRY_ATTEMPTS) || 5;
    const retryDelay = parseInt(process.env.DB_RETRY_DELAY_MS) || 5000;
    let retries = 0;

    const mongooseOptions = {
      maxPoolSize: config.DB_POOL_SIZE,
      serverSelectionTimeoutMS: config.DB_TIMEOUT,
      socketTimeoutMS: 45000,
      family: 4, // Use IPv4, skip trying IPv6
      bufferCommands: false,
      maxIdleTimeMS: 30000,
      connectTimeoutMS: 30000,
    };

    while (retries < maxRetries) {
      try {
        await mongoose.connect(config.MONGODB_URI, mongooseOptions);
        
        // Set up connection event handlers
        this.setupConnectionHandlers();
        
        console.log(`✅ Database connected: ${mongoose.connection.db?.databaseName || 'unknown'}`);
        console.log(`📊 Connection pool: ${config.DB_POOL_SIZE} connections`);
        return;
      } catch (error) {
        retries++;
        console.warn(`Database connection attempt ${retries}/${maxRetries} failed: ${error.message}`);

        if (retries === maxRetries) {
          throw new Error(`❌ Failed to connect to database after ${maxRetries} attempts: ${error.message}`);
        }

        // Exponential backoff
        const delay = retryDelay * Math.pow(2, retries - 1);
        console.log(`⏳ Retrying database connection in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  static setupConnectionHandlers() {
    mongoose.connection.on('connected', () => {
      console.log('🔗 Database connected successfully');
    });

    mongoose.connection.on('error', (error) => {
      console.error('❌ Database connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('🔌 Database disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('🔄 Database reconnected');
    });

    // Handle process termination
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        console.log('🔐 Database connection closed through app termination');
      } catch (error) {
        console.error('❌ Error closing database connection:', error);
      }
    });
  }

  static async checkHealth() {
    try {
      if (mongoose.connection.readyState !== 1) {
        return { status: 'critical', message: 'Database disconnected' };
      }

      const startTime = Date.now();
      await mongoose.connection.db.admin().ping();
      const responseTime = Date.now() - startTime;

      return {
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        responseTime,
        connectionState: mongoose.connection.readyState,
        databaseName: mongoose.connection.db?.databaseName,
        host: mongoose.connection.host,
        readyState: this.getReadyStateString(mongoose.connection.readyState)
      };
    } catch (error) {
      return {
        status: 'critical',
        message: error.message,
        error: 'Database health check failed'
      };
    }
  }

  static getReadyStateString(state) {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    return states[state] || 'unknown';
  }
}

// Main QuickLocal Server Class
class QuickLocalServer {
  constructor() {
    this.config = new QuickLocalConfig().config;
    this.app = null;
    this.server = null;
    this.io = null;
    this.routeManager = new RouteManager();
    this.memoryMonitor = new MemoryMonitor();
    this.isShuttingDown = false;
    this.startTime = Date.now();
    
    // Set process title
    if (process.env.PROCESS_TITLE) {
      process.title = process.env.PROCESS_TITLE;
    }
  }

  async initialize() {
    try {
      console.log(`🚀 Starting ${this.config.APP_NAME} v${this.config.APP_VERSION}`);
      console.log(`🏗️ Environment: ${this.config.NODE_ENV}`);
      console.log(`🆔 Instance: ${this.config.INSTANCE_ID}`);
      
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
      this.startMonitoring();
      
      return { app: this.app, server: this.server, io: this.io };
    } catch (error) {
      console.error('❌ Server initialization failed:', error);
      process.exit(1);
    }
  }

  async preflightChecks() {
    // Create necessary directories
    const dirs = [
      this.config.LOG_DIR,
      './uploads',
      './temp',
      './backups',
      './cache'
    ];
    
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
        console.log(`📁 Ensured directory exists: ${dir}`);
      } catch (error) {
        console.warn(`⚠️ Could not create directory ${dir}:`, error.message);
      }
    }

    // Check available memory
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const freeMemMB = Math.round(freeMem / 1024 / 1024);
    const totalMemMB = Math.round(totalMem / 1024 / 1024);
    
    console.log(`💾 System Memory: ${freeMemMB}MB free / ${totalMemMB}MB total`);
    
    if (freeMem < 500 * 1024 * 1024) { // Less than 500MB free
      console.warn('⚠️ Low system memory detected. Consider optimizing or scaling.');
    }

    console.log('✅ Preflight checks completed');
  }

  async createApp() {
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Setup Socket.IO if enabled
    if (this.config.ENABLE_SOCKET_IO) {
      await this.setupSocketIO();
    }

    console.log('🏗️ Express application created');
  }

  async setupSocketIO() {
    try {
      const { Server } = require('socket.io');
      this.io = new Server(this.server, {
        cors: CORSManager.createCorsOptions(),
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: this.config.MAX_FILE_SIZE,
        allowEIO3: true,
        transports: ['websocket', 'polling'],
        serveClient: false // Don't serve socket.io client
      });
      
      // Initialize SocketService
      const SocketService = require('./services/socketService');
      this.socketService = new SocketService(this.io);
      
      // Initialize real-time services
      const RealtimeNotificationService = require('./services/realtimeNotificationService');
      const RealtimeOrderTrackingService = require('./services/realtimeOrderTrackingService');
      const RealtimeChatService = require('./services/realtimeChatService');
      
      this.notificationService = new RealtimeNotificationService(this.socketService);
      this.orderTrackingService = new RealtimeOrderTrackingService(this.socketService, this.notificationService);
      this.chatService = new RealtimeChatService(this.socketService);
      
      // Make services available globally
      global.socketService = this.socketService;
      global.notificationService = this.notificationService;
      global.orderTrackingService = this.orderTrackingService;
      global.chatService = this.chatService;
      
      console.log('✅ Socket.IO initialized with enhanced real-time features');
    } catch (error) {
      console.warn('⚠️ Socket.IO initialization failed:', error.message);
      this.config.ENABLE_SOCKET_IO = false;
    }
  }

  setupSocketHandlers() {
    // This method is now handled by SocketService
    // Keeping for backward compatibility
    if (!this.io) return;
    console.log('🔌 Socket handlers initialized via SocketService');
  }

  async setupMiddleware() {
    // Trust proxy configuration
    this.app.set('trust proxy', parseInt(process.env.TRUST_PROXY) || 1);
    this.app.disable('x-powered-by');

    // Request timeout with proper cleanup
    this.app.use((req, res, next) => {
      const timeout = setTimeout(() => {
        if (!res.headersSent) {
          res.status(408).json({
            error: 'Request timeout',
            message: `Request exceeded ${this.config.REQUEST_TIMEOUT}ms timeout`,
            correlationId: req.correlationId
          });
        }
      }, this.config.REQUEST_TIMEOUT);

      res.on('finish', () => clearTimeout(timeout));
      res.on('close', () => clearTimeout(timeout));
      
      next();
    });

    // Enhanced security headers
    if (this.config.HELMET_ENABLED) {
      this.app.use(helmet({
        contentSecurityPolicy: this.config.CSP_ENABLED ? {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
          },
        } : false,
        hsts: {
          maxAge: this.config.HSTS_MAX_AGE,
          includeSubDomains: this.config.HSTS_INCLUDE_SUBDOMAINS
        }
      }));
    }

    // Additional security headers
    this.app.use(SecurityManager.createSecurityHeaders());

    // Request validation
    this.app.use(SecurityManager.validateRequest());

    // Brute force protection
    const bruteForce = SecurityManager.createBruteForceProtection();
    this.app.use('/api/v1/auth/login', bruteForce.prevent);
    this.app.use('/api/v1/auth/forgot-password', bruteForce.prevent);

    // Rate limiting with different tiers
    if (this.config.RATE_LIMIT_ENABLED) {
      // General API rate limiting
      this.app.use('/api/', SecurityManager.createRateLimit(
        this.config.RATE_LIMIT_WINDOW,
        this.config.RATE_LIMIT_MAX,
        'Too many API requests from this IP'
      ));

      // Slow down for expensive operations
      this.app.use('/api/v1/search', SecurityManager.createSlowDown(
        15 * 60 * 1000, // 15 minutes
        50, // Start slowing after 50 requests
        1000 // 1 second delay
      ));
    }

    // CORS with enhanced configuration
    this.app.use(cors(CORSManager.createCorsOptions()));

    // Body parsing with enhanced security
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

    // Cookie parsing
    this.app.use(cookieParser(this.config.COOKIE_SECRET));

    // Compression with intelligent filtering
    if (this.config.COMPRESSION_ENABLED) {
      this.app.use(compression({
        filter: (req, res) => {
          // Don't compress if client specifically asks not to
          if (req.headers['x-no-compression']) return false;
          
          // Don't compress images, videos, or already compressed files
          const contentType = res.getHeader('Content-Type');
          if (contentType && (
            contentType.includes('image/') || 
            contentType.includes('video/') ||
            contentType.includes('audio/') ||
            contentType.includes('application/zip') ||
            contentType.includes('application/gzip')
          )) {
            return false;
          }
          
          return compression.filter(req, res);
        },
        threshold: 1024, // Only compress if larger than 1KB
        level: this.config.COMPRESSION_LEVEL,
        memLevel: 8
      }));
    }

    // Enhanced request logging
    if (this.config.ENABLE_REQUEST_LOGGING) {
      const morganFormat = this.config.IS_PRODUCTION ? 
        ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms' :
        ':method :url :status :response-time ms - :res[content-length]';

      this.app.use(morgan(morganFormat, {
        stream: { 
          write: (message) => {
            if (this.config.DEBUG_MODE || !this.config.IS_PRODUCTION) {
              console.log(`[REQUEST] ${message.trim()}`);
            }
          }
        },
        skip: (req) => {
          // Skip logging for health checks and static assets
          return req.method === 'OPTIONS' || 
                 req.url === '/health' ||
                 req.url === '/metrics' ||
                 req.url === '/favicon.ico' ||
                 req.url.startsWith('/static/');
        }
      }));
    }

    // Enhanced correlation ID and metrics
    this.app.use((req, res, next) => {
      const startTime = process.hrtime.bigint();
      req.correlationId = `${this.config.INSTANCE_ID}-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
      req.startTime = startTime;
      req.requestId = req.correlationId;
      
      // Set response headers
      res.setHeader('X-Correlation-ID', req.correlationId);
      res.setHeader('X-Instance-ID', this.config.INSTANCE_ID);
      res.setHeader('X-API-Version', this.config.API_VERSION);

      // Enhanced response time tracking
      const originalSend = res.send;
      res.send = function(data) {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to ms
        
        res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
        
        // Log slow requests with more detail
        if (duration > 2000) {
          console.warn(`🐌 Slow request [${req.correlationId}]: ${req.method} ${req.originalUrl} took ${duration.toFixed(2)}ms (User: ${req.user?.id || 'anonymous'})`);
        }

        // Emit metrics for monitoring
        process.emit('requestCompleted', {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          duration,
          correlationId: req.correlationId,
          userAgent: req.get('User-Agent'),
          ip: req.ip
        });

        return originalSend.call(this, data);
      };

      next();
    });

    // Add Socket.IO instance to requests if available
    if (this.io) {
      this.app.use((req, res, next) => {
        req.io = this.io;
        next();
      });
    }

    console.log('✅ Middleware setup completed');
  }

  async connectDatabase() {
    await DatabaseManager.connect(this.config);
  }

  async setupSession() {
    const sessionConfig = {
      secret: this.config.SESSION_SECRET,
      name: process.env.SESSION_COOKIE_NAME || 'quicklocal_session',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        mongoUrl: this.config.MONGODB_URI,
        touchAfter: 24 * 3600, // Lazy session update
        ttl: parseInt(process.env.SESSION_COOKIE_MAX_AGE) || 7 * 24 * 60 * 60, // 7 days in seconds
        collectionName: 'sessions',
        stringify: false,
        autoRemove: 'native'
      }),
      cookie: {
        secure: process.env.SESSION_COOKIE_SECURE === 'true',
        httpOnly: process.env.SESSION_COOKIE_HTTP_ONLY !== 'false',
        maxAge: parseInt(process.env.SESSION_COOKIE_MAX_AGE) || 7 * 24 * 60 * 60 * 1000, // 7 days in ms
        sameSite: process.env.SESSION_COOKIE_SAME_SITE || 'strict'
      },
      rolling: true, // Reset expiration on activity
      proxy: true // Trust proxy for secure cookies
    };

    this.app.use(session(sessionConfig));
    console.log('📝 Session management configured with MongoDB store');
  }

  async loadRoutes() {
    const result = await this.routeManager.loadRoutes(this.app);
    this.loadedRoutes = result.routes;
    return result;
  }

  setupEndpoints() {
    // Enhanced root endpoint
    this.app.get('/', (req, res) => {
      const uptime = Math.floor(process.uptime());
      const memUsage = process.memoryUsage();
      
      res.json({
        name: this.config.APP_NAME,
        version: this.config.APP_VERSION,
        status: 'operational',
        timestamp: new Date().toISOString(),
        environment: this.config.NODE_ENV,
        instanceId: this.config.INSTANCE_ID,
        apiVersion: this.config.API_VERSION,
        uptime: {
          seconds: uptime,
          human: this.formatUptime(uptime)
        },
        server: {
          nodeVersion: process.version,
          platform: process.platform,
          cpuCount: os.cpus().length,
          memory: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            rss: Math.round(memUsage.rss / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024)
          },
          loadAverage: os.loadavg().map(load => Math.round(load * 100) / 100)
        },
        features: {
          websockets: !!this.io,
          clustering: this.config.CLUSTER_MODE,
          compression: this.config.COMPRESSION_ENABLED,
          rateLimiting: this.config.RATE_LIMIT_ENABLED,
          helmet: this.config.HELMET_ENABLED,
          cors: true,
          sessions: true,
          bruteForceProtection: true
        },
        marketplace: {
          currency: process.env.CURRENCY || 'INR',
          minOrderAmount: process.env.MIN_ORDER_AMOUNT || 50,
          deliveryFee: process.env.BASE_DELIVERY_FEE || 25,
          freeDeliveryThreshold: process.env.FREE_DELIVERY_THRESHOLD || 500
        },
        endpoints: {
          health: '/health',
          status: '/status',
          metrics: '/metrics',
          docs: '/api/v1/docs'
        },
        routes: this.loadedRoutes ? this.loadedRoutes.length : 0
      });
    });

    // Comprehensive health check endpoint
    this.app.get('/health', async (req, res) => {
      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        environment: this.config.NODE_ENV,
        instanceId: this.config.INSTANCE_ID,
        version: this.config.APP_VERSION,
        checks: {
          database: await DatabaseManager.checkHealth(),
          memory: this.checkMemoryHealth(),
          system: this.checkSystemHealth(),
          routes: this.checkRoutesHealth(),
          features: this.checkFeaturesHealth()
        }
      };

      // Determine overall health status
      const failedChecks = Object.values(healthData.checks)
        .filter(check => check.status && check.status !== 'healthy');
      
      if (failedChecks.length > 0) {
        healthData.status = failedChecks.some(check => check.status === 'critical') ? 
          'unhealthy' : 'degraded';
      }

      const statusCode = healthData.status === 'healthy' ? 200 : 
                        healthData.status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json(healthData);
    });

    // Enhanced status endpoint
    this.app.get('/status', (req, res) => {
      const memUsage = process.memoryUsage();
      
      res.json({
        status: 'operational',
        timestamp: new Date().toISOString(),
        uptime: {
          process: Math.floor(process.uptime()),
          system: Math.floor(os.uptime())
        },
        memory: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memUsage.rss / 1024 / 1024),
          external: Math.round(memUsage.external / 1024 / 1024),
          usage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
        },
        system: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          cpuCount: os.cpus().length,
          loadAverage: os.loadavg(),
          freeMemory: Math.round(os.freemem() / 1024 / 1024),
          totalMemory: Math.round(os.totalmem() / 1024 / 1024)
        },
        server: {
          listening: this.server.listening,
          socketConnections: this.io ? this.io.engine.clientsCount : 0,
          environment: this.config.NODE_ENV,
          version: this.config.APP_VERSION,
          instanceId: this.config.INSTANCE_ID
        }
      });
    });

    // Metrics endpoint
    if (this.config.ENABLE_METRICS) {
      this.app.get('/metrics', (req, res) => {
        const memUsage = process.memoryUsage();
        const uptime = Math.floor(process.uptime());
        
        const metrics = [
          `# HELP process_uptime_seconds Process uptime in seconds`,
          `# TYPE process_uptime_seconds counter`,
          `process_uptime_seconds ${uptime}`,
          ``,
          `# HELP process_memory_heap_used_bytes Process heap memory used`,
          `# TYPE process_memory_heap_used_bytes gauge`,
          `process_memory_heap_used_bytes ${memUsage.heapUsed}`,
          ``,
          `# HELP process_memory_heap_total_bytes Process heap memory total`,
          `# TYPE process_memory_heap_total_bytes gauge`,
          `process_memory_heap_total_bytes ${memUsage.heapTotal}`,
          ``,
          `# HELP nodejs_version_info Node.js version`,
          `# TYPE nodejs_version_info gauge`,
          `nodejs_version_info{version="${process.version}"} 1`
        ];

        if (this.io) {
          metrics.push(
            ``,
            `# HELP socket_io_connections Active Socket.IO connections`,
            `# TYPE socket_io_connections gauge`,
            `socket_io_connections ${this.io.engine.clientsCount}`
          );
        }

        res.set('Content-Type', 'text/plain');
        res.send(metrics.join('\n'));
      });
    }

    // API documentation endpoint
    if (this.config.ENABLE_API_DOCS) {
      this.app.get('/api/v1/docs', (req, res) => {
        res.json({
          title: `${this.config.APP_NAME} API Documentation`,
          version: this.config.API_VERSION,
          description: 'Production-ready e-commerce marketplace API with real-time features',
          baseUrl: `${req.protocol}://${req.get('host')}${this.config.API_BASE_PATH}`,
          instanceId: this.config.INSTANCE_ID,
          environment: this.config.NODE_ENV,
          server: {
            uptime: Math.floor(process.uptime()),
            version: this.config.APP_VERSION,
            nodeVersion: process.version
          },
          authentication: {
            type: 'Bearer Token',
            header: 'Authorization: Bearer <token>',
            refreshEndpoint: '/api/v1/auth/refresh',
            expiresIn: this.config.JWT_ACCESS_EXPIRES
          },
          rateLimits: {
            general: `${this.config.RATE_LIMIT_MAX} requests per ${this.config.RATE_LIMIT_WINDOW / 60000} minutes`,
            authentication: `${this.config.AUTH_RATE_LIMIT_MAX} requests per 15 minutes`,
            orders: `${this.config.ORDER_RATE_LIMIT_MAX} requests per minute`,
            payments: '5 requests per 5 minutes'
          },
          features: {
            realTime: this.io ? 'WebSocket support for live updates' : 'Not available',
            compression: this.config.COMPRESSION_ENABLED,
            cors: 'Configurable origins',
            security: 'Helmet, rate limiting, brute force protection',
            sessions: 'MongoDB-backed sessions'
          },
          routes: this.loadedRoutes ? this.loadedRoutes.map(route => ({
            name: route.name,
            path: route.path,
            priority: route.priority,
            critical: route.critical,
            status: route.status
          })) : []
        });
      });
    }

    console.log('✅ System endpoints configured');
}

  checkMemoryHealth() {
    const memUsage = process.memoryUsage();
    const heapUsagePercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    
    return {
      status: heapUsagePercent > 90 ? 'critical' : 
              heapUsagePercent > 80 ? 'warning' : 'healthy',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      usage: heapUsagePercent,
      rss: Math.round(memUsage.rss / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    };
  }

  checkSystemHealth() {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const systemLoad = loadAvg[0] / cpuCount;
    const freeMemPercent = Math.round((os.freemem() / os.totalmem()) * 100);
    
    return {
      status: systemLoad > 2 || freeMemPercent < 10 ? 'critical' :
              systemLoad > 1 || freeMemPercent < 20 ? 'warning' : 'healthy',
      loadAverage: loadAvg.map(load => Math.round(load * 100) / 100),
      systemLoad: Math.round(systemLoad * 100) / 100,
      cpuCount,
      freeMemory: freeMemPercent,
      uptime: Math.floor(os.uptime())
    };
  }

  checkRoutesHealth() {
    const totalRoutes = this.loadedRoutes ? this.loadedRoutes.length : 0;
    const failedRoutes = this.routeManager ? this.routeManager.failedRoutes.length : 0;
    const criticalFailed = this.routeManager ? 
      this.routeManager.failedRoutes.filter(r => r.critical).length : 0;
    
    return {
      status: criticalFailed > 0 ? 'critical' : 
              failedRoutes > 0 ? 'warning' : 'healthy',
      loaded: totalRoutes,
      failed: failedRoutes,
      criticalFailed,
      healthyPercent: totalRoutes > 0 ? 
        Math.round(((totalRoutes - failedRoutes) / totalRoutes) * 100) : 100
    };
  }

  checkFeaturesHealth() {
    const features = {
      database: mongoose.connection.readyState === 1,
      websockets: !!this.io,
      clustering: this.config.CLUSTER_MODE,
      compression: this.config.COMPRESSION_ENABLED,
      rateLimiting: this.config.RATE_LIMIT_ENABLED,
      sessions: true // Always true if we reach this point
    };
    
    const healthyFeatures = Object.values(features).filter(Boolean).length;
    const totalFeatures = Object.keys(features).length;
    const healthPercent = Math.round((healthyFeatures / totalFeatures) * 100);
    
    return {
      status: healthPercent === 100 ? 'healthy' : 
              healthPercent >= 80 ? 'warning' : 'critical',
      features,
      healthy: healthyFeatures,
      total: totalFeatures,
      healthPercent
    };
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);
    
    return parts.join(' ');
  }

  setupErrorHandling() {
    // Enhanced 404 handler
    this.app.use('*', (req, res) => {
      console.warn(`🔍 404 Not Found: ${req.method} ${req.originalUrl} from ${req.ip}`);
      
      res.status(404).json({
        error: 'Not Found',
        message: `The requested endpoint ${req.method} ${req.originalUrl} was not found`,
        timestamp: new Date().toISOString(),
        correlationId: req.correlationId,
        availableEndpoints: {
          api: `${req.protocol}://${req.get('host')}/api/v1`,
          health: `${req.protocol}://${req.get('host')}/health`,
          status: `${req.protocol}://${req.get('host')}/status`,
          docs: `${req.protocol}://${req.get('host')}/api/v1/docs`
        }
      });
    });

    // Enhanced global error handler
    this.app.use((error, req, res, next) => {
      const correlationId = req.correlationId || 'unknown';
      const isProduction = this.config.IS_PRODUCTION;
      
      // Log the error with context
      console.error(`❌ Error [${correlationId}]:`, {
        message: error.message,
        stack: !isProduction ? error.stack : undefined,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id || 'anonymous'
      });

      // Handle specific error types
      let statusCode = 500;
      let message = 'Internal Server Error';
      let errorType = 'server_error';

      if (error.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation failed';
        errorType = 'validation_error';
      } else if (error.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid data format';
        errorType = 'cast_error';
      } else if (error.code === 11000) {
        statusCode = 409;
        message = 'Duplicate entry';
        errorType = 'duplicate_error';
      } else if (error.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Invalid authentication token';
        errorType = 'auth_error';
      } else if (error.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Authentication token expired';
        errorType = 'auth_expired';
      } else if (error.type === 'entity.too.large') {
        statusCode = 413;
        message = 'Request payload too large';
        errorType = 'payload_too_large';
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        statusCode = 503;
        message = 'Service unavailable';
        errorType = 'service_unavailable';
      } else if (error.status) {
        statusCode = error.status;
        message = error.message || 'Request failed';
        errorType = 'client_error';
      }

      // Emit error event for monitoring
      process.emit('applicationError', {
        error: error.message,
        stack: error.stack,
        correlationId,
        statusCode,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      const errorResponse = {
        error: message,
        type: errorType,
        timestamp: new Date().toISOString(),
        correlationId,
        path: req.originalUrl,
        method: req.method
      };

      // Include additional details in development
      if (!isProduction && this.config.DEBUG_MODE) {
        errorResponse.details = {
          message: error.message,
          stack: error.stack,
          name: error.name
        };
      }

      // Include validation details if available
      if (error.errors && typeof error.errors === 'object') {
        errorResponse.validationErrors = Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message || error.errors[key]
        }));
      }

      res.status(statusCode).json(errorResponse);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('🚨 UNCAUGHT EXCEPTION - Server will restart:', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        instanceId: this.config.INSTANCE_ID
      });

      // Give the server time to finish ongoing requests
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('🚨 UNHANDLED REJECTION:', {
        reason: reason.message || reason,
        stack: reason.stack,
        promise: promise.toString().slice(0, 200),
        timestamp: new Date().toISOString(),
        instanceId: this.config.INSTANCE_ID
      });

      // For production, we might want to restart the process
      if (this.config.IS_PRODUCTION) {
        setTimeout(() => {
          process.exit(1);
        }, 5000);
      }
    });

    // Handle warnings
    process.on('warning', (warning) => {
      if (warning.name !== 'DeprecationWarning' || this.config.DEBUG_MODE) {
        console.warn('⚠️ Node.js Warning:', {
          name: warning.name,
          message: warning.message,
          stack: !this.config.IS_PRODUCTION ? warning.stack : undefined
        });
      }
    });

    console.log('✅ Error handling configured');
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.PORT, this.config.HOST, (error) => {
        if (error) {
          console.error('❌ Failed to start server:', error);
          return reject(error);
        }

        const { address, port } = this.server.address();
        const host = address === '::' ? 'localhost' : address;
        
        console.log(`\n🚀 ${this.config.APP_NAME} v${this.config.APP_VERSION} is running!`);
        console.log(`🌍 Server: http://${host}:${port}`);
        console.log(`🏥 Health: http://${host}:${port}/health`);
        console.log(`📊 Status: http://${host}:${port}/status`);
        console.log(`📚 API Docs: http://${host}:${port}/api/v1/docs`);
        
        if (this.io) {
          console.log(`⚡ WebSocket: ws://${host}:${port} (Socket.IO)`);
        }
        
        console.log(`🔧 Environment: ${this.config.NODE_ENV}`);
        console.log(`🆔 Instance: ${this.config.INSTANCE_ID}`);
        console.log(`⏱️ Started: ${new Date().toISOString()}`);
        console.log(`\n✨ QuickLocal marketplace is ready for business!\n`);
        
        resolve({ app: this.app, server: this.server, io: this.io });
      });
    });
  }

  setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
      if (this.isShuttingDown) {
        console.log('⏳ Shutdown already in progress...');
        return;
      }

      this.isShuttingDown = true;
      console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
      
      const shutdownTimeout = setTimeout(() => {
        console.error('❌ Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, 30000); // 30 seconds timeout

      try {
        // Stop accepting new connections
        console.log('🔐 Closing server...');
        await new Promise((resolve) => {
          this.server.close(resolve);
        });

        // Close Socket.IO connections
        if (this.io) {
          console.log('⚡ Closing WebSocket connections...');
          this.io.close();
        }

        // Stop memory monitoring
        if (this.memoryMonitor) {
          console.log('🧠 Stopping memory monitor...');
          this.memoryMonitor.stop();
        }

        // Close database connection
        console.log('🗄️ Closing database connection...');
        await mongoose.connection.close();

        // Clear any remaining timers/intervals
        console.log('⏰ Clearing timers...');
        clearTimeout(shutdownTimeout);

        console.log(`✅ Graceful shutdown completed in ${((Date.now() - this.startTime) / 1000).toFixed(2)}s`);
        process.exit(0);

      } catch (error) {
        console.error('❌ Error during graceful shutdown:', error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    // Listen for termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

    // Handle PM2 graceful reload
    process.on('message', (msg) => {
      if (msg === 'shutdown') {
        gracefulShutdown('PM2_SHUTDOWN');
      }
    });

    console.log('✅ Graceful shutdown handlers configured');
  }

  startMonitoring() {
    // Start memory monitoring
    this.memoryMonitor.start();

    // Performance monitoring
    let requestCount = 0;
    let errorCount = 0;
    let totalResponseTime = 0;

    process.on('requestCompleted', (data) => {
      requestCount++;
      totalResponseTime += data.duration;
      
      if (data.statusCode >= 400) {
        errorCount++;
      }
    });

    // Periodic performance reporting
    setInterval(() => {
      if (requestCount > 0) {
        const avgResponseTime = totalResponseTime / requestCount;
        const errorRate = (errorCount / requestCount) * 100;
        
        console.log(`📊 Performance [Last 5min]: ${requestCount} requests, ${avgResponseTime.toFixed(2)}ms avg, ${errorRate.toFixed(2)}% errors`);
        
        // Reset counters
        requestCount = 0;
        errorCount = 0;
        totalResponseTime = 0;
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // System resource monitoring
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      const loadAvg = os.loadavg();
      
      console.log(`🖥️ Resources: Load=${loadAvg[0].toFixed(2)}, Heap=${Math.round(memUsage.heapUsed/1024/1024)}MB, CPU=${(cpuUsage.user/1000000).toFixed(2)}s`);
      
      // Alert on high resource usage
      if (memUsage.heapUsed > memUsage.heapTotal * 0.9) {
        console.warn('⚠️ High memory usage detected!');
      }
      
      if (loadAvg[0] > os.cpus().length * 2) {
        console.warn('⚠️ High system load detected!');
      }
    }, 2 * 60 * 1000); // Every 2 minutes

    // Database connection monitoring
    setInterval(async () => {
      const dbHealth = await DatabaseManager.checkHealth();
      if (dbHealth.status !== 'healthy') {
        console.warn(`⚠️ Database health: ${dbHealth.status} - ${dbHealth.message || 'Connection issues'}`);
      }
    }, 60 * 1000); // Every minute

    console.log('📊 System monitoring started');
  }
}

// Cluster Manager for Production Scaling
class ClusterManager {
  static init() {
    const config = new QuickLocalConfig().config;
    
    if (!config.CLUSTER_MODE) {
      console.log('🔧 Cluster mode disabled, starting single process...');
      return ClusterManager.startWorker();
    }

    if (cluster.isMaster || cluster.isPrimary) {
      console.log(`🏭 Starting ${config.APP_NAME} cluster with ${config.MAX_WORKERS} workers`);
      return ClusterManager.startMaster(config);
    } else {
      return ClusterManager.startWorker();
    }
  }

  static startMaster(config) {
    console.log(`👑 Master process ${process.pid} starting...`);
    
    const workers = new Map();
    let restartCount = 0;
    const maxRestarts = parseInt(process.env.CLUSTER_MAX_RESTARTS) || 5;
    const restartWindow = parseInt(process.env.CLUSTER_RESTART_WINDOW) || 60000; // 1 minute
    
    // Track restart times for rate limiting
    const restartTimes = [];

    // Start workers
    for (let i = 0; i < config.MAX_WORKERS; i++) {
      ClusterManager.createWorker(workers, i);
    }

    // Handle worker exit
    cluster.on('exit', (worker, code, signal) => {
      const now = Date.now();
      const workerInfo = workers.get(worker.id);
      
      console.warn(`⚰️ Worker ${worker.id} (PID: ${worker.process.pid}) died (${signal || code})`);
      
      workers.delete(worker.id);
      restartTimes.push(now);
      
      // Remove old restart times outside the window
      const windowStart = now - restartWindow;
      const recentRestarts = restartTimes.filter(time => time > windowStart);
      
      if (recentRestarts.length > maxRestarts) {
        console.error(`🚨 Too many worker restarts (${recentRestarts.length}/${maxRestarts} in ${restartWindow/1000}s). Shutting down cluster.`);
        process.exit(1);
      }

      // Create new worker
      console.log('🔄 Restarting worker...');
      ClusterManager.createWorker(workers, worker.id);
    });

    // Handle worker disconnect
    cluster.on('disconnect', (worker) => {
      console.warn(`🔌 Worker ${worker.id} disconnected`);
    });

    // Handle worker online
    cluster.on('online', (worker) => {
      console.log(`✅ Worker ${worker.id} (PID: ${worker.process.pid}) is online`);
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log('🛑 Master process shutting down...');
      
      const shutdownTimeout = setTimeout(() => {
        console.error('❌ Workers failed to exit gracefully, forcing shutdown');
        process.exit(1);
      }, 30000);

      workers.forEach((info, workerId) => {
        cluster.workers[workerId]?.kill('SIGTERM');
      });

      cluster.on('exit', () => {
        if (Object.keys(cluster.workers).length === 0) {
          clearTimeout(shutdownTimeout);
          console.log('✅ All workers exited. Master shutting down.');
          process.exit(0);
        }
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('SIGQUIT', shutdown);

    // Master process health monitoring
    setInterval(() => {
      const activeWorkers = Object.keys(cluster.workers).length;
      const memUsage = process.memoryUsage();
      
      console.log(`👑 Master Status: ${activeWorkers}/${config.MAX_WORKERS} workers, Heap: ${Math.round(memUsage.heapUsed/1024/1024)}MB`);
      
      // Restart dead workers
      for (let i = 1; i <= config.MAX_WORKERS; i++) {
        if (!cluster.workers[i]) {
          console.log(`🔄 Restarting missing worker ${i}`);
          ClusterManager.createWorker(workers, i);
        }
      }
    }, 30000); // Every 30 seconds

    return Promise.resolve();
  }

  static createWorker(workers, id) {
    const worker = cluster.fork({
      WORKER_ID: id,
      WORKER_START_TIME: Date.now()
    });
    
    workers.set(worker.id, {
      id: worker.id,
      startTime: Date.now(),
      restarts: 0
    });
    
    return worker;
  }

  static async startWorker() {
    try {
      const workerId = process.env.WORKER_ID || 'single';
      console.log(`👷 Worker ${workerId} (PID: ${process.pid}) starting...`);
      
      const server = new QuickLocalServer();
      await server.initialize();
      
      console.log(`✅ Worker ${workerId} ready`);
      return server;
    } catch (error) {
      console.error(`❌ Worker failed to start:`, error);
      process.exit(1);
    }
  }
}

// Application Entry Point
async function main() {
  try {
    console.log(`🌟 QuickLocal E-commerce Platform - Starting...`);
    console.log(`📅 ${new Date().toISOString()}`);
    console.log(`🏗️ Node.js ${process.version} on ${process.platform} ${process.arch}`);
    console.log(`💾 Memory: ${Math.round(os.totalmem() / 1024 / 1024)}MB total, ${Math.round(os.freemem() / 1024 / 1024)}MB free`);
    console.log(`🧮 CPUs: ${os.cpus().length} cores, Load: ${os.loadavg().map(l => l.toFixed(2)).join(', ')}`);
    console.log('─'.repeat(80));

    await ClusterManager.init();
    
  } catch (error) {
    console.error('💥 Failed to start QuickLocal server:', error);
    
    // Enhanced error reporting
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${process.env.PORT || 10000} is already in use`);
      console.error('💡 Try setting a different PORT environment variable');
    } else if (error.code === 'EACCES') {
      console.error(`❌ Permission denied on port ${process.env.PORT || 10000}`);
      console.error('💡 Try using a port number above 1024 or run with sudo');
    } else if (error.message.includes('MONGODB_URI')) {
      console.error('❌ Database connection failed');
      console.error('💡 Check your MONGODB_URI environment variable');
    }
    
    process.exit(1);
  }
}

// Export for testing and external use
module.exports = {
  QuickLocalServer,
  ClusterManager,
  DatabaseManager,
  SecurityManager,
  CORSManager,
  MemoryMonitor,
  RouteManager,
  QuickLocalConfig
};

// Start the application if this file is run directly
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Unhandled startup error:', error);
    process.exit(1);
  });
}