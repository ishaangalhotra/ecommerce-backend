// Enhanced Memory Monitor with improved error handling and singleton pattern
class MemoryMonitor {
  constructor() {
    this.checkInterval = null;
    this.isRunning = false;
    this.metrics = {
      samples: [],
      maxSamples: 60, // Keep last 60 samples (2 hours at 2-min intervals)
      highUsageCount: 0,
      criticalUsageCount: 0
    };
  }

  start() {
    // Prevent multiple instances
    if (this.isRunning) {
      console.log('🧠 Memory monitoring is already running.');
      return false;
    }

    try {
      console.log('🧠 Starting enhanced memory monitoring...');
      this.isRunning = true;
      
      // Initial memory check
      this.checkMemory();
      
      // Set up interval
      this.checkInterval = setInterval(() => {
        this.checkMemory();
      }, 2 * 60 * 1000); // Every 2 minutes

      return true;
    } catch (error) {
      console.error('❌ Failed to start memory monitoring:', error);
      this.isRunning = false;
      return false;
    }
  }

  checkMemory() {
    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      const usage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
      const timestamp = new Date().toISOString();

      // Store sample for trend analysis
      this.storeSample({
        timestamp,
        heapUsed: heapUsedMB,
        heapTotal: heapTotalMB,
        usage,
        rss: Math.round(memUsage.rss / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      });

      // Use structured logging instead of console.log
      const logger = require('./utils/logger');
      
      logger.info('Memory usage', {
        memory: {
          heapUsedMB,
          heapTotalMB,
          usagePercent: usage,
          rssMB: Math.round(memUsage.rss / 1024 / 1024),
          externalMB: Math.round(memUsage.external / 1024 / 1024)
        },
        timestamp
      });
      
      // Enhanced alerting with trend analysis
      if (usage > 80) {
        this.metrics.highUsageCount++;
        const trend = this.getUsageTrend();
        
        logger.warn('High memory usage detected', {
          memory: {
            usagePercent: usage,
            heapUsedMB,
            heapTotalMB,
            trend: {
              direction: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable',
              changePercent: parseFloat(trend.toFixed(1))
            },
            highUsageCount: this.metrics.highUsageCount
          },
          breakdown: this.getMemoryBreakdown(memUsage),
          suggestion: trend > 5 ? 'investigate_memory_leaks' : 'monitor_closely'
        });
      }
      
      // Critical memory warning
      if (usage > 95) {
        this.metrics.criticalUsageCount++;
        
        logger.error('Critical memory usage - server may crash', {
          memory: {
            usagePercent: usage,
            criticalUsageCount: this.metrics.criticalUsageCount,
            recentHistory: this.getRecentMemoryHistory()
          },
          action: this.metrics.criticalUsageCount >= 3 ? 'restart_required' : 'monitor_critical'
        });
      }

      // Reset counters on healthy usage
      if (usage < 70) {
        this.metrics.highUsageCount = Math.max(0, this.metrics.highUsageCount - 1);
        this.metrics.criticalUsageCount = Math.max(0, this.metrics.criticalUsageCount - 1);
      }

    } catch (error) {
      console.error('❌ Error during memory check:', error);
    }
  }

  storeSample(sample) {
    this.metrics.samples.push(sample);
    
    // Keep only the most recent samples
    if (this.metrics.samples.length > this.metrics.maxSamples) {
      this.metrics.samples.shift();
    }
  }

  getUsageTrend() {
    if (this.metrics.samples.length < 5) {
      return 0; // Not enough data
    }

    const recent = this.metrics.samples.slice(-5); // Last 5 samples
    const older = this.metrics.samples.slice(-10, -5); // Previous 5 samples
    
    if (older.length === 0) return 0;

    const recentAvg = recent.reduce((sum, s) => sum + s.usage, 0) / recent.length;
    const olderAvg = older.reduce((sum, s) => sum + s.usage, 0) / older.length;
    
    return recentAvg - olderAvg;
  }

  getMemoryBreakdown(memUsage) {
    return {
      absolute: {
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        externalMB: Math.round(memUsage.external / 1024 / 1024),
        arrayBuffersMB: Math.round((memUsage.arrayBuffers || 0) / 1024 / 1024)
      },
      percentages: {
        heapUsedPercent: Math.round((memUsage.heapUsed / memUsage.rss) * 100),
        externalPercent: Math.round((memUsage.external / memUsage.rss) * 100),
        otherPercent: Math.round(((memUsage.rss - memUsage.heapUsed - memUsage.external) / memUsage.rss) * 100)
      }
    };
  }

  getRecentMemoryHistory() {
    if (this.metrics.samples.length < 5) return [];
    
    return this.metrics.samples.slice(-10).map(sample => ({
      timestamp: sample.timestamp,
      usagePercent: sample.usage,
      heapUsedMB: sample.heapUsed,
      heapTotalMB: sample.heapTotal,
      severity: sample.usage > 95 ? 'critical' : sample.usage > 80 ? 'warning' : 'normal'
    }));
  }

  getStats() {
    if (this.metrics.samples.length === 0) {
      return { error: 'No samples collected yet' };
    }

    const samples = this.metrics.samples;
    const usages = samples.map(s => s.usage);
    const heapSizes = samples.map(s => s.heapUsed);

    return {
      sampleCount: samples.length,
      currentUsage: usages[usages.length - 1],
      averageUsage: Math.round(usages.reduce((a, b) => a + b, 0) / usages.length),
      maxUsage: Math.max(...usages),
      minUsage: Math.min(...usages),
      currentHeap: heapSizes[heapSizes.length - 1],
      averageHeap: Math.round(heapSizes.reduce((a, b) => a + b, 0) / heapSizes.length),
      maxHeap: Math.max(...heapSizes),
      trend: this.getUsageTrend(),
      alerts: {
        highUsageCount: this.metrics.highUsageCount,
        criticalUsageCount: this.metrics.criticalUsageCount
      },
      isHealthy: usages[usages.length - 1] < 80 && this.metrics.criticalUsageCount === 0
    };
  }

  stop() {
    if (!this.isRunning) {
      console.log('🧠 Memory monitoring is not running.');
      return false;
    }

    try {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
      
      this.isRunning = false;
      
      // Log final stats
      const stats = this.getStats();
      console.log('🧠 Memory monitoring stopped. Final stats:', {
        averageUsage: stats.averageUsage + '%',
        maxUsage: stats.maxUsage + '%',
        totalAlerts: stats.alerts.highUsageCount + stats.alerts.criticalUsageCount,
        samplesCollected: stats.sampleCount
      });
      
      return true;
    } catch (error) {
      console.error('❌ Error stopping memory monitoring:', error);
      return false;
    }
  }

  restart() {
    console.log('🔄 Restarting memory monitoring...');
    this.stop();
    return this.start();
  }

  // Graceful cleanup
  cleanup() {
    this.stop();
    this.metrics.samples = [];
    this.metrics.highUsageCount = 0;
    this.metrics.criticalUsageCount = 0;
  }
}

// Export singleton instance
const memoryMonitor = new MemoryMonitor();

// Handle memory warnings from Node.js
process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning' || 
      warning.name === 'DeprecationWarning' ||
      warning.message?.includes('memory')) {
    console.warn('⚠️ Node.js memory-related warning:', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack
    });
  }
});

// Start memory monitoring
memoryMonitor.start();

// Enhanced process exit handlers
const gracefulShutdownHandler = (signal) => {
  console.log(`🛑 ${signal} received, cleaning up memory monitoring...`);
  memoryMonitor.cleanup();
  // The server's own graceful shutdown will handle process.exit
};

// These handlers are specifically for the memory monitor cleanup.
// The main server's graceful shutdown will handle closing connections and exiting.
process.on('SIGTERM', () => gracefulShutdownHandler('SIGTERM'));
process.on('SIGINT', () => gracefulShutdownHandler('SIGINT'));

// server.js - QuickLocal Production-Ready Server with Complete Integration
// Version: 2.0.0 - Integrated with Environment Configuration
require('dotenv').config(); // Load .env variables

// Ensure NODE_ENV has a fallback:
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

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

// Advanced feature imports
let dbOptimizer, memoryCacheMiddleware, RealtimeInventorySystem, monitoringRoutes;
try {
  const dbOptimization = require('./database-optimization');
  dbOptimizer = dbOptimization.dbOptimizer;
  memoryCacheMiddleware = dbOptimization.memoryCacheMiddleware;
} catch (error) {
  console.warn('⚠️ Database optimization module not found, skipping...');
}

try {
  const inventorySystem = require('./realtime-inventory-system');
  RealtimeInventorySystem = inventorySystem.RealtimeInventorySystem;
} catch (error) {
  console.warn('⚠️ Real-time inventory system not found, skipping...');
}

try {
  const monitoring = require('./performance-monitoring-system');
  monitoringRoutes = monitoring.monitoringRoutes;
} catch (error) {
  console.warn('⚠️ Performance monitoring system not found, skipping...');
}

let advancedSearchSystem, createSearchRoutes;
try {
  const searchSystem = require('./advanced-search-system');
  advancedSearchSystem = searchSystem.advancedSearchSystem;
  createSearchRoutes = searchSystem.createSearchRoutes;
} catch (error) {
  console.warn('⚠️ Advanced search system not found, skipping...');
}

let cdnImageOptimization, createImageRoutes, createImageMiddleware;
try {
  const imageSystem = require('./cdn-image-optimization');
  cdnImageOptimization = imageSystem.cdnImageOptimization;
  createImageRoutes = imageSystem.createImageRoutes;
  createImageMiddleware = imageSystem.createImageMiddleware;
} catch (error) {
  console.warn('⚠️ CDN image optimization system not found, skipping...');
}

let smsGatewaySystem, createSMSRoutes, createSMSMiddleware;
try {
  const smsSystem = require('./sms-gateway-system');
  smsGatewaySystem = smsSystem.smsGatewaySystem;
  createSMSRoutes = smsSystem.createSMSRoutes;
  createSMSMiddleware = smsSystem.createSMSMiddleware;
} catch (error) {
  console.warn('⚠️ SMS gateway system not found, skipping...');
}

let twoFactorSystem, create2FARoutes, create2FAMiddleware;
try {
  const twoFASystem = require('./two-factor-authentication');
  twoFactorSystem = twoFASystem.twoFactorSystem;
  create2FARoutes = twoFASystem.create2FARoutes;
  create2FAMiddleware = twoFASystem.create2FAMiddleware;
  
  // Inject SMS system into 2FA system with robust error handling
  if (smsGatewaySystem && twoFactorSystem && typeof twoFactorSystem.setSMSSystem === 'function') {
    try {
      twoFactorSystem.setSMSSystem(smsGatewaySystem);
      console.log('✅ SMS system successfully injected into 2FA system');
    } catch (error) {
      console.warn('⚠️ Failed to inject SMS system into 2FA:', error.message);
    }
  } else {
    if (!twoFactorSystem) {
      console.warn('⚠️ 2FA system not available for SMS injection');
    } else if (!smsGatewaySystem) {
      console.warn('⚠️ SMS gateway system not available for 2FA injection');
    } else {
      console.warn('⚠️ 2FA system does not support SMS injection (missing setSMSSystem method)');
    }
  }
} catch (error) {
  console.warn('⚠️ Two-Factor Authentication system not found, skipping...');
}

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
      
      // Features (optimized for API-only deployment)
      ENABLE_SOCKET_IO: process.env.FEATURE_LIVE_TRACKING === 'true' || process.env.FEATURE_CHAT === 'true',
      ENABLE_METRICS: process.env.ENABLE_ERROR_TRACKING === 'true',
      ENABLE_CACHING: process.env.ENABLE_RESPONSE_CACHING === 'true',
      CACHE_TTL: this.getEnvNumber('CACHE_TTL', 3600),
      
      // API-only optimizations
      API_ONLY_MODE: process.env.API_ONLY_MODE === 'true' || process.env.NODE_ENV === 'production',
      DISABLE_STATIC_SERVING: process.env.DISABLE_STATIC_SERVING === 'true' || process.env.API_ONLY_MODE === 'true',
      
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
    // Skip validation if ValidationMiddleware doesn't exist
    try {
      ValidationMiddleware.validateEnvironment();
    } catch (error) {
      console.warn('⚠️ ValidationMiddleware not found, skipping validation');
    }
    
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
        console.warn(`⚠️ ${varName} should start with http:// or https://`);
      }
    });

    console.log('✅ QuickLocal environment validation passed');
  }
}

// ==================================================================
// == START: ENHANCED CORS MANAGER WITH DEBUGGING
// ==================================================================
// Enhanced CORS Manager with detailed logging for easier debugging
class CORSManager {
  static getOrigins() {
    const origins = [
      // Primary domains
      'https://www.quicklocal.shop',
      'https://quicklocal.shop',
    ];
    
    // Add from FRONTEND_URLS
    if (process.env.FRONTEND_URLS) {
      const frontendUrls = process.env.FRONTEND_URLS.split(',').map(url => url.trim());
      console.log(`[CORS] Adding FRONTEND_URLS: ${JSON.stringify(frontendUrls)}`);
      origins.push(...frontendUrls);
    }
    
    // Add from ALLOWED_ORIGINS
    if (process.env.ALLOWED_ORIGINS) {
      const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(url => url.trim());
      console.log(`[CORS] Adding ALLOWED_ORIGINS: ${JSON.stringify(allowedOrigins)}`);
      origins.push(...allowedOrigins);
    }
    
    // Add from CORS_ORIGINS
    if (process.env.CORS_ORIGINS) {
      const corsOrigins = process.env.CORS_ORIGINS.split(',').map(url => url.trim());
      console.log(`[CORS] Adding CORS_ORIGINS: ${JSON.stringify(corsOrigins)}`);
      origins.push(...corsOrigins);
    }
    
    // Add individual URLs
    [process.env.CLIENT_URL, process.env.ADMIN_URL, process.env.API_URL, process.env.FRONTEND_URL].forEach(url => {
      if (url) {
        console.log(`[CORS] Adding individual URL: ${url.trim()}`);
        origins.push(url.trim());
      }
    });
    
    // Development origins
    if (process.env.NODE_ENV !== 'production') {
      const devOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5500'
      ];
      console.log(`[CORS] Adding development origins: ${JSON.stringify(devOrigins)}`);
      origins.push(...devOrigins);
    }
    
    // Return a unique, filtered list of origins
    const finalOrigins = [...new Set(origins)].filter(Boolean);
    console.log(`[CORS] Final allowed origins: ${JSON.stringify(finalOrigins)}`);
    return finalOrigins;
  }

  static isValidOrigin(origin) {
    // Allow requests with no origin, like mobile apps, server-to-server, and tools (Postman, curl)
    if (!origin) {
      console.log(`[CORS] ✅ Allowed request with no origin (e.g., Postman, server-to-server)`);
      return true;
    }
    
    // Manual override for your production domains
    const productionDomains = [
      'https://www.quicklocal.shop',
      'https://quicklocal.shop'
    ];
    
    if (productionDomains.includes(origin)) {
      console.log(`[CORS] ✅ Allowed origin (production override): ${origin}`);
      return true;
    }
    
    const allowedOrigins = CORSManager.getOrigins();

    // Check if the exact origin is in the dynamically generated list
    if (allowedOrigins.includes(origin)) {
      console.log(`[CORS] ✅ Allowed origin (exact match): ${origin}`);
      return true;
    }
    
    // Check deployment platform patterns for preview/staging environments (e.g., Vercel, Render)
    const platformPatterns = [
      /^https:\/\/.*\.vercel\.app$/,
      /^https:\/\/.*\.netlify\.app$/,
      /^https:\/\/.*\.herokuapp\.com$/,
      /^https:\/\/.*\.railway\.app$/,
      /^https:\/\/.*\.onrender\.com$/
    ];
    
    if (platformPatterns.some(pattern => pattern.test(origin))) {
      console.log(`[CORS] ✅ Allowed origin (platform pattern match): ${origin}`);
      return true;
    }

    // If we reach here, the origin is not allowed
    console.warn(`[CORS] ❌ Denied origin: ${origin}`);
    return false;
  }
}
// ==================================================================
// == END: ENHANCED CORS MANAGER
// ==================================================================


// Enhanced Security Manager
class EnhancedSecurityManager {
  static createBruteForceProtection() {
    if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
      console.warn('⚠️ Brute force protection disabled: MongoDB not configured');
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
          console.warn(`🛑 Brute force protection triggered for ${req.ip}`);
          
          res.status(429).json({
            error: 'Too many failed attempts',
            message: 'Account temporarily locked due to multiple failed login attempts',
            nextValidRequestDate,
            retryAfter: Math.ceil((nextValidRequestDate.getTime() - Date.now()) / 1000)
          });
        }
      });
    } catch (error) {
      console.error('❌ Failed to initialize brute force protection:', error);
      return (req, res, next) => next();
    }
  }

  static createRateLimit(windowMs, max, message = 'Too many requests from this IP') {
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
          type: 'rate_limit_exceeded'
        });
      }
    });
  }

  static createSlowDown(windowMs, delayAfter, delayMs = 500) {
    return slowDown({
      windowMs,
      delayAfter,
      delayMs: () => delayMs,
      maxDelayMs: 20000,
      skipFailedRequests: false,
      skipSuccessfulRequests: true,
      validate: {
        delayMs: false // Disable delayMs validation warnings
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
    console.log('🔄 Loading QuickLocal API routes...');
    
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
    try {
      // Clear cache in development
      if (process.env.NODE_ENV === 'development') {
        try {
          const resolvedPath = require.resolve(module);
          delete require.cache[resolvedPath];
        } catch (e) {
          // Module doesn't exist yet, which is fine
        }
      }

      // Try to load the module with detailed error handling
      let routeModule;
      try {
        console.log(`🗒️ Loading route module: ${module}`);
        routeModule = require(module);
        console.log(`✅ Successfully loaded: ${module}`);
      } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
          // Try alternative paths
          const altPaths = [
            module.replace('./', './routes/'),
            `./routes/${module.split('/').pop()}`,
            `${__dirname}/routes/${module.split('/').pop()}`
          ];
          
          let loaded = false;
          for (const altPath of altPaths) {
            try {
              console.log(`🔄 Trying alternative path: ${altPath}`);
              routeModule = require(altPath);
              console.log(`✅ Successfully loaded from: ${altPath}`);
              loaded = true;
              break;
            } catch (altError) {
              // Continue to next alternative
            }
          }
          
          if (!loaded) {
            console.warn(`⚠️ Route module not found: ${module} - Skipping`);
            this.failedRoutes.push({ path, name, error: 'Module not found' });
            return; // Skip missing modules instead of failing
          }
        } else {
          console.error(`❌ Error loading ${module}:`, error.message);
          this.failedRoutes.push({ path, name, error: error.message });
          return;
        }
      }
      
      if (!this.isValidRouter(routeModule)) {
        const error = `Invalid router export in ${module}`;
        console.error(`❌ ${error}`);
        this.failedRoutes.push({ path, name, error });
        return;
      }

      // Add API version middleware
      app.use(path, this.createAPIVersionMiddleware());
      
      // Add route-specific rate limiting
      try {
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
      } catch (rateLimitError) {
        console.warn(`⚠️ Rate limiting setup failed for ${path}:`, rateLimitError.message);
      }

      app.use(path, routeModule);
      
      this.loadedRoutes.push({ path, name, priority, status: 'loaded' });
      console.log(`✅ ${name}: ${path} (Priority: ${priority})`);

      // Log endpoints in development
      if (process.env.DEBUG_MODE === 'true') {
        this.logRouteEndpoints(routeModule, path, name);
      }
      
    } catch (error) {
      console.error(`❌ Failed to load route ${name} (${path}):`, error.message);
      this.failedRoutes.push({ path, name, error: error.message });
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
        console.log(`📍 ${name} endpoints:`, endpoints);
      }
    }
  }

  handleRouteError(route, error) {
    this.failedRoutes.push({ 
      path: route.path, 
      name: route.name, 
      error: error.message 
    });
    console.error(`❌ Failed to load ${route.name} (${route.path}): ${error.message}`);
    
    if (process.env.DEBUG_MODE === 'true') {
      console.error(error.stack);
    }
  }

  logRouteSummary() {
    const { length: loaded } = this.loadedRoutes;
    const { length: failed } = this.failedRoutes;
    
    console.log(`📊 Route loading complete: ${loaded} loaded, ${failed} failed`);
    
    if (failed > 0) {
      console.error(`⚠️ Failed routes:`, this.failedRoutes);
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
    this.isShuttingDown = false;
    
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
      './backups'
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    });

    console.log('✅ Preflight checks completed');
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
      console.log('✅ Socket.IO initialized for real-time features');
    } catch (error) {
      console.warn('⚠️ Socket.IO initialization failed:', error.message);
      this.config.ENABLE_SOCKET_IO = false;
    }
  }

  setupSocketHandlers() {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      console.log(`🔌 Socket connected: ${socket.id}`);
      
      // Join user-specific room for notifications
      socket.on('join_user_room', (userId) => {
        if (userId) {
          socket.join(`user_${userId}`);
          console.log(`👤 Socket ${socket.id} joined user room: ${userId}`);
        }
      });

      // Join order-specific room for delivery tracking
      socket.on('track_order', (orderId) => {
        if (orderId) {
          socket.join(`order_${orderId}`);
          console.log(`📦 Socket ${socket.id} tracking order: ${orderId}`);
        }
      });

      socket.on('disconnect', (reason) => {
        console.log(`🔌 Socket disconnected: ${socket.id}, reason: ${reason}`);
      });

      socket.on('error', (error) => {
        console.error(`🔌 Socket error: ${socket.id}`, error);
      });
    });

    // Broadcast system events
    this.io.on('connection_error', (err) => {
      console.error('🔌 Socket.IO connection error:', err);
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
      try {
        applySecurity(this.app);
      } catch (error) {
        console.warn('⚠️ Security middleware not found, using basic security');
        this.app.use(helmet());
      }
    }

    // CORS is handled by the cors library below - no manual handling needed

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

    // ==================================================================
    // == START: ROBUST CORS CONFIGURATION WITH DEBUGGING
    // ==================================================================
    const corsOptions = {
      /**
       * The origin function determines which origins are allowed to access the server.
       * @param {string} origin - The origin of the incoming request.
       * @param {function} callback - The callback to signal whether the origin is allowed.
       */
      origin: function (origin, callback) {
        console.log(`[CORS] Checking origin: ${origin}`);
        
        // The `origin` will be `undefined` for server-to-server requests, REST clients (like Postman), or mobile apps.
        // The `CORSManager.isValidOrigin` function is designed to allow these by default.
        if (CORSManager.isValidOrigin(origin)) {
          console.log(`[CORS] ✅ Origin allowed: ${origin}`);
          // If the origin is valid, allow it.
          // The first argument is for an error (null here), and the second is a boolean (true = allowed).
          callback(null, true);
        } else {
          console.log(`[CORS] ❌ Origin denied: ${origin}`);
          console.log(`[CORS] Allowed origins: ${JSON.stringify(CORSManager.getOrigins())}`);
          // If the origin is not in our list, reject the request.
          // IMPORTANT: We pass `false` instead of an error object. The `cors` library will then
          // handle the rejection correctly, sending the appropriate headers and HTTP status.
          // Passing an error here (e.g., new Error('...')) would result in a 500 server error.
          callback(null, false);
        }
      },
      // Allows the browser to send cookies and authorization headers with the request.
      credentials: true,
      // Specifies the HTTP methods that are allowed.
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      // Specifies the headers that are allowed in a request.
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-Api-Key',
        'X-Correlation-ID'
      ],
      // Expose headers that the frontend can access
      exposedHeaders: [
        'X-Correlation-ID',
        'X-Response-Time',
        'X-Instance-ID'
      ],
      // Some legacy browsers (IE11, various SmartTVs) choke on 204.
      optionsSuccessStatus: 200 
    };
    
    this.app.use(cors(corsOptions));
    
    // Explicitly handle preflight requests for all routes.
    // This ensures that OPTIONS requests get a successful response quickly,
    // which is crucial for complex requests (e.g., with custom headers or methods like PUT/DELETE).
    this.app.options('*', cors(corsOptions));
    
    // cors library handles all preflight requests automatically
    // ==================================================================
    // == END: ROBUST CORS CONFIGURATION
    // ==================================================================
    
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
          stream: { 
            write: (message) => {
              console.log(`[REQUEST] ${message.trim()}`);
            }
          },
          skip: (req) => {
            return process.env.NODE_ENV === 'production' && (
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

      // Override res.send to capture response time
      const originalSend = res.send;
      res.send = function(data) {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000;
        
        res.setHeader('X-Response-Time', `${duration.toFixed(2)}ms`);
        
        // Log slow requests
        if (duration > 2000) { // 2 seconds
          console.warn(`🐌 Slow request [${req.correlationId}]: ${req.method} ${req.originalUrl} took ${duration.toFixed(2)}ms`);
        }

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

    // Advanced caching middleware (if available and not in API-only mode)
    if (memoryCacheMiddleware && !this.config.API_ONLY_MODE) {
      try {
        console.log('📋 Adding memory cache middleware...');
        this.app.use('/api/v1/products', memoryCacheMiddleware.productCache());
        this.app.use('/api/v1/search', memoryCacheMiddleware.searchCache());
        console.log('✅ Memory cache middleware enabled');
      } catch (error) {
        console.warn('⚠️ Memory cache middleware setup failed:', error.message);
      }
    } else if (this.config.API_ONLY_MODE) {
      console.log('💳 API-only mode: Skipping memory cache middleware to reduce memory usage');
    }

    // Security and validation middleware
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
        
        console.log(`✅ Database connected: ${this.config.DB_NAME}`);
        
        // Initialize database optimizations if available
        if (dbOptimizer) {
          try {
            console.log('🔧 Initializing database optimizations...');
            await dbOptimizer.createOptimizedIndexes();
            console.log('✅ Database optimizations initialized');
          } catch (error) {
            console.warn('⚠️ Database optimization initialization failed:', error.message);
          }
        }
        
        // Initialize advanced search system if available
        if (advancedSearchSystem) {
          try {
            console.log('🔍 Initializing advanced search system...');
            await advancedSearchSystem.initialize();
            console.log('✅ Advanced search system initialized');
          } catch (error) {
            console.warn('⚠️ Advanced search system initialization failed:', error.message);
          }
        }
        
        return;
      } catch (error) {
        retries++;
        console.warn(`Database connection attempt ${retries}/${maxRetries} failed: ${error.message}`);
        
        if (retries === maxRetries) {
          throw new Error(`❌ Failed to connect to database after ${maxRetries} attempts`);
        }
        
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, retries - 1)));
      }
    }
  }

  async setupSession() {
    if (!this.config.REDIS_ENABLED) {
      console.log('📝 Using MongoDB session store');
      
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
      console.log('📝 Redis session store disabled - using MongoDB');
    }
  }

  async loadRoutes() {
    const result = await this.routeManager.loadRoutes(this.app);
    this.loadedRoutes = result.routes;
    return result;
  }

  setupEndpoints() {
    console.log('🚀 Configuring API-only server (frontend is deployed separately on Vercel)');
    
    // Root endpoint - API server info
    this.app.get('/', (req, res) => {
      res.json({
        name: this.config.APP_NAME,
        version: this.config.APP_VERSION,
        status: 'operational',
        api_version: this.config.API_VERSION,
        docs: '/api/v1/docs',
        health: '/health',
        frontend_url: process.env.FRONTEND_URL || 'https://your-vercel-app.vercel.app',
        api_base: '/api/v1',
        message: 'This is an API-only server. Frontend is deployed separately.'
      });
    });
    
    // API documentation route
    this.app.get('/api-docs', (req, res) => {
      const docsPath = path.join(__dirname, 'docs', 'index.html');
      if (fs.existsSync(docsPath)) {
        res.sendFile(docsPath);
      } else {
        res.json({
          message: 'QuickLocal API Documentation',
          version: this.config.APP_VERSION,
          baseUrl: '/api/v1',
          endpoints: this.loadedRoutes?.map(route => route.path) || [],
          frontend_url: process.env.FRONTEND_URL || 'https://your-vercel-app.vercel.app',
          swagger_docs: '/api/v1/docs/swagger'
        });
      }
    });
    
    // Redirect common frontend routes to Vercel frontend
    const redirectRoutes = [
      '/marketplace', '/home', '/admin', '/cart', '/checkout', 
      '/login', '/register', '/profile', '/dashboard',
      '/search', '/orders', '/wishlist', '/reviews',
      '/settings', '/help', '/about', '/contact'
    ];
    
    const frontendUrl = process.env.FRONTEND_URL || 'https://your-vercel-app.vercel.app';
    
    redirectRoutes.forEach(route => {
      this.app.get(route, (req, res) => {
        // Instead of trying to serve files, redirect to the Vercel frontend
        const redirectUrl = `${frontendUrl}${route === '/marketplace' ? '/' : route}`;
        console.log(`🔄 Redirecting ${route} to frontend: ${redirectUrl}`);
        res.redirect(302, redirectUrl);
      });
    });
    
    console.log('✅ API-only server configuration completed');
    console.log(`🌐 Frontend URL: ${frontendUrl}`);
    
    // CRITICAL: Mount main API routes
    try {
      const mainRoutes = require('./routes');
      this.app.use('/api/v1', mainRoutes);
      console.log('✅ Main API routes mounted at /api/v1');
    } catch (error) {
      console.error('❌ Failed to mount main API routes:', error);
      
      // Fallback: Mount essential routes directly
      console.log('🔄 Attempting fallback route mounting...');
      this.mountFallbackRoutes();
    }
    
    // Add monitoring routes if available
    if (monitoringRoutes) {
      try {
        console.log('📈 Adding performance monitoring routes...');
        const monitorRouter = monitoringRoutes(express.Router());
        this.app.use('/api/v1/monitoring', monitorRouter.router || monitorRouter);
        console.log('✅ Performance monitoring routes enabled');
      } catch (error) {
        console.warn('⚠️ Monitoring routes setup failed:', error.message);
      }
    }
    
    // Add advanced search routes if available
    if (createSearchRoutes && advancedSearchSystem) {
      try {
        console.log('🔍 Adding advanced search routes...');
        const searchRouter = createSearchRoutes(advancedSearchSystem);
        this.app.use('/api/v1', searchRouter);
        console.log('✅ Advanced search routes enabled');
      } catch (error) {
        console.warn('⚠️ Search routes setup failed:', error.message);
      }
    }
    
    // Add image optimization routes if available
    if (createImageRoutes && cdnImageOptimization) {
      try {
        console.log('🇿️ Adding image optimization routes...');
        const imageRoutes = createImageRoutes(cdnImageOptimization);
        this.app.use('/api/v1', imageRoutes.router);
        console.log('✅ Image optimization routes enabled');
        
        // Make middleware available globally for use in product routes
        this.app.locals.imageMiddleware = imageRoutes.middleware;
      } catch (error) {
        console.warn('⚠️ Image optimization routes setup failed:', error.message);
      }
    }
    
    // Add SMS gateway routes if available
    if (createSMSRoutes && smsGatewaySystem) {
      try {
        console.log('📱 Adding SMS gateway routes...');
        const smsRoutes = createSMSRoutes(smsGatewaySystem);
        this.app.use('/api/v1', smsRoutes.router);
        console.log('✅ SMS gateway routes enabled');
        
        // Make middleware available globally
        this.app.locals.smsMiddleware = smsRoutes.middleware;
      } catch (error) {
        console.warn('⚠️ SMS routes setup failed:', error.message);
      }
    }
    
    // Add Two-Factor Authentication routes if available
    if (create2FARoutes && twoFactorSystem) {
      try {
        console.log('🔐 Adding Two-Factor Authentication routes...');
        const twoFARoutes = create2FARoutes(twoFactorSystem);
        this.app.use('/api/v1', twoFARoutes.router);
        console.log('✅ Two-Factor Authentication routes enabled');
        
        // Make middleware available globally
        this.app.locals.twoFAMiddleware = twoFARoutes.middleware;
      } catch (error) {
        console.warn('⚠️ 2FA routes setup failed:', error.message);
      }
    }
    
    // Server info available at /api/v1/info instead of root

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
        res.send('# Basic metrics placeholder\nserver_uptime ' + Math.floor(process.uptime()));
      });

      this.app.get('/metrics/summary', (req, res) => {
        res.json({
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          platform: process.platform
        });
      });
    }

    // Server info endpoint
    this.app.get('/api/v1/info', (req, res) => {
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
        endpoints: this.loadedRoutes ? this.loadedRoutes.reduce((acc, route) => {
          acc[route.name.toLowerCase().replace(/\s+/g, '_')] = route.path;
          return acc;
        }, {}) : {},
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
          endpoints: this.loadedRoutes ? this.loadedRoutes.map(route => ({
            name: route.name,
            path: route.path,
            priority: route.priority,
            status: route.status
          })) : [],
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

    // Advanced UX Features API endpoints
    this.setupUXFeaturesEndpoints();
    
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
        version: this.config.APP_VERSION
      });
    });
  }

  setupUXFeaturesEndpoints() {
    // Recently viewed products endpoint
    this.app.post('/api/v1/user/recently-viewed', async (req, res) => {
      try {
        const { productId } = req.body;
        const userId = req.user?.id;
        
        if (!productId) {
          return res.status(400).json({
            success: false,
            error: 'Product ID required'
          });
        }

        // If user is logged in, store in database
        if (userId) {
          try {
            const User = mongoose.model('User');
            await User.findByIdAndUpdate(
              userId,
              {
                $pull: { recentlyViewed: productId },
                $push: {
                  recentlyViewed: {
                    $each: [{ productId, viewedAt: new Date() }],
                    $position: 0,
                    $slice: 20 // Keep only last 20 items
                  }
                }
              },
              { upsert: false }
            );
          } catch (error) {
            console.warn('Failed to save recently viewed to database:', error);
          }
        }

        res.json({
          success: true,
          message: 'Product view tracked'
        });
      } catch (error) {
        console.error('Recently viewed tracking error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to track product view',
          message: error.message
        });
      }
    });

    // Get recently viewed products
    this.app.get('/api/v1/user/recently-viewed', async (req, res) => {
      try {
        const userId = req.user?.id;
        const limit = parseInt(req.query.limit) || 10;
        
        if (!userId) {
          return res.json({
            success: true,
            products: []
          });
        }

        const User = mongoose.model('User');
        const Product = mongoose.model('Product');
        
        const user = await User.findById(userId)
          .select('recentlyViewed')
          .lean();
        
        if (!user?.recentlyViewed?.length) {
          return res.json({
            success: true,
            products: []
          });
        }

        const productIds = user.recentlyViewed
          .slice(0, limit)
          .map(item => item.productId);
        
        const products = await Product.find({
          _id: { $in: productIds },
          isDeleted: { $ne: true }
        })
        .select('name price images averageRating reviewCount stock')
        .lean();

        // Maintain order from recently viewed
        const orderedProducts = productIds
          .map(id => products.find(p => p._id.toString() === id.toString()))
          .filter(Boolean);

        res.json({
          success: true,
          products: orderedProducts
        });
      } catch (error) {
        console.error('Get recently viewed error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to get recently viewed products',
          message: error.message
        });
      }
    });

    // Product comparison endpoints
    this.app.post('/api/v1/products/compare', async (req, res) => {
      try {
        const { productIds } = req.body;
        
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Product IDs array required'
          });
        }

        if (productIds.length > 5) {
          return res.status(400).json({
            success: false,
            error: 'Maximum 5 products can be compared'
          });
        }

        const Product = mongoose.model('Product');
        const products = await Product.find({
          _id: { $in: productIds },
          isDeleted: { $ne: true }
        })
        .select('name brand price originalPrice images averageRating reviewCount stock specifications category')
        .lean();

        // Generate comparison data
        const comparison = {
          products,
          comparisonTable: this.generateComparisonTable(products),
          summary: this.generateComparisonSummary(products)
        };

        res.json({
          success: true,
          comparison
        });
      } catch (error) {
        console.error('Product comparison error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to compare products',
          message: error.message
        });
      }
    });

    // Quick view endpoint (enhanced product details)
    this.app.get('/api/v1/products/:id/quickview', async (req, res) => {
      try {
        const { id } = req.params;
        const userId = req.user?.id;
        
        const Product = mongoose.model('Product');
        const product = await Product.findById(id)
          .populate('sellerId', 'businessName verified')
          .lean();

        if (!product || product.isDeleted) {
          return res.status(404).json({
            success: false,
            error: 'Product not found'
          });
        }

        // Check if in user's wishlist
        let inWishlist = false;
        if (userId) {
          try {
            const User = mongoose.model('User');
            const user = await User.findById(userId).select('wishlist').lean();
            inWishlist = user?.wishlist?.some(item => item.toString() === id);
          } catch (error) {
            console.warn('Failed to check wishlist status:', error);
          }
        }

        res.json({
          success: true,
          product: {
            ...product,
            inWishlist
          }
        });
      } catch (error) {
        console.error('Quick view error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to get product details',
          message: error.message
        });
      }
    });

    // Product recommendations endpoint
    this.app.get('/api/v1/products/:id/recommendations', async (req, res) => {
      try {
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 10;
        const userId = req.user?.id;
        
        const Product = mongoose.model('Product');
        const currentProduct = await Product.findById(id).select('category brand tags').lean();
        
        if (!currentProduct) {
          return res.status(404).json({
            success: false,
            error: 'Product not found'
          });
        }

        // Build recommendation query
        const recommendationQuery = {
          _id: { $ne: id },
          isDeleted: { $ne: true },
          stock: { $gt: 0 },
          $or: [
            { category: currentProduct.category },
            { brand: currentProduct.brand },
            { tags: { $in: currentProduct.tags || [] } }
          ]
        };

        const recommendations = await Product.find(recommendationQuery)
          .select('name price originalPrice images averageRating reviewCount stock')
          .sort({ averageRating: -1, reviewCount: -1 })
          .limit(limit)
          .lean();

        res.json({
          success: true,
          recommendations
        });
      } catch (error) {
        console.error('Product recommendations error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to get product recommendations',
          message: error.message
        });
      }
    });

    console.log('✨ UX Features API endpoints initialized');
  }

  generateComparisonTable(products) {
    if (!products.length) return {};

    const comparisonFields = ['price', 'originalPrice', 'brand', 'averageRating', 'reviewCount', 'stock'];
    const specificationFields = new Set();
    
    // Collect all specification keys
    products.forEach(product => {
      if (product.specifications) {
        Object.keys(product.specifications).forEach(key => {
          specificationFields.add(key);
        });
      }
    });

    const comparison = {};
    
    // Basic fields
    comparisonFields.forEach(field => {
      comparison[field] = products.map(product => product[field] || 'N/A');
    });
    
    // Specifications
    Array.from(specificationFields).forEach(spec => {
      comparison[spec] = products.map(product => 
        product.specifications?.[spec] || 'N/A'
      );
    });

    return comparison;
  }

  generateComparisonSummary(products) {
    if (!products.length) return {};

    const summary = {
      cheapest: null,
      mostExpensive: null,
      bestRated: null,
      mostReviewed: null
    };

    let minPrice = Infinity;
    let maxPrice = 0;
    let maxRating = 0;
    let maxReviews = 0;

    products.forEach(product => {
      if (product.price < minPrice) {
        minPrice = product.price;
        summary.cheapest = product;
      }
      
      if (product.price > maxPrice) {
        maxPrice = product.price;
        summary.mostExpensive = product;
      }
      
      if ((product.averageRating || 0) > maxRating) {
        maxRating = product.averageRating || 0;
        summary.bestRated = product;
      }
      
      if ((product.reviewCount || 0) > maxReviews) {
        maxReviews = product.reviewCount || 0;
        summary.mostReviewed = product;
      }
    });

    return summary;
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
      console.warn('External service health check failed:', error.message);
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
      const availableRoutes = this.loadedRoutes ? this.loadedRoutes.map(route => route.path) : [];
      const method = req.method;
      const requestedPath = req.originalUrl;
      
      // Find similar routes using basic string matching
      const suggestions = availableRoutes
        .filter(route => {
          const similarity = this.calculateSimilarity(requestedPath, route);
          return similarity > 0.3;
        })
        .slice(0, 3);

      console.warn(`404: ${method} ${requestedPath} from ${req.headers.origin || 'unknown'} [${req.correlationId}]`);
      
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

      console.error(`Unhandled error [${errorId}]:`, errorLog);

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
      console.error('💥 Uncaught Exception:', err);
      
      // Give some time for logs to be written, then exit
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
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
   📍 Routes: ${this.loadedRoutes ? this.loadedRoutes.length : 0} loaded
   💰 Min Order: ₹${process.env.MIN_ORDER_AMOUNT || 50}
   🚚 Delivery Fee: ₹${process.env.BASE_DELIVERY_FEE || 25}
   🆓 Free Delivery: ₹${process.env.FREE_DELIVERY_THRESHOLD || 500}+

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ ${this.config.APP_NAME} Server is ready to serve customers!
🌐 Visit http://${this.config.HOST}:${this.config.PORT} for API documentation
🏪 Marketplace ready for ${process.env.CURRENCY || 'INR'} transactions
        `;

        console.log(serverInfo);
        console.log('🚀 QuickLocal API Server started successfully');
        
        // Now show detailed status since everything is actually connected
        console.log('Status: Connected');
        console.log('✅ Server is connected and running');
        console.log(`🏦 Database: ${mongoose.connection.db?.databaseName || 'Connected'}`); 
        console.log(`🖥️  Host: ${mongoose.connection.host || this.config.HOST}`);
        console.log(`
⚡ Pool Size: ${process.env.DB_POOL_SIZE || 10}
🛑️  Security Features:
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
🏦 Marketplace Features:
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
        
        resolve();
      });

      // Enhanced server error handling
      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ Port ${this.config.PORT} is already in use.`);
          console.log(`💡 Kill existing process: lsof -ti:${this.config.PORT} | xargs kill -9`);
          console.log(`💡 Or try a different port: PORT=10001 npm start`);
        } else if (err.code === 'EACCES') {
          console.error(`❌ Permission denied for port ${this.config.PORT}.`);
          console.log(`💡 Try a port > 1024 or run with appropriate permissions.`);
        } else if (err.code === 'ENOTFOUND') {
          console.error(`❌ Host ${this.config.HOST} not found.`);
          console.log(`💡 Check your HOST environment variable.`);
        } else {
          console.error('❌ Server error:', err);
        }
        
        reject(err);
      });

      // Handle server warnings and client errors
      this.server.on('clientError', (err, socket) => {
        console.warn(`Client error from ${socket.remoteAddress}: ${err.message}`);
        
        if (socket.writable) {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        }
      });

      this.server.on('connection', (socket) => {
        socket.on('error', (err) => {
          console.warn(`Socket error: ${err.message}`);
        });
      });
    });
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) {
        console.warn('⚠️ Shutdown already in progress...');
        return;
      }

      this.isShuttingDown = true;
      console.log(`🛑 ${signal} received. Starting graceful shutdown...`);

      const shutdownTimeout = setTimeout(() => {
        console.error('❌ Graceful shutdown timeout exceeded. Forcing exit...');
        process.exit(1);
      }, 30000); // 30 second timeout

      try {
        // Stop accepting new connections
        console.log('🔄 Stopping HTTP server...');
        await new Promise((resolve, reject) => {
          this.server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Close Socket.IO connections gracefully
        if (this.io) {
          console.log('🔄 Closing Socket.IO connections...');
          
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
        console.log('🔄 Closing database connections...');
        await mongoose.connection.close();

        // Final cleanup
        console.log('🔄 Performing final cleanup...');
        
        clearTimeout(shutdownTimeout);
        
        console.log('✅ Graceful shutdown completed successfully');
        console.log(`👋 ${this.config.APP_NAME} server stopped cleanly`);
        
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during graceful shutdown:', error);
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

  // Fallback route mounting when main routes fail
  mountFallbackRoutes() {
    const essentialRoutes = [
      { path: '/api/v1/auth', file: './routes/auth' },
      { path: '/api/v1/products', file: './routes/products' },
      { path: '/api/v1/users', file: './routes/users' },
      { path: '/api/v1/orders', file: './routes/orders' }
    ];
    
    essentialRoutes.forEach(route => {
      try {
        const routeHandler = require(route.file);
        this.app.use(route.path, routeHandler);
        console.log(`✅ Fallback: Mounted ${route.path}`);
      } catch (error) {
        console.error(`❌ Fallback failed for ${route.path}:`, error.message);
      }
    });
  }
  
  // Emergency route mounting with basic responses
  mountEmergencyRoutes() {
    // Basic auth route
    this.app.post('/api/v1/auth/login', (req, res) => {
      res.status(503).json({ 
        error: 'Service temporarily unavailable', 
        message: 'Authentication service is being restored' 
      });
    });
    
    // Basic products route
    this.app.get('/api/v1/products', (req, res) => {
      res.status(503).json({ 
        error: 'Service temporarily unavailable', 
        message: 'Product service is being restored',
        products: []
      });
    });
    
    console.log('🚨 Emergency routes mounted - basic responses active');
  }
}

// Enhanced Cluster Manager for Production Scaling
class QuickLocalClusterManager {
  static start() {
    const config = new QuickLocalConfig().config;
    
    if (config.CLUSTER_MODE && cluster.isPrimary) {
      console.log(`🔄 Starting QuickLocal in cluster mode with ${config.MAX_WORKERS} workers...`);
      
      // Fork workers
      for (let i = 0; i < config.MAX_WORKERS; i++) {
        const worker = cluster.fork({
          WORKER_ID: i + 1,
          INSTANCE_ID: `${config.INSTANCE_ID}-worker-${i + 1}`
        });
        
        worker.on('message', (message) => {
          if (message.type === 'metrics') {
            // Handle worker metrics in master process
            console.log(`📊 Metrics from worker ${worker.id}:`, message.data);
          }
        });
      }

      // Handle worker events
      cluster.on('exit', (worker, code, signal) => {
        const exitCode = worker.process.exitCode;
        console.warn(`❌ Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
        
        // Don't restart if it was an intentional shutdown
        if (exitCode !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
          console.log('🔄 Starting a new worker to replace the failed one...');
          const newWorker = cluster.fork({
            WORKER_ID: worker.id,
            INSTANCE_ID: `${config.INSTANCE_ID}-worker-${worker.id}`
          });
          
          newWorker.on('message', (message) => {
            if (message.type === 'metrics') {
              console.log(`📊 Metrics from replacement worker ${newWorker.id}:`, message.data);
            }
          });
        }
      });

      cluster.on('online', (worker) => {
        console.log(`✅ Worker ${worker.process.pid} is online (ID: ${worker.id})`);
      });

      cluster.on('listening', (worker, address) => {
        console.log(`🎧 Worker ${worker.process.pid} is listening on ${address.address}:${address.port}`);
      });

      // Master process graceful shutdown
      const masterShutdown = () => {
        console.log('🛑 Master process shutting down workers...');
        
        const workers = Object.values(cluster.workers);
        let workersShutdown = 0;
        
        // Send shutdown signal to all workers
        workers.forEach(worker => {
          if (worker) {
            worker.send('shutdown');
            
            // Force kill worker after timeout
            setTimeout(() => {
              if (!worker.isDead()) {
                console.warn(`⚠️ Force killing worker ${worker.process.pid}`);
                worker.kill('SIGKILL');
              }
            }, 10000);
            
            worker.on('disconnect', () => {
              workersShutdown++;
              if (workersShutdown === workers.length) {
                console.log('✅ All workers shut down successfully');
                process.exit(0);
              }
            });
          }
        });
        
        // Force exit if workers don't shutdown in time
        setTimeout(() => {
          console.error('❌ Workers shutdown timeout. Force exiting...');
          process.exit(1);
        }, 15000);
      };

      process.on('SIGTERM', masterShutdown);
      process.on('SIGINT', masterShutdown);

      // Log cluster status every 5 minutes
      setInterval(() => {
        const workers = Object.values(cluster.workers);
        const aliveWorkers = workers.filter(worker => worker && !worker.isDead()).length;
        console.log(`📊 Cluster status: ${aliveWorkers}/${config.MAX_WORKERS} workers alive`);
      }, 5 * 60 * 1000);

    } else {
      // Worker process or single process mode
      const server = new QuickLocalServer();
      
      // Handle shutdown message from master
      process.on('message', (msg) => {
        if (msg === 'shutdown') {
          console.log(`🛑 Worker ${process.pid} received shutdown signal from master`);
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
        console.error('❌ Worker startup failed:', error);
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

      console.log(`🧪 Development: Triggering ${event} event`, data);

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

    console.log('🧪 Development utilities enabled');
  }

  static logEnvironmentInfo() {
    if (process.env.NODE_ENV !== 'development') return;

    console.log('🧪 Development Environment Info:');
    console.log(`   Debug Mode: ${process.env.DEBUG_MODE}`);
    console.log(`   Mock Payment: ${process.env.MOCK_PAYMENT}`);
    console.log(`   Mock SMS: ${process.env.MOCK_SMS}`);
    console.log(`   Mock Email: ${process.env.MOCK_EMAIL}`);
    console.log(`   API Docs: ${process.env.ENABLE_API_DOCS}`);
    console.log(`   Seed Data: ${process.env.ENABLE_SEED_DATA}`);
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
}
