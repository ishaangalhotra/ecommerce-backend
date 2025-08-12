// Fix for Express Slow Down Warning (around line 265)
// Replace the existing slowDown configuration with:

if (config.RATE_LIMIT_ENABLED) {
  app.use(rateLimit({ 
    windowMs: config.RATE_LIMIT_WINDOW_MS, 
    max: config.RATE_LIMIT_MAX,
    message: 'Too many requests from this IP, please try again later.'
  }));
  
  // Fixed slowDown configuration - removes the deprecation warning
  app.use(slowDown({ 
    windowMs: config.RATE_LIMIT_WINDOW_MS, 
    delayAfter: 100, 
    delayMs: 50, // Fixed value instead of function
    maxDelayMs: 20000,
    validate: { delayMs: false } // Disable validation warning
  }));
}

// Redis Configuration Fix
// Add this to your Config class build() method around line 60:

build() {
  return {
    NODE_ENV: this.env.NODE_ENV || 'development',
    PORT: parseInt(this.env.PORT, 10) || 10000,
    HOST: this.env.HOST || '0.0.0.0',
    ENABLE_CLUSTER: (this.env.ENABLE_CLUSTER_MODE === 'true') || false,
    MAX_WORKERS: Math.max(1, Math.min(os.cpus().length, parseInt(this.env.CLUSTER_WORKERS || '0', 10) || os.cpus().length)),
    MONGODB_URI: this.env.MONGODB_URI || this.env.MONGO_URI,
    JWT_SECRET: this.env.JWT_SECRET,
    SESSION_SECRET: this.env.SESSION_SECRET,
    
    // Enhanced Redis configuration
    REDIS_URL: this.env.REDIS_URL,
    REDIS_ENABLED: this.env.REDIS_ENABLED === 'true' && !this.env.DISABLE_REDIS && this.env.REDIS_URL,
    
    ENABLE_HELMET: this.env.ENABLE_HELMET === 'true' || this.env.HELMET_ENABLED === 'true',
    ENABLE_COMPRESSION: this.env.ENABLE_COMPRESSION === 'true',
    RATE_LIMIT_ENABLED: this.env.RATE_LIMIT_ENABLED !== 'false',
    RATE_LIMIT_WINDOW_MS: parseInt(this.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    RATE_LIMIT_MAX: parseInt(this.env.RATE_LIMIT_MAX, 10) || 1000,
    LOG_DIR: this.env.LOG_DIR || './logs',
    LOG_LEVEL: this.env.LOG_LEVEL || 'info',
    PROMETHEUS: this.env.ENABLE_METRICS === 'true' || false,
    GC_ENABLED: typeof global.gc === 'function',
    
    // Memory optimization settings
    HEAP_THRESHOLD: parseFloat(this.env.HEAP_THRESHOLD) || 0.7, // Trigger GC at 70% heap usage
    RESOURCE_MONITOR_INTERVAL: parseInt(this.env.RESOURCE_MONITOR_INTERVAL_MS, 10) || 10000
  };
}

// Redis Client Setup (add after the Database class)
class RedisManager {
  static client = null;
  static mockClient = {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    exists: async () => 0,
    expire: async () => 1,
    quit: async () => 'OK'
  };

  static async initialize() {
    if (!config.REDIS_URL) {
      logger.info('Redis URL not provided, using mock client');
      this.client = this.mockClient;
      return this.mockClient;
    }

    try {
      const redis = require('redis');
      this.client = redis.createClient({
        url: config.REDIS_URL,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            logger.error('Redis server connection refused');
            return new Error('Redis server connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.client.on('error', (err) => {
        logger.error('Redis client error', err);
        this.client = this.mockClient;
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      logger.warn('Redis connection failed, using mock client', { error: error.message });
      this.client = this.mockClient;
      return this.mockClient;
    }
  }

  static getClient() {
    return this.client || this.mockClient;
  }

  static async close() {
    if (this.client && this.client !== this.mockClient) {
      try {
        await this.client.quit();
        logger.info('Redis connection closed');
      } catch (error) {
        logger.error('Error closing Redis connection', error);
      }
    }
  }
}

// Enhanced ResourceMonitor class (replace existing one)
class ResourceMonitor {
  constructor(opts = {}) {
    this.interval = opts.interval || config.RESOURCE_MONITOR_INTERVAL;
    this.pid = process.pid;
    this.timer = null;
    this.observer = null;
    this.heapThreshold = config.HEAP_THRESHOLD;
  }

  start() {
    const obs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const e of entries) {
        logger.debug('eventloop-lag', { name: e.name, duration: e.duration });
      }
    });
    obs.observe({ entryTypes: ['function'] });
    this.observer = obs;

    this.timer = setInterval(async () => {
      try {
        const stats = await pidusage(this.pid);
        const memMB = Math.round(stats.memory / 1024 / 1024);
        const cpu = Number(stats.cpu.toFixed(1));
        const mu = process.memoryUsage();
        const heapUsedMB = Math.round(mu.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(mu.heapTotal / 1024 / 1024);
        const rssMB = Math.round(mu.rss / 1024 / 1024);

        const start = performance.now();
        setImmediate(() => {
          const lag = Math.max(0, performance.now() - start);
          logger.info('resource-stats', {
            pid: this.pid,
            cpu,
            memMB,
            heapUsedMB,
            heapTotalMB,
            rssMB,
            eventLoopLagMs: Math.round(lag)
          });

          // More intelligent GC triggering
          const heapUsageRatio = heapUsedMB / heapTotalMB;
          if (config.GC_ENABLED && heapUsageRatio > this.heapThreshold) {
            logger.warn('high-heap-usage, attempting gc', { 
              heapUsedMB, 
              heapTotalMB, 
              usageRatio: heapUsageRatio.toFixed(2) 
            });
            try { 
              global.gc(); 
              logger.debug('gc-triggered-successfully');
            } catch (e) { 
              logger.debug('gc-failed', e.message); 
            }
          }
        });
      } catch (e) {
        logger.error('resource-monitor-error', e);
      }
    }, this.interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.observer) this.observer.disconnect();
  }
}

// Enhanced Database connection with better error handling
class Database {
  static async connect(uri) {
    if (!uri) {
      logger.warn('No MONGODB_URI provided; skipping DB connect');
      return;
    }

    const opts = {
      maxPoolSize: parseInt(process.env.DB_POOL_SIZE, 10) || 10,
      serverSelectionTimeoutMS: parseInt(process.env.DB_CONNECT_TIMEOUT_MS, 10) || 30000,
      socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT_MS, 10) || 45000,
      family: 4,
      // Prevent duplicate index warnings
      autoIndex: false,
      bufferCommands: false,
      bufferMaxEntries: 0
    };

    let attempts = 0;
    const maxRetries = parseInt(process.env.DB_MAX_RETRY_ATTEMPTS, 10) || 5;
    const baseDelay = parseInt(process.env.DB_RETRY_DELAY_MS, 10) || 2000;

    // Suppress mongoose warnings
    mongoose.set('strictQuery', false);
    
    while (attempts < maxRetries) {
      try {
        await mongoose.connect(uri, opts);
        logger.info('Database connected', { 
          host: mongoose.connection.host, 
          name: mongoose.connection.name 
        });
        
        mongoose.connection.on('error', (err) => logger.error('mongoose-error', err));
        mongoose.connection.on('disconnected', () => logger.warn('mongoose-disconnected'));
        mongoose.connection.on('reconnected', () => logger.info('mongoose-reconnected'));
        return;
      } catch (err) {
        attempts += 1;
        const delay = baseDelay * Math.pow(2, attempts - 1);
        logger.warn('db-connect-attempt-failed', { attempt: attempts, err: err.message, retryInMs: delay });
        if (attempts >= maxRetries) throw err;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  static async health() {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return { status: 'down', readyState: mongoose.connection?.readyState };
    }
    try {
      const start = Date.now();
      await mongoose.connection.db.admin().ping();
      return { 
        status: 'up', 
        pingMs: Date.now() - start,
        readyState: mongoose.connection.readyState,
        host: mongoose.connection.host,
        name: mongoose.connection.name
      };
    } catch (e) {
      return { status: 'down', error: e.message, readyState: mongoose.connection.readyState };
    }
  }
}

// Updated createApp function with Redis initialization
async function createApp() {
  const app = express();

  // Initialize Redis
  await RedisManager.initialize();

  // Request ID and logging setup
  app.use((req, res, next) => {
    req.id = req.get('X-Request-Id') || uuidv4();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // Trust proxy configuration
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY === '1');
  }

  // Request logging
  if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
    app.use(morgan('combined', { 
      stream: { write: (msg) => logger.info('http-request', { message: msg.trim() }) } 
    }));
  }

  // Security and parsing middleware
  if (config.ENABLE_HELMET) {
    app.use(helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
    }));
  }

  app.use(express.json({ 
    limit: process.env.MAX_REQUEST_SIZE || '10mb',
    strict: false
  }));
  app.use(express.urlencoded({ 
    extended: true, 
    limit: process.env.MAX_REQUEST_SIZE || '10mb' 
  }));
  app.use(cookieParser(process.env.COOKIE_SECRET));

  if (config.ENABLE_COMPRESSION) {
    app.use(compression({
      threshold: 1024,
      level: 6
    }));
  }

  // CORS configuration
  if (process.env.ENABLE_CORS !== 'false') {
    const corsOpts = { 
      origin: (origin, cb) => cb(null, true), 
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
    };
    app.use(cors(corsOpts));
  }

  // Prometheus metrics
  if (config.PROMETHEUS) {
    app.use(metricsMiddleware);
  }

  // Rate limiting with fixed configuration
  if (config.RATE_LIMIT_ENABLED) {
    app.use(rateLimit({ 
      windowMs: config.RATE_LIMIT_WINDOW_MS, 
      max: config.RATE_LIMIT_MAX,
      message: { error: 'Too many requests from this IP, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false
    }));
    
    // Fixed slowDown configuration
    app.use(slowDown({ 
      windowMs: config.RATE_LIMIT_WINDOW_MS, 
      delayAfter: 100, 
      delayMs: 50, // Fixed delay instead of function
      maxDelayMs: 20000,
      validate: { delayMs: false }
    }));
  }

  // Health endpoint with enhanced checks
  app.get('/health', async (req, res) => {
    try {
      const db = await Database.health();
      const redis = RedisManager.getClient();
      
      let redisStatus = 'up';
      try {
        if (redis !== RedisManager.mockClient) {
          await redis.ping();
        } else {
          redisStatus = 'mock';
        }
      } catch (e) {
        redisStatus = 'down';
      }

      const status = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: config.NODE_ENV,
        version: process.env.npm_package_version || '1.0.0',
        db,
        redis: { status: redisStatus },
        uptime: process.uptime(),
        memory: process.memoryUsage()
      };

      const httpStatus = (db.status === 'up' && redisStatus !== 'down') ? 200 : 503;
      return res.status(httpStatus).json(status);
    } catch (error) {
      logger.error('health-check-error', error);
      return res.status(503).json({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Metrics endpoint
  if (!config.PROMETHEUS) {
    app.get('/metrics', (req, res) => res.status(200).send('# Metrics disabled\n'));
  }

  // API routes
  const apiBase = process.env.API_BASE_PATH || '/api/v1';

  // Core auth route
  try {
    const authRouter = require('./routes/auth');
    app.use(path.join(apiBase, 'auth'), authRouter);
    logger.info('mounted-core-route', { route: 'auth' });
  } catch (e) {
    logger.warn('auth-route-missing', { error: e.message });
  }

  // Lazy loading middleware for optional routes
  app.use(apiBase, async (req, res, next) => {
    if (!app.locals._lazyLoaded) {
      app.locals._lazyLoaded = true;
      
      // Load optional routes asynchronously
      setImmediate(() => {
        const optional = [
          { mount: 'products', mod: './routes/products' },
          { mount: 'orders', mod: './routes/orders' },
          { mount: 'users', mod: './routes/users' },
          { mount: 'categories', mod: './routes/categories' },
          { mount: 'reviews', mod: './routes/reviews' }
        ];
        
        for (const r of optional) {
          try {
            const mod = require(r.mod);
            app.use(path.join(apiBase, r.mount), mod);
            logger.info('mounted-optional-route', { route: r.mount });
          } catch (err) {
            logger.debug('optional-route-missing', { route: r.mod, error: err.message });
          }
        }
      });
    }
    next();
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ 
      error: 'Not found',
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    const errorId = uuidv4();
    logger.error('unhandled-error', { 
      errorId,
      message: err.message, 
      stack: err.stack,
      url: req.url,
      method: req.method,
      ip: req.ip
    });

    res.status(err.status || 500).json({ 
      error: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message,
      errorId,
      timestamp: new Date().toISOString()
    });
  });

  return app;
}

// Enhanced shutdown function
const shutdown = async (signal) => {
  if (global._shuttingDown) return;
  global._shuttingDown = true;
  
  logger.info('shutdown-init', { signal, pid: process.pid });

  // Close server
  if (global._server) {
    global._server.close(err => {
      if (err) logger.error('server-close-error', err);
      else logger.info('server-closed');
    });
  }

  // Stop monitoring
  if (global._monitor) {
    global._monitor.stop();
    logger.info('resource-monitor-stopped');
  }

  // Close database
  try {
    await mongoose.connection.close(false);
    logger.info('mongoose-closed');
  } catch (e) {
    logger.warn('mongoose-close-failed', { error: e.message });
  }

  // Close Redis
  try {
    await RedisManager.close();
  } catch (e) {
    logger.warn('redis-close-failed', { error: e.message });
  }

  // Final cleanup
  setTimeout(() => {
    logger.info('shutdown-complete', { signal });
    process.exit(0);
  }, parseInt(process.env.SHUTDOWN_WAIT_MS, 10) || 5000);
};

// Updated start function
async function start() {
  try {
    // Handle clustering
    if (config.ENABLE_CLUSTER && cluster.isPrimary) {
      logger.info('cluster-master-starting', { 
        workers: config.MAX_WORKERS,
        pid: process.pid 
      });
      
      for (let i = 0; i < config.MAX_WORKERS; i++) {
        cluster.fork();
      }

      cluster.on('exit', (worker, code, signal) => {
        logger.warn('worker-exit', { 
          pid: worker.process.pid, 
          code, 
          signal 
        });
        setTimeout(() => cluster.fork(), 1000);
      });
      
      return;
    }

    // Create and configure app
    const app = await createApp();
    const server = http.createServer(app);
    global._server = server;

    // Connect to database
    try {
      await Database.connect(config.MONGODB_URI);
    } catch (e) {
      logger.error('database-connection-failed', { error: e.message });
      if (config.NODE_ENV === 'production') throw e;
    }

    // Start resource monitoring
    const monitor = new ResourceMonitor({ 
      interval: config.RESOURCE_MONITOR_INTERVAL 
    });
    monitor.start();
    global._monitor = monitor;

    // Start server
    server.listen(config.PORT, config.HOST, () => {
      logger.info('server-started', {
        host: config.HOST,
        port: config.PORT,
        pid: process.pid,
        env: config.NODE_ENV,
        cluster: config.ENABLE_CLUSTER ? 'worker' : 'standalone'
      });
    });

    // Setup graceful shutdown
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
      logger.error('uncaughtException', { 
        message: err.message, 
        stack: err.stack 
      });
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('unhandledRejection', { 
        reason: reason?.toString?.() || reason,
        promise: promise?.toString?.() || 'Promise'
      });
    });

  } catch (error) {
    logger.error('startup-failed', { 
      error: error.message, 
      stack: error.stack 
    });
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  start().catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}