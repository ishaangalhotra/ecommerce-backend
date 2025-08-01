// server.js - Production Ready Express Server
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const compression = require('compression');

// Custom imports
const logger = require('./utils/logger');
const { connectDB } = require('./config/database');

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 10000,
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production'
};

// CORS origins configuration
const CORS_ORIGINS = [
  'https://www.quicklocal.shop',
  'https://quicklocal.shop',
  'https://my-frontend-ifyr.vercel.app',
  ...(CONFIG.IS_PRODUCTION ? [] : [
    'http://localhost:3000',
    'http://localhost:3001', 
    'http://localhost:5173'
  ])
];

// Utility Functions
const ensureLogsDirectory = () => {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    logger.info('📁 Created logs directory');
  }
};

const setupSocketIO = () => {
  try {
    const io = require('./app').io;
    logger.info('✅ Socket.IO initialized');
    return io;
  } catch (error) {
    logger.warn('⚠️ Socket.IO not available. Real-time features disabled.');
    return null;
  }
};

// Route definitions with validation
const ROUTE_DEFINITIONS = [
  { path: '/api/auth', module: './routes/auth', name: 'Authentication' },
  { path: '/api/users', module: './routes/users', name: 'User Management' },
  { path: '/api/products', module: './routes/products', name: 'Product Catalog' },
  { path: '/api/orders', module: './routes/orders', name: 'Order Processing' },
  { path: '/api/delivery', module: './routes/delivery', name: 'Delivery Service' },
  { path: '/api/cart', module: './routes/cart', name: 'Shopping Cart' },
  { path: '/api/seller', module: './routes/seller', name: 'Seller Dashboard' },
  { path: '/api/admin', module: './routes/admin', name: 'Admin Panel' },
  { path: '/api/wishlist', module: './routes/wishlist', name: 'User Wishlist' },
  { path: '/api/v1/payment', module: './routes/payment-routes', name: 'Payment Gateway' },
  { path: '/api/v1/webhooks', module: './routes/webhook-routes', name: 'Webhook Handlers' }
];

// Middleware Setup
const setupMiddleware = (app) => {
  // Security
  app.use(helmet({
    contentSecurityPolicy: CONFIG.IS_PRODUCTION ? undefined : false
  }));

  // CORS with dynamic origin validation
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      // Check if origin is allowed or matches Vercel pattern
      const isAllowed = CORS_ORIGINS.includes(origin) || 
                       origin.endsWith('.vercel.app');
      
      if (isAllowed) {
        callback(null, true);
      } else {
        logger.warn(`🚫 CORS blocked origin: ${origin}`);
        callback(new Error('CORS policy violation'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
    optionsSuccessStatus: 200 // For legacy browser support
  }));

  // Body parsing
  app.use(express.json({ 
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf; // Store raw body for webhook verification
    }
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  
  // Additional middleware
  app.use(cookieParser());
  app.use(compression());
  
  // Logging (only in development or when explicitly enabled)
  if (!CONFIG.IS_PRODUCTION || process.env.ENABLE_LOGGING === 'true') {
    app.use(morgan('combined', {
      stream: { write: (message) => logger.info(message.trim()) }
    }));
  }

  // Request debugging middleware
  app.use((req, res, next) => {
    const startTime = Date.now();
    
    if (!CONFIG.IS_PRODUCTION) {
      console.log(`📥 ${req.method} ${req.originalUrl} from ${req.headers.origin || 'unknown'}`);
      
      if (req.method === 'OPTIONS') {
        console.log('🔄 CORS preflight request');
      }
    }

    // Add request duration logging
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      if (duration > 1000) { // Log slow requests
        logger.warn(`🐌 Slow request: ${req.method} ${req.originalUrl} took ${duration}ms`);
      }
    });

    next();
  });
};

// Route Loading with enhanced error handling
const loadRoutes = (app) => {
  let loadedCount = 0;
  let failedCount = 0;
  const loadedRoutes = [];

  console.log('\n🔄 Loading API routes...');
  
  ROUTE_DEFINITIONS.forEach(({ path, module, name }) => {
    try {
      // Clear require cache for hot reloading in development
      if (!CONFIG.IS_PRODUCTION) {
        const resolvedPath = require.resolve(module);
        delete require.cache[resolvedPath];
      }
      
      const routeModule = require(module);
      
      // Validate router export
      if (!routeModule || (typeof routeModule !== 'function' && !routeModule.router && !routeModule.stack)) {
        throw new Error(`Invalid router export. Expected Express router, got ${typeof routeModule}`);
      }

      app.use(path, routeModule);
      loadedRoutes.push({ path, name });
      loadedCount++;
      
      logger.info(`✅ ${name}: ${path}`);
      
      // Debug route endpoints in development
      if (!CONFIG.IS_PRODUCTION && routeModule.stack) {
        routeModule.stack.forEach((layer) => {
          if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
            console.log(`   📍 ${methods} ${path}${layer.route.path}`);
          }
        });
      }
      
    } catch (error) {
      failedCount++;
      logger.error(`❌ Failed to load ${name} (${path})`, {
        module,
        error: error.message,
        stack: CONFIG.IS_PRODUCTION ? undefined : error.stack?.split('\n').slice(0, 3).join('\n')
      });
    }
  });

  logger.info(`📊 Route loading complete: ${loadedCount} loaded, ${failedCount} failed`);
  
  if (failedCount > 0 && CONFIG.IS_PRODUCTION) {
    logger.error('⚠️ Some routes failed to load in production. Server may not function correctly.');
  }

  return { loaded: loadedCount, failed: failedCount, routes: loadedRoutes };
};

// API Documentation endpoint
const createRootEndpoint = (app, loadedRoutes) => {
  app.get('/', (req, res) => {
    res.json({
      name: 'QuickLocal API',
      version: '1.0.0',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: CONFIG.NODE_ENV,
      endpoints: loadedRoutes.reduce((acc, route) => {
        acc[route.name.toLowerCase().replace(/\s+/g, '_')] = route.path;
        return acc;
      }, {}),
      health_check: '/health',
      documentation: 'API endpoints are listed above'
    });
  });
};

// Enhanced health check
const createHealthEndpoint = (app) => {
  app.get('/health', async (req, res) => {
    const healthData = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: CONFIG.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      database: {
        status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        name: mongoose.connection.db?.databaseName || 'unknown',
        host: mongoose.connection.host || 'unknown'
      },
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };

    // Additional health checks
    try {
      // Database ping
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db.admin().ping();
        healthData.database.ping = 'success';
      }
    } catch (error) {
      healthData.database.ping = 'failed';
      healthData.database.error = error.message;
      healthData.status = 'DEGRADED';
    }

    const statusCode = healthData.status === 'OK' ? 200 : 503;
    res.status(statusCode).json(healthData);
  });
};

// Enhanced error handlers
const setupErrorHandlers = (app) => {
  // 404 handler
  app.use('*', (req, res) => {
    const availableRoutes = ROUTE_DEFINITIONS.map(route => `${route.path}/*`);
    
    logger.warn(`404: ${req.method} ${req.originalUrl} from ${req.headers.origin || 'unknown'}`);
    
    res.status(404).json({
      error: 'Route not found',
      message: `${req.method} ${req.originalUrl} does not exist`,
      timestamp: new Date().toISOString(),
      suggestion: 'Check the API documentation at the root endpoint (/)',
      available_routes: availableRoutes
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    const errorId = Date.now().toString(36);
    
    logger.error(`Unhandled error [${errorId}]:`, {
      error: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(err.status || 500).json({
      error: CONFIG.IS_PRODUCTION ? 'Internal Server Error' : err.message,
      error_id: errorId,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      method: req.method,
      ...(CONFIG.IS_PRODUCTION ? {} : { stack: err.stack })
    });
  });
};

// Graceful shutdown handler
const setupGracefulShutdown = (server) => {
  const shutdown = (signal) => {
    logger.info(`\n🛑 ${signal} received. Starting graceful shutdown...`);
    
    server.close((err) => {
      if (err) {
        logger.error('❌ Error during server shutdown:', err);
        process.exit(1);
      }
      
      mongoose.connection.close(false, () => {
        logger.info('✅ Database connection closed.');
        logger.info('👋 Server shutdown complete.');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

// Main server startup function
const startServer = async () => {
  try {
    // Initialize
    ensureLogsDirectory();
    
    const app = express();
    const httpServer = http.createServer(app);
    
    // Setup Socket.IO
    const io = setupSocketIO();
    
    // Setup middleware
    setupMiddleware(app);
    
    // Connect to database
    await connectDB();
    logger.info('✅ Database connected successfully');
    
    // Load routes
    const { loaded, failed, routes } = loadRoutes(app);
    
    // Setup API endpoints
    createRootEndpoint(app, routes);
    createHealthEndpoint(app);
    
    // Setup error handling
    setupErrorHandlers(app);
    
    // Start server
    httpServer.listen(CONFIG.PORT, CONFIG.HOST, () => {
      logger.info(`🚀 QuickLocal API Server started successfully`);
      console.log('\n📋 Server Configuration:');
      console.log(`   🌍 URL: http://${CONFIG.HOST}:${CONFIG.PORT}`);
      console.log(`   🏗️  Environment: ${CONFIG.NODE_ENV}`);
      console.log(`   🗄️  Database: ${mongoose.connection.db?.databaseName}`);
      console.log(`   🔌 Socket.IO: ${io ? 'Enabled' : 'Disabled'}`);
      console.log(`   📊 Routes: ${loaded} loaded, ${failed} failed`);
      console.log(`   🌐 CORS Origins: ${CORS_ORIGINS.length} configured`);
      console.log(`   📝 Logging: ${CONFIG.IS_PRODUCTION ? 'Production' : 'Development'} mode`);
      console.log('\n✨ Server is ready to accept connections!');
    });

    // Handle server errors
    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${CONFIG.PORT} is already in use. Please use a different port.`);
      } else {
        logger.error('❌ Server error:', err);
      }
      process.exit(1);
    });

    // Setup graceful shutdown
    setupGracefulShutdown(httpServer);
    
    return { app, server: httpServer, io };
    
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
if (require.main === module) {
  startServer().catch((error) => {
    logger.error('❌ Startup error:', error);
    process.exit(1);
  });
}

module.exports = { startServer, CONFIG };
