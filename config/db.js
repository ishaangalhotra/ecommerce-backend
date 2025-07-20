const mongoose = require('mongoose');
const logger = require('../utils/logger');
const config = require('../config/config');
const { EventEmitter } = require('events');

/**
 * Advanced MongoDB Connection Manager
 * 
 * Key Features:
 * 1. Robust connection pooling with dynamic configuration
 * 2. Intelligent retry mechanism with exponential backoff and jitter
 * 3. Comprehensive health monitoring and automatic recovery
 * 4. Detailed performance metrics collection
 * 5. Graceful shutdown handling with connection draining
 * 6. Environment-aware configuration
 * 7. Connection state management with event emission
 * 8. Advanced error handling and logging
 * 9. Index management utilities
 * 10. Transaction support
 */

class DatabaseManager extends EventEmitter {
    constructor() {
        super();
        this.connection = null;
        this._state = {
            isConnected: false,
            isConnecting: false,
            isDisconnecting: false,
            lastError: null
        };
        this.retryConfig = {
            maxRetries: config.database.maxRetries || 5,
            baseDelay: config.database.retryDelay || 1000,
            maxDelay: 30000 // 30 seconds maximum
        };
        this.metrics = {
            connectionAttempts: 0,
            successfulConnections: 0,
            reconnections: 0,
            disconnections: 0,
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            operationalSince: null,
            totalUptime: 0,
            totalDowntime: 0
        };
        this.healthMonitor = {
            interval: null,
            lastCheck: null,
            failures: 0
        };
        this._setupInternalListeners();
    }

    /**
     * Current connection state
     */
    get state() {
        return {
            ...this._state,
            uptime: this.getUptime(),
            downtime: this.getDowntime(),
            readyState: this.connection?.connection?.readyState || 0
        };
    }

    /**
     * Initialize database connection with advanced configuration
     */
    async connect() {
        if (this._state.isConnected) {
            logger.debug('Database already connected');
            return this.connection;
        }

        if (this._state.isConnecting) {
            logger.debug('Database connection in progress');
            return this._waitForConnection();
        }

        this._state.isConnecting = true;
        this.metrics.connectionAttempts++;
        this.emit('connecting');

        try {
            logger.info('Initializing database connection', {
                host: this._extractHostFromUri(config.database.uri),
                database: config.database.name,
                environment: config.env,
                attempt: this.metrics.connectionAttempts
            });

            const connectionOptions = this._getConnectionOptions();
            this.connection = await this._connectWithRetry(config.database.uri, connectionOptions);
            
            this._setupConnectionEventHandlers();
            this._startHealthMonitoring();
            this._setupGracefulShutdown();
            
            this._state.isConnected = true;
            this._state.isConnecting = false;
            this._state.lastError = null;
            this.metrics.successfulConnections++;
            this.metrics.lastConnectedAt = new Date();
            this.metrics.operationalSince = new Date();
            
            logger.info('Database connection established', {
                host: this.connection.connection.host,
                database: this.connection.connection.name,
                readyState: this.connection.connection.readyState,
                connectionTime: Date.now() - this.metrics.lastConnectedAt.getTime()
            });

            this.emit('connected', this.connection);
            return this.connection;

        } catch (error) {
            this._state.isConnecting = false;
            this._state.lastError = error;
            this.emit('connectionFailed', error);
            this._handleConnectionError(error);
            throw error;
        }
    }

    /**
     * Gracefully disconnect from database
     */
    async disconnect() {
        if (this._state.isDisconnecting || !this._state.isConnected) {
            logger.debug('Database already disconnecting or disconnected');
            return;
        }

        this._state.isDisconnecting = true;
        this.emit('disconnecting');

        try {
            this._stopHealthMonitoring();
            
            if (this.connection) {
                logger.info('Closing database connection', {
                    uptime: this.getUptime()
                });

                // Start draining connections
                await this._drainConnections();
                
                // Close the connection
                await this.connection.connection.close();
                
                this.metrics.lastDisconnectedAt = new Date();
                this.metrics.disconnections++;
                this._updateUptimeMetrics();
                
                logger.info('Database connection closed', {
                    totalUptime: this.metrics.totalUptime
                });
            }
        } catch (error) {
            logger.error('Error during database disconnection', {
                error: error.message,
                stack: error.stack
            });
            this.emit('disconnectionFailed', error);
            throw error;
        } finally {
            this.connection = null;
            this._state.isConnected = false;
            this._state.isDisconnecting = false;
            this.emit('disconnected');
        }
    }

    /**
     * Execute a database transaction
     */
    async executeTransaction(transactionFn, options = {}) {
        if (!this._state.isConnected) {
            throw new Error('Database not connected');
        }

        const session = await this.connection.startSession();
        let result;

        try {
            await session.withTransaction(async () => {
                result = await transactionFn(session);
            }, options);

            return result;
        } finally {
            session.endSession();
        }
    }

    /**
     * Get database statistics
     */
    async getStats() {
        if (!this._state.isConnected) {
            throw new Error('Database not connected');
        }

        try {
            const db = this.connection.connection.db;
            const [serverStatus, dbStats] = await Promise.all([
                db.admin().serverStatus(),
                db.stats()
            ]);

            return {
                server: {
                    version: serverStatus.version,
                    host: serverStatus.host,
                    process: serverStatus.process,
                    uptime: serverStatus.uptime,
                    connections: serverStatus.connections
                },
                database: {
                    name: dbStats.db,
                    collections: dbStats.collections,
                    documents: dbStats.objects,
                    dataSize: dbStats.dataSize,
                    storageSize: dbStats.storageSize,
                    indexSize: dbStats.indexSize,
                    indexCount: dbStats.indexes
                },
                memory: {
                    resident: serverStatus.mem?.resident,
                    virtual: serverStatus.mem?.virtual,
                    mapped: serverStatus.mem?.mapped
                },
                network: {
                    bytesIn: serverStatus.network?.bytesIn,
                    bytesOut: serverStatus.network?.bytesOut,
                    numRequests: serverStatus.network?.numRequests
                },
                opcounters: serverStatus.opcounters,
                metrics: {
                    ...this.metrics,
                    currentState: this.state
                }
            };
        } catch (error) {
            logger.error('Failed to get database stats', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Create database indexes
     */
    async createIndexes(indexDefinitions = []) {
        if (!this._state.isConnected) {
            throw new Error('Database not connected');
        }

        try {
            logger.info('Creating database indexes');
            
            const operations = indexDefinitions.map(async ({ collection, spec, options }) => {
                try {
                    await this.connection.connection.collection(collection).createIndex(spec, options);
                    logger.debug(`Index created for collection ${collection}`, {
                        spec,
                        options
                    });
                } catch (error) {
                    logger.error(`Failed to create index for collection ${collection}`, {
                        error: error.message,
                        spec,
                        options
                    });
                    throw error;
                }
            });

            await Promise.all(operations);
            logger.info('Database indexes created successfully');
        } catch (error) {
            logger.error('Failed to create database indexes', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Ping the database
     */
    async ping() {
        if (!this._state.isConnected) {
            throw new Error('Database not connected');
        }

        try {
            const start = Date.now();
            await this.connection.connection.db.admin().ping();
            const latency = Date.now() - start;
            
            return {
                ok: 1,
                latency: `${latency}ms`
            };
        } catch (error) {
            logger.error('Database ping failed', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * PRIVATE METHODS
     */

    async _connectWithRetry(uri, options, attempt = 1) {
        try {
            const connection = await mongoose.connect(uri, options);
            
            if (attempt > 1) {
                logger.info('Database connection successful after retry', {
                    attempt,
                    totalAttempts: this.metrics.connectionAttempts
                });
            }
            
            return connection;
        } catch (error) {
            if (attempt >= this.retryConfig.maxRetries) {
                logger.error('Database connection failed after all retries', {
                    attempts: attempt,
                    maxRetries: this.retryConfig.maxRetries,
                    error: error.message
                });
                throw new Error(`Failed to connect to database after ${attempt} attempts: ${error.message}`);
            }

            const delay = this._calculateRetryDelay(attempt);
            logger.warn(`Database connection attempt ${attempt} failed, retrying in ${delay}ms`, {
                error: error.message,
                nextAttempt: attempt + 1,
                maxRetries: this.retryConfig.maxRetries
            });

            await this._sleep(delay);
            return this._connectWithRetry(uri, options, attempt + 1);
        }
    }

    _getConnectionOptions() {
        const isProduction = config.env === 'production';
        
        return {
            // Connection settings
            useNewUrlParser: true,
            useUnifiedTopology: true,
            
            // Connection pool settings
            maxPoolSize: config.database.options.maxPoolSize || (isProduction ? 50 : 10),
            minPoolSize: config.database.options.minPoolSize || (isProduction ? 5 : 2),
            maxIdleTimeMS: config.database.options.maxIdleTimeMS || 30000,
            waitQueueTimeoutMS: config.database.options.waitQueueTimeoutMS || 60000,
            
            // Timeout settings
            serverSelectionTimeoutMS: config.database.options.serverSelectionTimeoutMS || 10000,
            socketTimeoutMS: config.database.options.socketTimeoutMS || 45000,
            connectTimeoutMS: config.database.options.connectTimeoutMS || 30000,
            heartbeatFrequencyMS: config.database.options.heartbeatFrequencyMS || 10000,
            
            // Retry settings
            retryWrites: config.database.options.retryWrites !== false,
            retryReads: config.database.options.retryReads !== false,
            
            // Performance settings
            autoIndex: config.database.options.autoIndex !== false && !isProduction,
            bufferCommands: config.database.options.bufferCommands !== false,
            
            // Security settings
            authSource: config.database.options.authSource || 'admin',
            tls: config.database.options.tls || false,
            
            // Compression
            compressors: config.database.options.compressors || ['zstd', 'snappy', 'zlib'],
            zlibCompressionLevel: config.database.options.zlibCompressionLevel || 6,
            
            // Write concern
            w: config.database.options.writeConcern?.w || 'majority',
            j: config.database.options.writeConcern?.j !== false,
            wtimeout: config.database.options.writeConcern?.wtimeout || 10000,
            
            // Read preference
            readPreference: config.database.options.readPreference || 'primary',
            readConcern: {
                level: config.database.options.readConcern?.level || 'local'
            },
            
            // Monitoring
            monitorCommands: config.database.options.monitorCommands || false
        };
    }

    _setupConnectionEventHandlers() {
        const connection = this.connection.connection;

        connection.on('connected', () => {
            logger.info('MongoDB connection opened', {
                host: connection.host,
                port: connection.port,
                database: connection.name
            });
            this.emit('connectionOpened');
        });

        connection.on('disconnected', () => {
            this._state.isConnected = false;
            this._updateUptimeMetrics();
            this.metrics.lastDisconnectedAt = new Date();
            
            logger.warn('MongoDB connection lost', {
                host: connection.host,
                uptime: this.getUptime()
            });
            this.emit('connectionLost');
        });

        connection.on('reconnected', () => {
            this._state.isConnected = true;
            this.metrics.reconnections++;
            this.metrics.operationalSince = new Date();
            
            logger.info('MongoDB connection reestablished', {
                reconnections: this.metrics.reconnections,
                downtime: this.getDowntime()
            });
            this.emit('connectionRestored');
        });

        connection.on('error', (error) => {
            this._state.lastError = error;
            logger.error('MongoDB connection error', {
                error: error.message,
                code: error.code,
                stack: error.stack
            });
            this.emit('connectionError', error);
        });

        connection.on('timeout', () => {
            logger.warn('MongoDB connection timeout');
            this.emit('connectionTimeout');
        });

        connection.on('close', () => {
            logger.info('MongoDB connection closed');
            this.emit('connectionClosed');
        });

        if (config.database.options.monitorCommands) {
            mongoose.set('debug', (collectionName, method, query, doc) => {
                logger.debug(`MongoDB Query: ${collectionName}.${method}`, {
                    query,
                    doc
                });
            });
        }
    }

    _setupInternalListeners() {
        this.on('connectionError', (error) => {
            this._handleConnectionError(error);
        });

        this.on('connectionLost', () => {
            if (!this.healthMonitor.interval) {
                this._startHealthMonitoring(true);
            }
        });
    }

    _startHealthMonitoring(aggressive = false) {
        if (this.healthMonitor.interval) {
            clearInterval(this.healthMonitor.interval);
        }

        const interval = aggressive ? 5000 : config.database.healthCheckInterval || 30000;
        
        this.healthMonitor.interval = setInterval(async () => {
            try {
                this.healthMonitor.lastCheck = new Date();
                await this._performHealthCheck();
                this.healthMonitor.failures = 0;
            } catch (error) {
                this.healthMonitor.failures++;
                logger.warn(`Database health check failed (attempt ${this.healthMonitor.failures})`, {
                    error: error.message
                });

                if (this.healthMonitor.failures >= 3) {
                    logger.error('Database health check failed multiple times, attempting recovery');
                    this._attemptRecovery();
                }
            }
        }, interval);

        logger.debug('Database health monitoring started', {
            interval: `${interval}ms`,
            aggressiveMode: aggressive
        });
    }

    _stopHealthMonitoring() {
        if (this.healthMonitor.interval) {
            clearInterval(this.healthMonitor.interval);
            this.healthMonitor.interval = null;
            logger.debug('Database health monitoring stopped');
        }
    }

    async _performHealthCheck() {
        const start = Date.now();
        const pingResult = await this.ping();
        const stats = await this.getStats();
        
        logger.debug('Database health check completed', {
            latency: pingResult.latency,
            duration: `${Date.now() - start}ms`,
            connections: stats.server.connections.current,
            memoryUsage: stats.memory.resident
        });

        return {
            healthy: true,
            latency: pingResult.latency,
            stats
        };
    }

    _attemptRecovery() {
        if (this._state.isConnecting || this._state.isDisconnecting) {
            logger.debug('Recovery attempt skipped - connection state is changing');
            return;
        }

        logger.info('Attempting database connection recovery');
        this.connect().catch(error => {
            logger.error('Database recovery attempt failed', {
                error: error.message
            });
        });
    }

    _setupGracefulShutdown() {
        const shutdownSignals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
        
        shutdownSignals.forEach(signal => {
            process.on(signal, async () => {
                logger.info(`Received ${signal}, initiating graceful shutdown`);
                try {
                    await this.disconnect();
                    process.exit(0);
                } catch (error) {
                    logger.error('Graceful shutdown failed', {
                        error: error.message
                    });
                    process.exit(1);
                }
            });
        });

        process.on('uncaughtException', async (error) => {
            logger.error('Uncaught exception', {
                error: error.message,
                stack: error.stack
            });
            
            try {
                await this.disconnect();
            } finally {
                process.exit(1);
            }
        });

        process.on('unhandledRejection', (reason) => {
            logger.error('Unhandled rejection', {
                reason: reason instanceof Error ? reason.message : reason
            });
        });
    }

    async _drainConnections() {
        logger.debug('Draining database connections');
        const pool = this.connection.connection.getClient().s.options.pool;
        
        // Stop new connections from being created
        pool.clear();
        
        // Wait for existing connections to close
        while (pool.totalConnectionCount > 0) {
            await this._sleep(100);
        }
        
        logger.debug('All database connections drained');
    }

    _handleConnectionError(error) {
        const errorInfo = {
            message: error.message,
            code: error.code,
            name: error.name,
            stack: error.stack
        };

        if (error.name === 'MongoServerSelectionError') {
            logger.error('Could not connect to any MongoDB server', errorInfo);
            this.emit('serverSelectionError', error);
        } else if (error.name === 'MongoNetworkError') {
            logger.error('Network error while connecting to MongoDB', errorInfo);
            this.emit('networkError', error);
        } else if (error.name === 'MongoTimeoutError') {
            logger.error('Timeout while connecting to MongoDB', errorInfo);
            this.emit('timeoutError', error);
        } else if (error.name === 'MongoAuthenticationError') {
            logger.error('Authentication failed for MongoDB', errorInfo);
            this.emit('authenticationError', error);
        } else {
            logger.error('Unknown MongoDB connection error', errorInfo);
            this.emit('unknownError', error);
        }
    }

    _calculateRetryDelay(attempt) {
        const exponentialDelay = this.retryConfig.baseDelay * Math.pow(2, attempt - 1);
        const jitter = exponentialDelay * 0.1 * Math.random(); // Add 10% jitter
        return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelay);
    }

    async _waitForConnection(timeout = 30000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const check = () => {
                if (this._state.isConnected) {
                    resolve(this.connection);
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Connection timeout exceeded'));
                } else if (!this._state.isConnecting) {
                    reject(new Error('Connection failed'));
                } else {
                    setTimeout(check, 100);
                }
            };
            
            check();
        });
    }

    _updateUptimeMetrics() {
        if (this.metrics.operationalSince && this.metrics.lastConnectedAt) {
            const now = new Date();
            const lastUptime = now - this.metrics.operationalSince;
            this.metrics.totalUptime += lastUptime;
            
            if (this.metrics.lastDisconnectedAt) {
                const lastDowntime = now - this.metrics.lastDisconnectedAt;
                this.metrics.totalDowntime += lastDowntime;
            }
        }
    }

    getUptime() {
        if (!this.metrics.operationalSince) return 0;
        return Date.now() - this.metrics.operationalSince.getTime();
    }

    getDowntime() {
        if (!this.metrics.lastDisconnectedAt) return 0;
        return Date.now() - this.metrics.lastDisconnectedAt.getTime();
    }

    _extractHostFromUri(uri) {
        try {
            const match = uri.match(/mongodb(?:\+srv)?:\/\/(?:[^:]+:[^@]*@)?([^/?]+)/);
            return match ? match[1] : 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Singleton instance
const dbManager = new DatabaseManager();

// Helper functions
const connectDB = async () => dbManager.connect();
const disconnectDB = async () => dbManager.disconnect();
const getDBStats = async () => dbManager.getStats();
const pingDB = async () => dbManager.ping();
const createIndexes = async (indexDefinitions) => dbManager.createIndexes(indexDefinitions);
const executeTransaction = async (transactionFn, options) => dbManager.executeTransaction(transactionFn, options);

module.exports = {
    DatabaseManager,
    dbManager,
    connectDB,
    disconnectDB,
    getDBStats,
    pingDB,
    createIndexes,
    executeTransaction,
    
    // For backward compatibility
    default: dbManager
};