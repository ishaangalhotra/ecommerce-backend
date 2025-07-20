#!/usr/bin/env node

'use strict';

/**
 * Enterprise-Grade Node.js Application Bootstrapper
 * 
 * Key Features:
 * 1. Comprehensive error handling with graceful degradation
 * 2. Production-ready cluster mode with intelligent worker management
 * 3. Advanced health monitoring and observability
 * 4. Security-first middleware stack
 * 5. Dependency lifecycle management
 * 6. Configuration validation and environment awareness
 * 7. Structured logging with context
 * 8. Performance optimization out-of-the-box
 */

// Core dependencies
const express = require('express');
const http = require('http');
const cluster = require('cluster');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const util = require('util');

// Security middleware
const helmet = require('helmet');
const cors = require('cors');
const hpp = require('hpp');
const xss = require('xss-clean');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const csrf = require('csurf');
const slowDown = require('express-slow-down');

// Monitoring and diagnostics
const responseTime = require('response-time');
const promBundle = require('express-prom-bundle');
const pidusage = require('pidusage');

// Configuration and utilities
const config = require('./config/config');
const logger = require('./utils/logger');
const { connectDB, disconnectDB } = require('./config/database');
const { initializeRedis, shutdownRedis } = require('./utils/redis');
const { validateConfig } = require('./config/validator');
const { setupTracing } = require('./utils/tracing');

// Application components
const routes = require('./routes');
const { setupSwagger } = require('./docs/swagger');
const { setupSocketIO } = require('./services/socket');
const { initializeWorkers } = require('./services/worker');

// Constants
const TERMINATION_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];
const MAX_SHUTDOWN_TIME_MS = 10000;
const HEALTH_CHECK_INTERVAL_MS = 30000;

class Application {
    constructor() {
        this.app = express();
        this.server = null;
        this.socket = null;
        this.connections = new Set();
        this.healthStatus = 'starting';
        this.metrics = {
            startTime: Date.now(),
            requests: 0,
            errors: 0
        };
        this.dependencies = {
            database: false,
            redis: false,
            externalServices: {}
        };
        this.shutdownHandlers = [];
    }

    /**
     * Initialize the application with comprehensive setup
     */
    async initialize() {
        try {
            this.validateEnvironment();
            await this.setupInfrastructure();
            this.configureApplication();
            this.setupMonitoring();
            this.setupSecurity();
            this.setupRoutes();
            this.setupErrorHandlers();
            this.setupGracefulShutdown();
            
            logger.info('Application initialized successfully', {
                environment: config.env,
                nodeVersion: process.version,
                features: this.getEnabledFeatures()
            });
            
            this.healthStatus = 'healthy';
        } catch (error) {
            this.healthStatus = 'unhealthy';
            logger.fatal('Application initialization failed', {
                error: this.sanitizeError(error),
                stack: error.stack
            });
            await this.emergencyShutdown();
        }
    }

    /**
     * Validate environment and configuration
     */
    validateEnvironment() {
        // Check Node.js version
        const [major] = process.version.slice(1).split('.').map(Number);
        if (major < 16) {
            throw new Error(`Node.js version 16 or higher required (current: ${process.version})`);
        }

        // Validate configuration
        const configErrors = validateConfig(config);
        if (configErrors.length > 0) {
            throw new Error(`Invalid configuration: ${configErrors.join(', ')}`);
        }

        // Check required environment variables
        if (!process.env.NODE_ENV) {
            logger.warn('NODE_ENV not set, defaulting to development');
            process.env.NODE_ENV = 'development';
        }
    }

    /**
     * Setup infrastructure components
     */
    async setupInfrastructure() {
        try {
            // Setup distributed tracing if enabled
            if (config.tracing.enabled) {
                await setupTracing();
            }

            // Initialize database with retry logic
            await this.retryOperation(
                () => connectDB(),
                {
                    retries: 3,
                    delay: 1000,
                    description: 'database connection'
                }
            );
            this.dependencies.database = true;

            // Initialize Redis if configured
            if (config.redis.enabled) {
                await this.retryOperation(
                    () => initializeRedis(),
                    {
                        retries: 2,
                        delay: 500,
                        description: 'Redis connection'
                    }
                );
                this.dependencies.redis = true;
            }

            // Initialize background workers
            if (config.workers.enabled) {
                await initializeWorkers();
            }

            // Setup upload directories if needed
            if (config.features.fileUploads) {
                await this.ensureUploadDirectories();
            }

        } catch (error) {
            logger.error('Infrastructure setup failed', {
                error: this.sanitizeError(error)
            });
            throw error;
        }
    }

    /**
     * Configure Express application
     */
    configureApplication() {
        // Application settings
        this.app.set('trust proxy', config.security.trustProxyLevel);
        this.app.set('x-powered-by', false);
        this.app.set('case sensitive routing', true);
        this.app.set('strict routing', true);
        this.app.set('env', config.env);

        // Trust proxy headers
        if (config.security.trustProxy) {
            this.app.enable('trust proxy');
        }

        // Global middleware
        this.app.use(this.requestContextMiddleware());
        this.app.use(this.requestLogger());
        this.app.use(express.json({
            limit: config.server.maxBodySize,
            verify: (req, res, buf) => {
                req.rawBody = buf;
            }
        }));
        this.app.use(express.urlencoded({
            extended: true,
            limit: config.server.maxBodySize
        }));
    }

    /**
     * Setup monitoring and metrics
     */
    setupMonitoring() {
        // Prometheus metrics
        if (config.monitoring.prometheus.enabled) {
            const metricsMiddleware = promBundle({
                includeMethod: true,
                includePath: true,
                customLabels: { 
                    app: config.app.name,
                    environment: config.env 
                },
                promClient: { 
                    collectDefaultMetrics: {
                        timeout: config.monitoring.prometheus.scrapeInterval
                    }
                }
            });
            this.app.use(metricsMiddleware);
        }

        // Response time headers
        if (config.monitoring.responseTime) {
            this.app.use(responseTime());
        }

        // Health check endpoint
        this.app.get('/health', this.healthCheckHandler.bind(this));
        this.app.get('/health/liveness', (req, res) => res.status(200).end());
        this.app.get('/health/readiness', this.readinessCheck.bind(this));

        // Metrics endpoint
        if (config.monitoring.metricsEndpoint) {
            this.app.get('/metrics', protect(), this.metricsHandler.bind(this));
        }

        // Periodic health checks
        if (config.monitoring.periodicHealthChecks) {
            this.setupPeriodicHealthChecks();
        }
    }

    /**
     * Setup security middleware
     */
    setupSecurity() {
        // Security headers
        this.app.use(helmet({
            contentSecurityPolicy: config.security.csp.enabled ? {
                directives: {
                    ...config.security.csp.directives,
                    reportUri: config.security.csp.reportUri
                }
            } : false,
            crossOriginEmbedderPolicy: config.security.coep,
            crossOriginResourcePolicy: { policy: 'same-site' },
            frameguard: { action: 'deny' }
        }));

        // CORS configuration
        this.app.use(cors(config.security.cors));

        // Rate limiting
        if (config.security.rateLimiting.enabled) {
            this.app.use(rateLimit({
                windowMs: config.security.rateLimiting.windowMs,
                max: config.security.rateLimiting.max,
                standardHeaders: true,
                legacyHeaders: false,
                skip: (req) => {
                    // Skip rate limiting for health checks and internal IPs
                    return req.path.startsWith('/health') || 
                           config.security.rateLimiting.whitelist.includes(req.ip);
                }
            }));

            // Slow down responses after certain threshold
            this.app.use(slowDown({
                windowMs: config.security.rateLimiting.slowDownWindowMs,
                delayAfter: config.security.rateLimiting.slowDownAfter,
                delayMs: (hits) => hits * config.security.rateLimiting.slowDownDelay
            }));
        }

        // Data sanitization
        this.app.use(mongoSanitize());
        this.app.use(xss());
        this.app.use(hpp());

        // CSRF protection for session-based apps
        if (config.security.csrf.enabled) {
            this.app.use(csrf({
                cookie: config.security.csrf.cookie
            }));
            this.app.use((req, res, next) => {
                res.locals.csrfToken = req.csrfToken();
                next();
            });
        }
    }

    /**
     * Setup application routes
     */
    setupRoutes() {
        // API routes
        this.app.use(config.api.prefix, routes);

        // Static files
        if (config.server.serveStatic) {
            this.app.use(express.static(config.server.staticDir, {
                maxAge: config.server.staticCacheControl,
                setHeaders: (res, path) => {
                    if (path.endsWith('.br')) {
                        res.set('Content-Encoding', 'br');
                    } else if (path.endsWith('.gz')) {
                        res.set('Content-Encoding', 'gzip');
                    }
                }
            }));
        }

        // API documentation
        if (config.documentation.enabled) {
            setupSwagger(this.app);
        }

        // Default route
        this.app.get('/', (req, res) => {
            res.json({
                app: config.app.name,
                version: config.app.version,
                environment: config.env,
                status: 'running',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                links: {
                    documentation: config.documentation.enabled ? 
                        `${config.app.baseUrl}/docs` : undefined,
                    health: `${config.app.baseUrl}/health`,
                    metrics: config.monitoring.metricsEndpoint ? 
                        `${config.app.baseUrl}/metrics` : undefined
                }
            });
        });
    }

    /**
     * Setup error handlers
     */
    setupErrorHandlers() {
        // 404 handler
        this.app.use((req, res, next) => {
            res.status(404).json({
                error: 'Not Found',
                message: `Route ${req.method} ${req.path} not found`,
                requestId: req.id
            });
        });

        // Error handler
        this.app.use((err, req, res, next) => {
            this.metrics.errors++;
            
            const statusCode = err.statusCode || 500;
            const errorResponse = {
                error: err.name || 'Internal Server Error',
                message: err.message,
                requestId: req.id,
                timestamp: new Date().toISOString()
            };

            // Include stack trace in development
            if (config.env === 'development') {
                errorResponse.stack = err.stack;
            }

            // Log the error
            const logContext = {
                error: this.sanitizeError(err),
                request: {
                    method: req.method,
                    path: req.path,
                    params: req.params,
                    query: req.query,
                    ip: req.ip,
                    user: req.user ? req.user.id : undefined
                }
            };

            if (statusCode >= 500) {
                logger.error('Server error', logContext);
            } else {
                logger.warn('Client error', logContext);
            }

            res.status(statusCode).json(errorResponse);
        });
    }

    /**
     * Start the application server
     */
    async start() {
        return new Promise((resolve, reject) => {
            try {
                // Create HTTP server
                this.server = http.createServer(this.app);

                // Setup Socket.IO if enabled
                if (config.socketio.enabled) {
                    this.socket = setupSocketIO(this.server);
                }

                // Track connections for graceful shutdown
                this.server.on('connection', (conn) => {
                    this.connections.add(conn);
                    conn.on('close', () => this.connections.delete(conn));
                });

                // Start listening
                this.server.listen(config.server.port, config.server.host, () => {
                    const startupTime = Date.now() - this.metrics.startTime;
                    
                    logger.info('Server started successfully', {
                        host: config.server.host,
                        port: config.server.port,
                        protocol: 'http',
                        environment: config.env,
                        pid: process.pid,
                        startupTime: `${startupTime}ms`,
                        memoryUsage: this.getMemoryUsage(),
                        workers: config.workers.enabled ? config.workers.count : 1
                    });

                    resolve();
                });

                this.server.on('error', (err) => {
                    logger.error('Server error', {
                        error: this.sanitizeError(err),
                        code: err.code
                    });
                    reject(err);
                });

            } catch (error) {
                logger.fatal('Failed to start server', {
                    error: this.sanitizeError(error)
                });
                reject(error);
            }
        });
    }

    /**
     * Health check handler
     */
    async healthCheckHandler(req, res) {
        const checkStartTime = Date.now();
        const checks = {};
        let status = 'healthy';

        // Database check
        checks.database = await this.checkDatabase();
        if (!checks.database.healthy) status = 'degraded';

        // Redis check
        if (config.redis.enabled) {
            checks.redis = await this.checkRedis();
            if (!checks.redis.healthy) status = 'degraded';
        }

        // External services checks
        if (config.monitoring.checkExternalServices) {
            checks.externalServices = await this.checkExternalServices();
            if (checks.externalServices.some(s => !s.healthy)) {
                status = 'degraded';
            }
        }

        // System resource checks
        checks.system = this.checkSystemResources();
        if (!checks.system.healthy) status = 'degraded';

        // Determine HTTP status code
        const httpStatus = status === 'healthy' ? 200 : 
                          (status === 'degraded' ? 206 : 503);

        // Prepare response
        const response = {
            status,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            checks,
            responseTime: Date.now() - checkStartTime,
            version: config.app.version,
            environment: config.env
        };

        res.status(httpStatus).json(response);
    }

    /**
     * Readiness check for Kubernetes
     */
    async readinessCheck(req, res) {
        const checks = {
            database: await this.checkDatabase(),
            system: this.checkSystemResources()
        };

        const isReady = checks.database.healthy && checks.system.healthy;
        res.status(isReady ? 200 : 503).json({
            ready: isReady,
            checks
        });
    }

    /**
     * Metrics handler
     */
    async metricsHandler(req, res) {
        try {
            // Get process metrics
            const processStats = await pidusage(process.pid);
            
            // System metrics
            const systemMetrics = {
                cpu: {
                    count: os.cpus().length,
                    usage: processStats.cpu,
                    load: os.loadavg()
                },
                memory: {
                    total: os.totalmem(),
                    free: os.freemem(),
                    process: {
                        rss: processStats.memory,
                        heapTotal: process.memoryUsage().heapTotal,
                        heapUsed: process.memoryUsage().heapUsed,
                        external: process.memoryUsage().external
                    }
                },
                uptime: process.uptime(),
                activeConnections: this.connections.size
            };

            // Application metrics
            const appMetrics = {
                requests: this.metrics.requests,
                errors: this.metrics.errors,
                responseTimes: this.metrics.responseTimes,
                throughput: this.calculateThroughput()
            };

            res.json({
                timestamp: new Date().toISOString(),
                system: systemMetrics,
                application: appMetrics,
                dependencies: this.dependencies
            });
        } catch (error) {
            logger.error('Failed to gather metrics', {
                error: this.sanitizeError(error)
            });
            res.status(500).json({ error: 'Failed to gather metrics' });
        }
    }

    /**
     * Setup graceful shutdown handlers
     */
    setupGracefulShutdown() {
        // Register shutdown handlers
        TERMINATION_SIGNALS.forEach(signal => {
            process.on(signal, () => this.gracefulShutdown(signal));
        });

        // Register custom shutdown handlers
        this.registerShutdownHandler('database', async () => {
            if (this.dependencies.database) {
                await disconnectDB();
                logger.info('Database connection closed');
            }
        });

        this.registerShutdownHandler('redis', async () => {
            if (this.dependencies.redis) {
                await shutdownRedis();
                logger.info('Redis connection closed');
            }
        });

        // Uncaught exceptions and rejections
        process.on('uncaughtException', (error) => {
            logger.fatal('Uncaught exception', {
                error: this.sanitizeError(error),
                stack: error.stack
            });
            this.gracefulShutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.fatal('Unhandled rejection', {
                reason: this.sanitizeError(reason),
                promise
            });
            this.gracefulShutdown('unhandledRejection');
        });
    }

    /**
     * Graceful shutdown procedure
     */
    async gracefulShutdown(signal) {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        
        logger.info(`Initiating graceful shutdown (${signal})`, {
            activeConnections: this.connections.size
        });

        // Set health status to shutting down
        this.healthStatus = 'shutting_down';

        // Start shutdown timer
        const shutdownTimer = setTimeout(() => {
            logger.error('Graceful shutdown timeout exceeded, forcing exit');
            process.exit(1);
        }, MAX_SHUTDOWN_TIME_MS);

        try {
            // Stop accepting new connections
            if (this.server) {
                this.server.close(() => {
                    logger.info('HTTP server closed');
                });
            }

            // Close existing connections
            for (const conn of this.connections) {
                conn.destroy();
            }

            // Execute registered shutdown handlers
            await this.executeShutdownHandlers();

            // Clear the shutdown timer
            clearTimeout(shutdownTimer);

            logger.info('Graceful shutdown completed');
            process.exit(0);
        } catch (error) {
            logger.error('Error during graceful shutdown', {
                error: this.sanitizeError(error)
            });
            process.exit(1);
        }
    }

    /**
     * Emergency shutdown procedure
     */
    async emergencyShutdown() {
        try {
            logger.warn('Initiating emergency shutdown');
            
            // Attempt to close database connection
            try {
                await disconnectDB();
            } catch (dbError) {
                logger.error('Failed to close database connection', {
                    error: this.sanitizeError(dbError)
                });
            }

            // Force exit
            process.exit(1);
        } catch (finalError) {
            console.error('Fatal error during emergency shutdown:', finalError);
            process.exit(1);
        }
    }

    /**
     * Helper Methods
     */

    requestContextMiddleware() {
        return (req, res, next) => {
            // Generate request ID
            req.id = crypto.randomUUID();
            res.set('X-Request-ID', req.id);

            // Add start time for latency calculation
            req._startTime = process.hrtime();

            // Add to metrics
            this.metrics.requests++;

            next();
        };
    }

    requestLogger() {
        return (req, res, next) => {
            const start = process.hrtime();

            res.on('finish', () => {
                const duration = process.hrtime(start);
                const durationMs = duration[0] * 1000 + duration[1] / 1000000;
                
                logger.http('Request completed', {
                    method: req.method,
                    path: req.path,
                    status: res.statusCode,
                    duration: durationMs.toFixed(2),
                    ip: req.ip,
                    userAgent: req.headers['user-agent'],
                    referrer: req.headers['referer']
                });
            });

            next();
        };
    }

    async checkDatabase() {
        try {
            const mongoose = require('mongoose');
            await mongoose.connection.db.admin().ping();
            return { healthy: true };
        } catch (error) {
            return { 
                healthy: false,
                error: this.sanitizeError(error).message
            };
        }
    }

    async checkRedis() {
        try {
            const redis = require('./utils/redis');
            await redis.ping();
            return { healthy: true };
        } catch (error) {
            return { 
                healthy: false,
                error: this.sanitizeError(error).message
            };
        }
    }

    async checkExternalServices() {
        // Implement checks for critical external services
        return [];
    }

    checkSystemResources() {
        const memoryUsage = process.memoryUsage();
        const memoryThreshold = config.monitoring.memoryThreshold || 0.9;
        const isMemoryCritical = memoryUsage.heapUsed / memoryUsage.heapTotal > memoryThreshold;

        return {
            healthy: !isMemoryCritical,
            memory: {
                used: memoryUsage.heapUsed,
                total: memoryUsage.heapTotal,
                percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal * 100).toFixed(2)
            },
            load: os.loadavg()[0] // 1-minute load average
        };
    }

    calculateThroughput() {
        const uptime = process.uptime();
        return {
            requestsPerSecond: (this.metrics.requests / uptime).toFixed(2),
            errorRate: (this.metrics.errors / this.metrics.requests * 100).toFixed(2) + '%'
        };
    }

    getMemoryUsage() {
        const usage = process.memoryUsage();
        return {
            rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            external: `${(usage.external / 1024 / 1024).toFixed(2)} MB`
        };
    }

    getEnabledFeatures() {
        return Object.entries(config.features)
            .filter(([_, enabled]) => enabled)
            .map(([feature]) => feature);
    }

    sanitizeError(error) {
        if (!(error instanceof Error)) {
            return { message: String(error) };
        }

        // Remove sensitive information from errors
        const cleanError = {
            name: error.name,
            message: error.message,
            stack: config.env === 'production' ? undefined : error.stack
        };

        // Special handling for certain error types
        if (error.code) {
            cleanError.code = error.code;
        }

        return cleanError;
    }

    async retryOperation(operation, options = {}) {
        const { retries = 3, delay = 1000, description = 'operation' } = options;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                if (attempt === retries) throw error;
                
                logger.warn(`Retrying ${description} (attempt ${attempt}/${retries})`, {
                    error: this.sanitizeError(error).message
                });
                
                await new Promise(resolve => setTimeout(resolve, delay * attempt));
            }
        }
    }

    async ensureUploadDirectories() {
        const fs = require('fs').promises;
        const mkdir = util.promisify(require('mkdirp'));
        
        try {
            await mkdir(config.uploads.directory);
            logger.info('Upload directory verified');
        } catch (error) {
            throw new Error(`Failed to create upload directory: ${error.message}`);
        }
    }

    setupPeriodicHealthChecks() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                const health = await this.healthCheckHandler({}, {
                    status: () => this,
                    json: () => {}
                });
                
                if (health.status !== 'healthy') {
                    logger.warn('Periodic health check failed', health);
                }
            } catch (error) {
                logger.error('Periodic health check error', {
                    error: this.sanitizeError(error)
                });
            }
        }, HEALTH_CHECK_INTERVAL_MS);

        // Cleanup on shutdown
        this.registerShutdownHandler('healthCheckInterval', () => {
            clearInterval(this.healthCheckInterval);
        });
    }

    registerShutdownHandler(name, handler) {
        this.shutdownHandlers.push({ name, handler });
    }

    async executeShutdownHandlers() {
        for (const { name, handler } of this.shutdownHandlers) {
            try {
                logger.info(`Running shutdown handler: ${name}`);
                await handler();
            } catch (error) {
                logger.error(`Shutdown handler failed: ${name}`, {
                    error: this.sanitizeError(error)
                });
            }
        }
    }
}

class ClusterManager {
    constructor() {
        this.workers = new Map();
        this.restartCounts = new Map();
        this.maxRestarts = config.cluster.maxRestarts || 5;
        this.restartWindowMs = config.cluster.restartWindowMs || 60000;
    }

    async start() {
        if (!this.shouldUseCluster()) {
            return this.startSingleProcess();
        }

        if (cluster.isPrimary) {
            return this.startPrimaryProcess();
        } else {
            return this.startWorkerProcess();
        }
    }

    shouldUseCluster() {
        return config.cluster.enabled && 
               !config.isDevelopment && 
               process.env.NODE_ENV !== 'test';
    }

    async startSingleProcess() {
        const app = new Application();
        await app.initialize();
        await app.start();
    }

    async startPrimaryProcess() {
        logger.info(`Starting cluster with ${config.cluster.workerCount} workers`);
        
        // Fork workers
        for (let i = 0; i < config.cluster.workerCount; i++) {
            this.forkWorker();
        }

        // Setup cluster event handlers
        cluster.on('exit', this.handleWorkerExit.bind(this));
        cluster.on('message', this.handleWorkerMessage.bind(this));

        // Setup graceful shutdown for cluster
        TERMINATION_SIGNALS.forEach(signal => {
            process.on(signal, () => this.shutdownCluster(signal));
        });
    }

    async startWorkerProcess() {
        const app = new Application();
        await app.initialize();
        await app.start();
        
        // Notify primary that worker is ready
        if (process.send) {
            process.send({ 
                type: 'worker_ready',
                pid: process.pid 
            });
        }
    }

    forkWorker() {
        const worker = cluster.fork();
        this.workers.set(worker.process.pid, worker);
        this.restartCounts.set(worker.process.pid, 0);
        
        worker.on('message', (message) => {
            if (message.type === 'worker_ready') {
                logger.info(`Worker ${worker.process.pid} is ready`);
            }
        });
    }

    handleWorkerExit(worker, code, signal) {
        const pid = worker.process.pid;
        const restartCount = this.restartCounts.get(pid) || 0;
        
        logger.warn(`Worker ${pid} died`, {
            code,
            signal,
            restartCount
        });

        this.workers.delete(pid);

        // Check if we should restart the worker
        if (restartCount < this.maxRestarts) {
            logger.info(`Restarting worker (attempt ${restartCount + 1}/${this.maxRestarts})`);
            this.restartCounts.set(pid, restartCount + 1);
            
            // Delay restart if we're in the restart window
            const delay = restartCount > 0 ? 
                Math.min(1000 * Math.pow(2, restartCount), 5000) : 0;
            
            setTimeout(() => this.forkWorker(), delay);
        } else {
            logger.error(`Worker ${pid} reached max restarts, not restarting`);
            
            // If all workers are dead, exit the primary
            if (this.workers.size === 0) {
                logger.error('All workers died, exiting primary process');
                process.exit(1);
            }
        }
    }

    handleWorkerMessage(worker, message) {
        // Handle different types of worker messages
        switch (message.type) {
            case 'health_update':
                this.handleHealthUpdate(worker, message);
                break;
            case 'metric_report':
                this.handleMetricReport(worker, message);
                break;
            default:
                logger.debug('Received worker message', {
                    worker: worker.process.pid,
                    type: message.type
                });
        }
    }

    handleHealthUpdate(worker, message) {
        // Implement health aggregation across workers
    }

    handleMetricReport(worker, message) {
        // Implement metric aggregation across workers
    }

    async shutdownCluster(signal) {
        logger.info(`Shutting down cluster (${signal})`);
        
        const shutdownPromises = Array.from(this.workers.values()).map(worker => {
            return new Promise(resolve => {
                worker.on('disconnect', resolve);
                worker.disconnect();
                
                // Force kill if worker doesn't disconnect in time
                setTimeout(() => {
                    worker.kill('SIGKILL');
                    resolve();
                }, 5000);
            });
        });

        await Promise.all(shutdownPromises);
        logger.info('Cluster shutdown complete');
        process.exit(0);
    }
}

/**
 * Main application entry point
 */
async function main() {
    try {
        const clusterManager = new ClusterManager();
        await clusterManager.start();
    } catch (error) {
        console.error('Fatal error during startup:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Start the application
if (require.main === module) {
    main();
}

module.exports = {
    Application,
    ClusterManager
};