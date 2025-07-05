require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path'); // Required for serving static files
const cookieParser = require('cookie-parser');
const compression = require('compression');
const { createServer } = require('http');
const xss = require('xss-clean'); // For XSS protection
const morgan = require('morgan');
const passport = require('passport');
const rateLimit = require('express-rate-limit'); // For rate limiting
const { ApolloServer } = require('apollo-server-express');
const { createTerminus } = require('@godaddy/terminus');
const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing'); // For Sentry tracing integrations

// Local Modules
const logger = require('./utils/logger');
const { errorHandler } = require('./middleware/error');
const passportConfig = require('./config/passport');
const typeDefs = require('./graphql/schema');
const resolvers = require('./graphql/resolvers');
const config = require('./config'); // Ensure your config module is correctly imported here

// --- REMOVED THE CONFLICTING MANUAL ENV VALIDATION BLOCK ---
// The following block has been removed, as config.js handles validation:
/*
const requiredEnvVars = ['MONGO_URI', 'COOKIE_SECRET', 'CORS_ORIGINS'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    logger.error(`❌ Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});
*/
// -------------------------------------------------------------

// Constants
const PORT = config.port; // Use port from validated config
const isProduction = config.isProduction; // Use isProduction from validated config

// Initialize Express
const app = express();
const httpServer = createServer(app);

// ==================== Sentry Initialization ====================
if (process.env.SENTRY_DSN) { // Still use process.env here as Sentry init needs raw DSN
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: config.env, // Use env from config
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app }),
      new Tracing.Integrations.Mongo({ mongoose }) // Assuming this is correct from your snippet
    ],
    tracesSampleRate: 1.0,
  });
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

// ==================== Global Middleware ====================
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded
app.use(cookieParser(config.security.cookieSecret)); // Use config for secret
app.use(compression());
app.use(xss()); // XSS clean middleware

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Add other CSP directives based on your frontend and third-party scripts.
      // Example for React/Vue development server:
      // connectSrc: ["'self'", config.frontendUrl, "ws://localhost:3000"],
      // scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Be careful with 'unsafe-inline' and 'unsafe-eval' in production
      // styleSrc: ["'self'", "'unsafe-inline'"],
      // imgSrc: ["'self'", "data:"],
    },
  },
}));
app.use(morgan(isProduction ? 'combined' : 'dev'));

// CORS setup
app.use(cors({
  origin: config.security.cors.origin, // Use config for CORS origins
  methods: config.security.cors.methods,
  allowedHeaders: config.security.cors.allowedHeaders,
  credentials: true,
}));

// Rate Limiting (using config)
if (config.features.rateLimiting) {
  const limiter = rateLimit({
    windowMs: config.security.rateLimit.windowMs,
    max: config.security.rateLimit.max,
    message: 'Too many requests from this IP, please try again after some time.',
    headers: true, // Send X-RateLimit-* headers
  });
  app.use('/api/', limiter); // Apply to all API routes
}

// Passport initialization
app.use(passport.initialize());
passportConfig(passport); // Pass passport object to config

// Serve static files (assuming 'public' for frontend build)
// Adjust 'public' to your actual frontend build directory if different (e.g., 'build', 'dist')
app.use(express.static(path.join(__dirname, 'public')));


// ==================== Routes ====================
// Example routes (uncomment and add your actual route imports)
// app.use('/api/v1/auth', require('./routes/authRoutes'));
// app.use('/api/v1/users', require('./routes/userRoutes'));
// app.use('/api/v1/products', require('./routes/productRoutes'));
// app.use('/api/v1/orders', require('./routes/orderRoutes'));

// GraphQL
const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  context: ({ req, res }) => ({ req, res, config, logger }), // Pass config and logger to GraphQL context
  formatError: (error) => {
    logger.error('GraphQL Error:', error);
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(error);
    }
    return error;
  },
  plugins: [{
    async serverWillStart() {
      // Connect to MongoDB using config's URI (MONGODB_URI)
      try {
        await mongoose.connect(config.db.uri, config.db.options);
        logger.info('Connected to MongoDB Atlas'); // Or just "Connected to MongoDB"
      } catch (err) {
        logger.error('Error connecting to MongoDB:', err);
        process.exit(1); // Exit if DB connection fails, as it's critical
      }
      return {
        async serverWillStop() {
          // Disconnect from MongoDB on server stop
          await mongoose.disconnect();
          logger.info('Disconnected from MongoDB Atlas');
        }
      };
    }
  }]
});

// For frontend routing (if using a single-page application and serving from backend)
// This should be placed after all API routes
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'index.html'));
});

// Fallback for any unhandled routes/requests
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Centralized error handling
app.use(errorHandler);

// ==================== Server Startup ====================
async function startServer() {
  await apolloServer.start();
  apolloServer.applyMiddleware({
    app,
    path: '/graphql',
    cors: false // Apollo Server's CORS is disabled, global CORS middleware handles it
  });

  createTerminus(httpServer, {
    signals: ['SIGTERM', 'SIGINT'], // Listen for these signals for graceful shutdown
    timeout: 10000, // Timeout for graceful shutdown
    healthChecks: { '/health': () => Promise.resolve() }, // Basic health check endpoint
    onSignal: async () => {
      logger.info('🛑 Shutting down...');
      // Perform cleanup operations before shutting down
      await Promise.all([
        mongoose.connection.close(), // Close MongoDB connection
        apolloServer.stop(), // Stop Apollo Server
        process.env.SENTRY_DSN ? Sentry.close(2000) : Promise.resolve() // Close Sentry if active
      ]);
    },
    onShutdown: () => logger.info('✅ Clean shutdown complete')
  });

  httpServer.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`🚀 GraphQL: http://localhost:${PORT}${apolloServer.graphqlPath}`);
  });
}

// Call startServer to begin the application
startServer();

// ==================== Process Handlers ====================
// Catch unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
  // It's good practice to exit for unhandled rejections in production to prevent unexpected state
  // process.exit(1);
});

// Catch uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
  // Must exit for uncaught exceptions, as the application is in an unstable state
  process.exit(1);
});

module.exports = app;