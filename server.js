require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const { createServer } = require('http');
// const xss = require('xss-clean'); // ❌ Deprecated
const morgan = require('morgan');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const { createTerminus } = require('@godaddy/terminus');
const { createLogger, format, transports } = require('winston');
// const { ApolloServer } = require('@apollo/server');
// const { expressMiddleware } = require('@apollo/server/express4');

// Local Modules
const config = require('./config/config');
const { errorHandler } = require('./utils/error');
const passportConfig = require('./config/passport');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const sellerRoutes = require('./routes/seller');
const adminRoutes = require('./routes/admin');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
const adminProductRoutes = require('./routes/adminProducts');

// Initialize Express
const app = express();
const httpServer = createServer(app);

// ==================== Winston Logger Setup ====================
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
    )
  }));
}

// ==================== Environment Validation ====================
const requiredEnvVars = ['MONGODB_URI', 'COOKIE_SECRET', 'JWT_SECRET'];
requiredEnvVars.forEach(env => {
  if (!process.env[env]) {
    logger.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
});

// ==================== Database Connection ====================
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    logger.info('✅ MongoDB Connected');
  } catch (err) {
    logger.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
};
connectDB();

// ==================== Middleware ====================
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(compression());
// app.use(xss()); // ❌ Removed deprecated global XSS filter
app.use(morgan('dev', { stream: { write: message => logger.http(message.trim()) } }));

// Security Headers
app.use(helmet());
app.use(helmet.permittedCrossDomainPolicies());
app.use(helmet.referrerPolicy({ policy: 'same-origin' }));

// Enhanced CORS Configuration
const allowedOrigins = process.env.FRONTEND_URLS 
  ? process.env.FRONTEND_URLS.split(',') 
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization'],
  maxAge: 86400
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', limiter);

// Passport Authentication
app.use(passport.initialize());
passportConfig(passport);

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// ==================== API Routes ====================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/admin/products', adminProductRoutes);

// Health Check
app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error Handling
app.use(errorHandler);

// ==================== Server Setup ====================
const PORT = process.env.PORT || 3000;
process.title = 'mystore-backend';

// Server event listeners
httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`❌ Port ${PORT} is already in use`);
  } else {
    logger.error('❌ Server error:', error);
  }
  process.exit(1);
});

httpServer.on('listening', () => {
  const addr = httpServer.address();
  logger.info(`✅ Server listening on http://localhost:${addr.port}`);
  logger.info(`✅ Also accessible on http://0.0.0.0:${addr.port}`);
  logger.info(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown setup
createTerminus(httpServer, {
  signals: ['SIGINT', 'SIGTERM'],
  healthChecks: { '/health': () => Promise.resolve() },
  onSignal: async () => {
    logger.info('🛑 Server is starting cleanup...');
    await Promise.all([
      mongoose.connection.close(false),
      new Promise(resolve => httpServer.close(resolve))
    ]);
    logger.info('🔌 Connections closed gracefully');
  },
  onShutdown: () => logger.info('👋 Server is shutting down'),
  logger: (msg, err) => logger.error(err ? `❌ ${msg}: ${err}` : `ℹ️ ${msg}`)
});

// Start the server
httpServer.listen(PORT, '0.0.0.0');

// ==================== Process Event Handlers ====================
process.on('unhandledRejection', (err) => {
  logger.error('⚠️ Unhandled Rejection:', err);
});

process.on('uncaughtException', (err) => {
  logger.error('⚠️ Uncaught Exception:', err);
  process.exit(1);
});

module.exports = app;
