// --------------------- Imports & Setup ---------------------
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');
const fs = require('fs');

// --------------------- Create logs directory ---------------------
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs', { recursive: true });
}

// --------------------- Redis Setup with Proper Fallback ---------------------
let redisClient = null;
if (process.env.DISABLE_REDIS !== 'true' && process.env.REDIS_URL) {
  try {
    const redis = require('redis');
    redisClient = redis.createClient({
      url: process.env.REDIS_URL,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          return new Error('Redis server connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 10) {
          return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });
    
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    redisClient.on('connect', () => {
      console.log('✅ Redis connected');
    });
    
    // Connect to Redis
    redisClient.connect().catch(console.error);
  } catch (error) {
    console.log('🔴 Redis not available, continuing without Redis');
    redisClient = null;
  }
} else {
  console.log('🔴 Redis disabled - running without Redis');
}

// --------------------- Winston Logger ---------------------
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.File({ 
      filename: 'logs/error.log', 
      level: 'error', 
      maxsize: 5_000_000, 
      maxFiles: 5, 
      handleExceptions: true 
    }),
    new transports.File({ 
      filename: 'logs/combined.log', 
      maxsize: 5_000_000, 
      maxFiles: 5 
    })
  ],
  exitOnError: false,
  exceptionHandlers: [
    new transports.File({ filename: 'logs/exceptions.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({ 
    format: format.combine(
      format.colorize(), 
      format.simple()
    ) 
  }));
}

// --------------------- Environment Checks ---------------------
const requiredEnv = ['MONGODB_URI', 'JWT_SECRET', 'COOKIE_SECRET', 'FRONTEND_URLS'];
const missingEnv = requiredEnv.filter(env => !process.env[env]);

if (missingEnv.length > 0) {
  logger.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

// --------------------- Express App Init ---------------------
const app = express();
const httpServer = createServer(app);
const allowedOrigins = process.env.FRONTEND_URLS.split(',').map(url => url.trim());

// --------------------- Security Middleware ---------------------
app.set('trust proxy', 1);

// Enhanced Helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", ...allowedOrigins, 'ws:', 'wss:'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com']
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Enhanced CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost and local IPs for development
    if (origin.includes('localhost') || 
        origin.includes('127.0.0.1') || 
        origin.includes('192.168.') ||
        origin.includes('10.0.') ||
        allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    logger.warn(`CORS blocked: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// --------------------- Request Processing Middleware ---------------------
app.use(express.json({ 
  limit: '10mb', 
  verify: (req, res, buf) => req.rawBody = buf 
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(compression({ 
  level: 6, 
  threshold: 1024 
}));

// Morgan logging with proper error handling
app.use(morgan('combined', {
  stream: { 
    write: (msg) => {
      try {
        logger.info(msg.trim());
      } catch (error) {
        console.error('Logging error:', error);
      }
    }
  },
  skip: (req) => req.path === '/health' || req.path === '/favicon.ico'
}));

// Request ID and timing middleware
app.use((req, res, next) => {
  req.requestId = uuidv4();
  req.startTime = process.hrtime.bigint();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// Response time logging
app.use((req, res, next) => {
  res.on('finish', () => {
    try {
      const endTime = process.hrtime.bigint();
      const responseTime = Number(endTime - req.startTime) / 1_000_000; // Convert to milliseconds
      
      logger.info('Request completed', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        responseTime: `${responseTime.toFixed(2)}ms`,
        requestId: req.requestId,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    } catch (error) {
      console.error('Error logging request:', error);
    }
  });
  next();
});

// --------------------- Rate Limiting ---------------------
const createRateLimit = (windowMs, max, message = 'Too many requests') => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn(`Rate limit exceeded for ${req.ip} on ${req.path}`);
      res.status(429).json({ 
        error: message, 
        requestId: req.requestId,
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
};

app.use('/api/', createRateLimit(15 * 60 * 1000, 1000, 'Too many API requests'));
app.use('/api/auth/', createRateLimit(60 * 60 * 1000, 20, 'Too many authentication attempts'));
app.use('/api/orders', createRateLimit(60 * 1000, 10, 'Too many order requests'));

// --------------------- MongoDB Connection ---------------------
const connectDB = async (retries = 5) => {
  try {
    const options = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      bufferMaxEntries: 0
    };

    await mongoose.connect(process.env.MONGODB_URI, options);
    logger.info(`✅ MongoDB connected: ${mongoose.connection.db.databaseName}`);
    
    // MongoDB event listeners
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
    
    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });
    
  } catch (err) {
    logger.error(`MongoDB connection attempt failed:`, err.message);
    
    if (retries > 0) {
      logger.warn(`Retrying MongoDB connection... ${retries} attempts remaining`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return connectDB(retries - 1);
    }
    
    logger.error('❌ MongoDB connection failed permanently');
    process.exit(1);
  }
};

// --------------------- Socket.IO with Better Error Handling ---------------------
const io = new Server(httpServer, {
  cors: { 
    origin: allowedOrigins, 
    credentials: true 
  },
  pingInterval: 25000,
  pingTimeout: 60000,
  transports: ['websocket', 'polling']
});

// Socket.IO authentication middleware
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token || 
                  socket.handshake.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      return next(new Error('Authentication token missing'));
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    logger.warn(`Socket authentication failed: ${err.message}`);
    next(new Error('Authentication failed'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  logger.info(`🔗 Socket connected: ${socket.id} (User: ${socket.user.id})`);
  
  // Join user-specific room
  socket.join(`user-${socket.user.id}`);
  
  // Join role-specific room if role exists
  if (socket.user.role) {
    socket.join(`role-${socket.user.role}`);
  }
  
  // Handle order room joining
  socket.on('join-order', (orderId) => {
    if (orderId && typeof orderId === 'string') {
      socket.join(`order-${orderId}`);
      logger.info(`Socket ${socket.id} joined order room: ${orderId}`);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', (reason) => {
    logger.info(`❌ Socket disconnected: ${socket.id} - ${reason}`);
  });
  
  // Handle errors
  socket.on('error', (error) => {
    logger.error(`Socket error for ${socket.id}:`, error);
  });
});

// Make io available to routes
app.set('io', io);

// --------------------- Health Check Route (before other routes) ---------------------
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: redisClient ? 'enabled' : 'disabled',
    memory: process.memoryUsage(),
    requestId: req.requestId
  };
  
  res.json(health);
});

// --------------------- API Routes ---------------------
const routes = [
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

// Load routes with better error handling
routes.forEach(({ path, module }) => {
  try {
    const routeModule = require(module);
    app.use(path, routeModule);
    logger.info(`✅ Loaded route: ${path}`);
  } catch (error) {
    logger.error(`❌ Failed to load route ${path}:`, error.message);
    // Don't exit - continue with other routes
  }
});

// --------------------- Additional API Routes ---------------------
app.get('/', (req, res) => {
  res.json({
    name: 'QuickLocal Backend API',
    version: process.env.APP_VERSION || '2.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    requestId: req.requestId,
    services: {
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redis: redisClient ? 'enabled' : 'disabled',
      socketio: 'enabled'
    }
  });
});

app.get('/api-docs', (req, res) => {
  const docsPath = path.join(__dirname, 'public/docs/index.html');
  if (fs.existsSync(docsPath)) {
    res.sendFile(docsPath);
  } else {
    res.status(404).json({ 
      error: 'API documentation not found',
      requestId: req.requestId 
    });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'OK',
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    version: process.env.APP_VERSION || '2.0.0'
  });
});

// --------------------- Static Files ---------------------
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

// --------------------- Error Handling ---------------------
// 404 handler
app.use((req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: `Cannot ${req.method} ${req.url}`,
    requestId: req.requestId 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    requestId: req.requestId,
    statusCode
  });
  
  // Don't leak error details in production
  const errorResponse = {
    error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : message,
    requestId: req.requestId
  };
  
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
  }
  
  res.status(statusCode).json(errorResponse);
});

// --------------------- Graceful Shutdown ---------------------
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, initiating graceful shutdown...`);
  
  try {
    // Stop accepting new connections
    httpServer.close(async () => {
      logger.info('HTTP server closed');
      
      // Close database connection
      try {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed');
      } catch (err) {
        logger.error('Error closing MongoDB:', err);
      }
      
      // Close Redis connection
      if (redisClient) {
        try {
          await redisClient.quit();
          logger.info('Redis connection closed');
        } catch (err) {
          logger.error('Error closing Redis:', err);
        }
      }
      
      // Close Socket.IO
      io.close(() => {
        logger.info('Socket.IO closed');
        process.exit(0);
      });
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
    
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// --------------------- Server Startup ---------------------
const startServer = async () => {
  try {
    // Connect to MongoDB first
    await connectDB();
    
    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || '0.0.0.0';
    
    httpServer.listen(PORT, HOST, () => {
      logger.info(`🚀 Server running on http://${HOST}:${PORT}`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔒 Redis: ${redisClient ? 'enabled' : 'disabled'}`);
    });
    
    // Handle server errors
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

// Start the server
startServer();

// Export for testing
module.exports = { app, io, logger, redisClient };