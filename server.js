// server.js
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
const logger = require('./utils/logger');
const { connectDB } = require('./config/database');


// Setup logs directory
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs', { recursive: true });
}

// Init app
const app = express();
const httpServer = http.createServer(app);

// Apply middleware
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(compression());
app.use(morgan('dev'));

// Optional: Load Socket.IO if needed
let io = null;
try {
  io = require('./app').io;
  logger.info('✅ Socket.IO initialized');
} catch {
  logger.warn('⚠️ Socket.IO not available. Real-time features disabled.');
}

// Route Loader
const loadRoutes = (app) => {
  const routeDefs = [
    { path: '/api/auth', module: './routes/auth' },
    { path: '/api/users', module: './routes/users' },
    { path: '/api/products', module: './routes/products' },
    { path: '/api/orders', module: './routes/orders' },
    { path: '/api/delivery', module: './routes/delivery' },
    { path: '/api/cart', module: './routes/cart' },
    { path: '/api/seller', module: './routes/seller' },
    { path: '/api/admin', module: './routes/admin' },
    { path: '/api/wishlist', module: './routes/wishlist' },
    { path: '/api/v1/payment', module: './routes/payment-routes' },
    { path: '/api/v1/webhooks', module: './routes/webhook-routes' }
  ];

  let loaded = 0;
  let failed = 0;

  routeDefs.forEach(({ path, module }) => {
    try {
      const resolvedPath = require.resolve(module);
      delete require.cache[resolvedPath];
      const route = require(module);

      if (
        typeof route !== 'function' &&
        !route.stack &&
        !route.router
      ) {
        throw new Error(`Invalid router export in ${module}`);
      }

      app.use(path, route);
      logger.info(`✅ Loaded route: ${path}`);
      loaded++;
    } catch (error) {
      logger.error(`❌ Failed to load route ${path}`, {
        module,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
      failed++;
    }
  });

  logger.info(`📊 Route loading complete: ${loaded} loaded, ${failed} failed`);
  return { loaded, failed };
};

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime()
  });
});

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// Error Middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  });
});

// Start Server
const startServer = async () => {
  try {
    await connectDB();
    console.log('\n🔄 Loading API routes...');
    const { loaded, failed } = loadRoutes(app);

    const PORT = process.env.PORT || 10000;
    const HOST = process.env.HOST || '0.0.0.0';

    httpServer.listen(PORT, HOST, () => {
      logger.info(`🚀 Server running on http://${HOST}:${PORT}`);
      console.log('\n📋 Configuration Summary:');
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Port: ${PORT}`);
      console.log(`   Database: ${mongoose.connection.db?.databaseName}`);
      console.log(`   Redis: ${process.env.DISABLE_REDIS === 'true' ? 'Disabled' : 'Enabled'}`);
      console.log(`   Features: healthChecks`);
      console.log(`   Routes Loaded: ${loaded}/${loaded + failed}`);
    });

    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use`);
      } else {
        logger.error('❌ Server error:', err);
      }
      process.exit(1);
    });

  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
