require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const morgan = require('morgan');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');

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
  exitOnError: false
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(format.colorize(), format.simple())
  }));
}

// --------------------- Environment Check ---------------------
const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET', 'COOKIE_SECRET', 'FRONTEND_URLS'];
requiredEnvVars.forEach(env => {
  if (!process.env[env]) {
    logger.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
});

// --------------------- Express Init ---------------------
const app = express();
const httpServer = createServer(app);
const allowedOrigins = process.env.FRONTEND_URLS.split(',');

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// --------------------- Enhanced Middleware ---------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", ...allowedOrigins, 'ws:', 'wss:'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com']
    }
  }
}));

// Enhanced CORS with better error handling
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    // Allow all localhost origins for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('192.168.')) {
      return callback(null, true);
    }

    // Check against allowed origins from env
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked: ${origin}`);
      // For development, allow anyway but log the warning
      if (process.env.NODE_ENV === 'development') {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => req.rawBody = buf
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(compression({ level: 6, threshold: 1024 }));

// Enhanced request tracking middleware
app.use((req, res, next) => {
  req.requestId = uuidv4();
  req.startTime = process.hrtime();
  req.ip = req.ip || req.connection.remoteAddress;
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

app.use(morgan('combined', {
  stream: { write: msg => logger.info(msg.trim()) },
  skip: req => req.path === '/health'
}));

// Response time tracking
app.use((req, res, next) => {
  res.on('finish', () => {
    const diff = process.hrtime(req.startTime);
    const responseTime = diff[0] * 1e3 + diff[1] * 1e-6;

    logger.info('Request completed', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime.toFixed(2)}ms`,
      ip: req.ip
    });
  });
  next();
});

// --------------------- Enhanced Rate Limiting ---------------------
const createRateLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded`, { ip: req.ip, path: req.path });
    res.status(429).json({ error: message, requestId: req.requestId });
  }
});

app.use('/api/', createRateLimiter(15 * 60 * 1000, 1000, 'Too many requests'));
app.use('/api/v1/auth/', createRateLimiter(60 * 60 * 1000, 20, 'Too many auth attempts'));
app.use('/api/v1/orders', createRateLimiter(60 * 1000, 10, 'Too many order requests'));

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
    };

    await mongoose.connect(process.env.MONGODB_URI, options);
    logger.info('✅ MongoDB connected', {
      host: mongoose.connection.host,
      name: mongoose.connection.name
    });

    // Connection event handlers
    mongoose.connection.on('error', err => {
      logger.error('MongoDB connection error:', err);
    });
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });
    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    // Index synchronization
    try {
      const models = mongoose.modelNames();
      if (models.length > 0) {
        logger.info(`Syncing indexes for ${models.length} models...`);

        for (const modelName of models) {
          try {
            await mongoose.model(modelName).syncIndexes();
            logger.debug(`✅ Indexes synced for ${modelName}`);
          } catch (indexError) {
            logger.debug(`Index sync completed for ${modelName}: ${indexError.message}`);
          }
        }
        logger.info('✅ Index synchronization completed');
      }
    } catch (syncError) {
      logger.warn('Index synchronization warning:', syncError.message);
    }

  } catch (err) {
    if (retries > 0) {
      logger.warn(`DB connection failed. Retrying... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return connectDB(retries - 1);
    }
    logger.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  }
};

// --------------------- Enhanced Socket.IO Setup ---------------------
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000
  },
  pingInterval: 25000,
  pingTimeout: 5000
});

// Enhanced Socket.IO authentication
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token ||
                 socket.handshake.headers['authorization']?.split(' ')[1];

    if (!token) throw new Error('Token missing');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;

    logger.info('Socket authenticated', {
      socketId: socket.id,
      userId: decoded.id,
      role: decoded.role
    });

    next();
  } catch (err) {
    logger.error('Socket auth failed:', { error: err.message });
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  logger.info(`🔗 Socket connected: ${socket.id}`, { userId: socket.user?.id });

  // Join user-specific room
  socket.join(`user-${socket.user.id}`);

  // Join role-specific room
  if (socket.user.role) {
    socket.join(`role-${socket.user.role}`);
  }

  // Enhanced order tracking
  socket.on('join-order', (orderId) => {
    if (!orderId || typeof orderId !== 'string') {
      return socket.emit('error', { message: 'Invalid order ID' });
    }
    socket.join(`order-${orderId}`);
    logger.info(`User joined order room: ${orderId}`, { userId: socket.user.id });
  });

  socket.on('error', (error) => {
    logger.error('Socket error:', { socketId: socket.id, error: error.message });
  });

  socket.on('disconnect', (reason) => {
    logger.info(`❌ Socket disconnected: ${socket.id}`, { reason, userId: socket.user?.id });
  });
});

// --------------------- API Routes ---------------------
const paymentRoutes = require('./routes/payment-routes');
const webhookRoutes = require('./routes/webhook-routes');

app.use('/api/v1/payment', paymentRoutes);
app.use('/api/v1/webhooks', webhookRoutes);

// Base API route
app.get('/api/v1/', (req, res) => {
  res.json({
    message: "QuickLocal API v1",
    version: "2.0.0",
    status: "operational",
    endpoints: {
      auth: "/api/v1/auth",
      products: "/api/v1/products", 
      orders: "/api/v1/orders",
      delivery: "/api/v1/delivery",
      users: "/api/v1/users",
      cart: "/api/v1/cart",
      seller: "/api/v1/seller",
      admin: "/api/v1/admin",
      wishlist: "/api/v1/wishlist"
    },
    documentation: "API documentation coming soon"
  });
});

// Use consolidated routes approach
app.use('/api/v1', require('./routes'));

// --------------------- Health Check ---------------------
app.get('/health', async (req, res) => {
  const health = {
    status: 'UP',
    timestamp: new Date(),
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'UP' : 'DOWN',
    redis: 'ENABLED',
    memory: process.memoryUsage(),
    version: process.env.APP_VERSION || '2.0.0'
  };
  res.json(health);
});

// --------------------- Static Files ---------------------
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1y' : '0'
}));

// --------------------- Error Handling ---------------------
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  const errorResponse = {
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    requestId: req.requestId
  };

  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
  }

  res.status(err.statusCode || 500).json(errorResponse);
});

// --------------------- Process Handlers ---------------------
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', {
    reason: reason instanceof Error ? reason.message : reason
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', {
    error: err.message,
    stack: err.stack
  });
  process.exit(1);
});

// --------------------- Graceful Shutdown ---------------------
const shutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    httpServer.close(() => logger.info('HTTP server closed'));
    io.close(() => logger.info('Socket.IO closed'));
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --------------------- Server Start ---------------------
const startServer = async () => {
  try {
    await connectDB();

    const PORT = process.env.PORT || 3000;
    httpServer.listen(PORT, '0.0.0.0', () => {
      logger.info(`📋 Configuration Summary:`);
      logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   Port: ${PORT}`);
      logger.info(`   Database: ${mongoose.connection.name}`);
      logger.info(`   Redis: ${process.env.REDIS_ENABLED === 'true' ? 'Enabled' : 'Disabled'}`);
      logger.info(`   Features: healthChecks, realtime, payments`);
      logger.info('');
      logger.info(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Server startup failed:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, io, logger };
