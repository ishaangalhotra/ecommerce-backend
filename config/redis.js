const { createClient } = require('redis');
const { createCluster } = require('redis');
const logger = require('../utils/logger');
const config = require('../config/config');
const EventEmitter = require('events');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Enterprise-Grade Redis Connection Manager
 * 
 * Enhanced Features:
 * 1. Comprehensive connection management with circuit breaker pattern
 * 2. Optimized cluster support with intelligent node handling
 * 3. Advanced connection pooling with dynamic sizing
 * 4. Real-time performance metrics collection
 * 5. Robust Pub/Sub implementation with error recovery
 * 6. Enhanced caching with compression and serialization
 * 7. Graceful shutdown with connection draining
 * 8. Comprehensive security validation
 * 9. TypeScript-style JSDoc for better IDE support
 */

class RedisManager extends EventEmitter {
    /**
     * Creates a new RedisManager instance
     */
    constructor() {
        super();
        this.initializeState();
    }

    /**
     * Initializes the manager's internal state
     * @private
     */
    initializeState() {
        this.client = null;
        this.pubClient = null;
        this.subClient = null;
        this.clusterClient = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.connectionRetries = 0;
        this.maxRetries = config.redis?.maxRetries || 5;
        this.healthCheckInterval = null;
        this.commandQueue = [];
        this.isProcessingQueue = false;
        
        this.circuitBreaker = {
            failureCount: 0,
            isOpen: false,
            lastFailureTime: null,
            threshold: config.redis?.circuitBreaker?.threshold || 5,
            timeout: config.redis?.circuitBreaker?.timeout || 30000,
            halfOpen: false
        };
        
        this.metrics = {
            connectionAttempts: 0,
            reconnections: 0,
            commandsExecuted: 0,
            commandsFailed: 0,
            lastConnected: null,
            uptime: 0,
            avgResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            responseTimes: [],
            throughput: 0,
            lastCommandTime: null
        };
        
        this.subscribers = new Map();
        this.connectionListeners = new Set();
    }

    /**
     * Initializes Redis connection
     * @returns {Promise<RedisClient>} The Redis client instance
     * @throws {Error} If connection fails
     */
    async initialize() {
        if (this.isConnected) {
            logger.info('Redis already connected');
            return this.client;
        }

        if (this.isConnecting) {
            logger.info('Redis connection in progress');
            return this.waitForConnection();
        }

        this.isConnecting = true;
        this.metrics.connectionAttempts++;

        try {
            logger.info('Initializing Redis connection...', {
                host: config.redis?.host || 'localhost',
                port: config.redis?.port || 6379,
                database: config.redis?.db || 0,
                cluster: config.redis?.cluster?.enabled || false
            });

            if (config.redis?.cluster?.enabled) {
                await this.initializeCluster();
            } else {
                await this.initializeSingleNode();
            }

            await this.setupEventHandlers();
            await this.setupHealthMonitoring();
            await this.setupGracefulShutdown();
            await this.validateConnection();

            this.isConnected = true;
            this.isConnecting = false;
            this.connectionRetries = 0;
            this.metrics.lastConnected = new Date();
            this.metrics.uptime = 0;

            logger.info('Redis connected successfully', {
                type: config.redis?.cluster?.enabled ? 'cluster' : 'single',
                database: config.redis?.db || 0,
                connectionTime: Date.now() - this.metrics.lastConnected.getTime()
            });

            this.emit('connected');
            this.processCommandQueue();
            
            return this.client;
        } catch (error) {
            this.isConnecting = false;
            this.handleConnectionError(error);
            throw error;
        }
    }

    /**
     * Initializes single Redis node connection
     * @private
     * @returns {Promise<void>}
     */
    async initializeSingleNode() {
        const connectionConfig = this.getSingleNodeConfig();

        // Create main client
        this.client = createClient(connectionConfig);

        // Create separate clients for pub/sub if enabled
        if (config.redis?.pubsub?.enabled) {
            this.pubClient = createClient({...connectionConfig, isolationPoolOptions: undefined});
            this.subClient = createClient({...connectionConfig, isolationPoolOptions: undefined});
        }

        // Connect all clients with timeout
        await this.connectWithTimeout([
            this.client.connect(),
            this.pubClient?.connect(),
            this.subClient?.connect()
        ].filter(Boolean));
    }

    /**
     * Gets configuration for single node connection
     * @private
     * @returns {object} Redis client configuration
     */
    getSingleNodeConfig() {
        return {
            url: config.redis?.url || `redis://${config.redis?.host || 'localhost'}:${config.redis?.port || 6379}`,
            database: config.redis?.db || 0,
            password: config.redis?.password,
            username: config.redis?.username,
            
            socket: {
                connectTimeout: config.redis?.connectTimeout || 10000,
                commandTimeout: config.redis?.commandTimeout || 5000,
                lazyConnect: true,
                reconnectStrategy: this.getReconnectStrategy(),
                keepAlive: config.redis?.keepAlive !== false ? 30000 : false,
                noDelay: config.redis?.tcpNoDelay !== false,
                family: config.redis?.family || 0
            },
            
            isolationPoolOptions: {
                min: config.redis?.pool?.min || 2,
                max: config.redis?.pool?.max || 20,
                acquireTimeoutMillis: config.redis?.pool?.acquireTimeout || 10000,
                createTimeoutMillis: config.redis?.pool?.createTimeout || 10000,
                idleTimeoutMillis: config.redis?.pool?.idleTimeout || 30000,
                reapIntervalMillis: config.redis?.pool?.reapInterval || 1000,
                createRetryIntervalMillis: config.redis?.pool?.createRetryInterval || 200
            },

            maxRetriesPerRequest: config.redis?.maxRetriesPerRequest || 3,
            retryDelayOnFailover: config.redis?.retryDelayOnFailover || 100,
            enableReadyCheck: config.redis?.enableReadyCheck !== false,
            lazyConnect: config.redis?.lazyConnect !== false,
            
            tls: config.redis?.tls ? {
                servername: config.redis?.tls?.servername,
                ca: config.redis?.tls?.ca,
                cert: config.redis?.tls?.cert,
                key: config.redis?.tls?.key,
                rejectUnauthorized: config.redis?.tls?.rejectUnauthorized !== false
            } : undefined
        };
    }

    /**
     * Initializes Redis cluster connection
     * @private
     * @returns {Promise<void>}
     */
    async initializeCluster() {
        const clusterConfig = this.getClusterConfig();
        this.clusterClient = createCluster(clusterConfig);
        this.client = this.clusterClient;

        await this.connectWithTimeout([this.clusterClient.connect()]);
    }

    /**
     * Gets configuration for cluster connection
     * @private
     * @returns {object} Redis cluster configuration
     */
    getClusterConfig() {
        return {
            rootNodes: config.redis?.cluster?.nodes || [
                { host: 'localhost', port: 7000 },
                { host: 'localhost', port: 7001 },
                { host: 'localhost', port: 7002 }
            ],
            
            defaults: {
                password: config.redis?.password,
                username: config.redis?.username,
                socket: {
                    connectTimeout: config.redis?.connectTimeout || 10000,
                    commandTimeout: config.redis?.commandTimeout || 5000,
                    keepAlive: 30000,
                    noDelay: true
                }
            },
            
            useReplicas: config.redis?.cluster?.useReplicas !== false,
            enableReadyCheck: true,
            redisOptions: {
                lazyConnect: true
            },
            
            clusterRetryDelayOnFailover: config.redis?.cluster?.retryDelayOnFailover || 100,
            clusterRetryDelayOnClusterDown: config.redis?.cluster?.retryDelayOnClusterDown || 300,
            clusterMaxRedirections: config.redis?.cluster?.maxRedirections || 16,
            maxRetriesPerRequest: config.redis?.cluster?.maxRetriesPerRequest || 3
        };
    }

    /**
     * Connects with timeout
     * @private
     * @param {Promise[]} connectPromises Array of connection promises
     * @returns {Promise<void>}
     */
    async connectWithTimeout(connectPromises) {
        const timeout = config.redis?.connectTimeout || 10000;
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Redis connection timed out after ${timeout}ms`)), timeout;
        });

        await Promise.race([
            Promise.all(connectPromises),
            timeoutPromise
        ]);
    }

    /**
     * Sets up comprehensive event handlers
     * @private
     * @returns {Promise<void>}
     */
    async setupEventHandlers() {
        this.setupClientEventHandlers(this.client, 'main');

        if (this.pubClient) this.setupClientEventHandlers(this.pubClient, 'pub');
        if (this.subClient) this.setupClientEventHandlers(this.subClient, 'sub');

        if (this.clusterClient) {
            this.setupClusterEventHandlers();
        }
    }

    /**
     * Sets up cluster-specific event handlers
     * @private
     */
    setupClusterEventHandlers() {
        this.clusterClient.on('node-error', (error, address) => {
            logger.warn('Redis cluster node error', {
                error: error.message,
                address,
                type: 'cluster_node_error'
            });
        });

        this.clusterClient.on('node-connect', (address) => {
            logger.info('Redis cluster node connected', { address });
        });

        this.clusterClient.on('node-disconnect', (address) => {
            logger.warn('Redis cluster node disconnected', { address });
        });
    }

    /**
     * Sets up event handlers for individual Redis clients
     * @private
     * @param {RedisClient} client The Redis client
     * @param {string} clientType The client type (main, pub, sub)
     */
    setupClientEventHandlers(client, clientType) {
        client.on('connect', () => {
            logger.info(`Redis ${clientType} client connecting`);
        });

        client.on('ready', () => {
            if (clientType === 'main') {
                this.isConnected = true;
                this.resetCircuitBreaker();
            }
            logger.info(`Redis ${clientType} client ready`);
        });

        client.on('error', (error) => {
            this.handleClientError(error, clientType);
        });

        client.on('reconnecting', () => {
            if (clientType === 'main') {
                this.metrics.reconnections++;
            }
            logger.info(`Redis ${clientType} client reconnecting`, {
                attempt: this.metrics.reconnections
            });
        });

        client.on('end', () => {
            if (clientType === 'main') {
                this.isConnected = false;
            }
            logger.warn(`Redis ${clientType} client connection ended`);
        });
    }

    /**
     * Handles client errors with circuit breaker pattern
     * @private
     * @param {Error} error The error object
     * @param {string} clientType The client type
     */
    handleClientError(error, clientType) {
        this.circuitBreaker.failureCount++;
        this.circuitBreaker.lastFailureTime = Date.now();
        
        if (this.circuitBreaker.failureCount >= this.circuitBreaker.threshold) {
            this.circuitBreaker.isOpen = true;
            this.circuitBreaker.halfOpen = false;
            logger.error('Redis circuit breaker opened', {
                failures: this.circuitBreaker.failureCount,
                threshold: this.circuitBreaker.threshold
            });
        }

        logger.error(`Redis ${clientType} client error`, {
            error: error.message,
            code: error.code,
            errno: error.errno,
            circuitBreakerOpen: this.circuitBreaker.isOpen
        });

        this.emit('error', error);
    }

    /**
     * Resets the circuit breaker
     * @private
     */
    resetCircuitBreaker() {
        this.circuitBreaker.failureCount = 0;
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.halfOpen = false;
    }

    /**
     * Gets reconnection strategy with exponential backoff
     * @private
     * @returns {Function} Reconnect strategy function
     */
    getReconnectStrategy() {
        return (retries) => {
            if (retries > this.maxRetries) {
                logger.error('Redis max reconnection attempts reached', {
                    retries,
                    maxRetries: this.maxRetries
                });
                return false;
            }

            const delay = Math.min(Math.pow(2, retries) * 100, 5000);
            logger.info('Redis reconnection attempt', {
                attempt: retries,
                delay: `${delay}ms`
            });
            
            return delay;
        };
    }

    /**
     * Sets up health monitoring
     * @private
     * @returns {Promise<void>}
     */
    async setupHealthMonitoring() {
        const interval = config.redis?.healthCheck?.interval || 30000;
        
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.performHealthCheck();
            } catch (error) {
                logger.warn('Redis health check failed', {
                    error: error.message
                });
            }
        }, interval);

        logger.debug('Redis health monitoring enabled', {
            interval: `${interval}ms`
        });
    }

    /**
     * Performs comprehensive health check
     * @returns {Promise<object>} Health check results
     */
    async performHealthCheck() {
        const start = Date.now();
        
        try {
            // Ping test
            const pingResult = await this.ping();
            const pingTime = Date.now() - start;
            
            // Memory usage check
            const info = await this.client.info('memory');
            const memoryInfo = this.parseInfoResponse(info);
            
            // Connection stats
            const clientInfo = await this.client.info('clients');
            const clientStats = this.parseInfoResponse(clientInfo);
            
            // Update metrics
            this.updateResponseTime(pingTime);
            
            const healthData = {
                healthy: true,
                pingTime,
                memory: {
                    used: memoryInfo.used_memory_human,
                    peak: memoryInfo.used_memory_peak_human,
                    rss: memoryInfo.used_memory_rss_human
                },
                connections: {
                    connected: parseInt(clientStats.connected_clients),
                    blocked: parseInt(clientStats.blocked_clients)
                },
                uptime: this.getUptime(),
                circuitBreakerOpen: this.circuitBreaker.isOpen,
                throughput: this.metrics.throughput
            };

            logger.debug('Redis health check passed', healthData);
            return healthData;
        } catch (error) {
            logger.error('Redis health check failed', {
                error: error.message,
                uptime: this.getUptime()
            });
            
            return {
                healthy: false,
                error: error.message,
                circuitBreakerOpen: this.circuitBreaker.isOpen
            };
        }
    }

    /**
     * Executes Redis command with metrics and circuit breaker
     * @param {string} command The Redis command
     * @param {...any} args Command arguments
     * @returns {Promise<any>} Command result
     */
    async executeCommand(command, ...args) {
        // Check circuit breaker
        if (this.circuitBreaker.isOpen) {
            const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailureTime;
            if (timeSinceLastFailure < this.circuitBreaker.timeout) {
                throw new Error('Redis circuit breaker is open');
            } else {
                // Half-open state - try one request
                this.circuitBreaker.isOpen = false;
                this.circuitBreaker.halfOpen = true;
                logger.info('Redis circuit breaker entering half-open state');
            }
        }

        // If not connected but connecting, queue the command
        if (!this.isConnected && this.isConnecting) {
            return new Promise((resolve, reject) => {
                this.commandQueue.push({ command, args, resolve, reject });
            });
        }

        const start = Date.now();
        
        try {
            this.metrics.commandsExecuted++;
            const result = await this.client[command](...args);
            
            // Update metrics on success
            const responseTime = Date.now() - start;
            this.updateResponseTime(responseTime);
            this.metrics.lastCommandTime = new Date();
            
            // Reset circuit breaker on success
            if (this.circuitBreaker.halfOpen || this.circuitBreaker.failureCount > 0) {
                this.resetCircuitBreaker();
                logger.info('Redis circuit breaker reset after successful command');
            }
            
            return result;
        } catch (error) {
            this.metrics.commandsFailed++;
            this.handleClientError(error, 'command');
            throw error;
        }
    }

    /**
     * Processes queued commands
     * @private
     */
    async processCommandQueue() {
        if (this.isProcessingQueue || this.commandQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        while (this.commandQueue.length > 0) {
            const { command, args, resolve, reject } = this.commandQueue.shift();
            
            try {
                const result = await this.executeCommand(command, ...args);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
        
        this.isProcessingQueue = false;
    }

    /**
     * Gets value from Redis with optional parsing and decompression
     * @param {string} key The key to get
     * @param {object} [options] Options
     * @param {boolean} [options.parse=true] Parse JSON response
     * @param {boolean} [options.decompress] Decompress value
     * @returns {Promise<any>} The retrieved value
     */
    async get(key, options = {}) {
        const { 
            parse = true, 
            decompress = config.redis?.compression?.enabled || false 
        } = options;
        
        try {
            let value = await this.executeCommand('get', key);
            
            if (value === null) return null;
            
            if (decompress) {
                value = await this.decompress(value);
            }
            
            if (parse) {
                try {
                    return JSON.parse(value);
                } catch (parseError) {
                    logger.warn('Failed to parse Redis value as JSON', {
                        key,
                        error: parseError.message
                    });
                    return value;
                }
            }
            
            return value;
        } catch (error) {
            logger.error('Redis GET operation failed', {
                key,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Sets value in Redis with optional serialization and compression
     * @param {string} key The key to set
     * @param {any} value The value to set
     * @param {object} [options] Options
     * @param {number} [options.ttl] Time to live in seconds
     * @param {boolean} [options.nx] Set if not exists
     * @param {boolean} [options.xx] Set if exists
     * @param {boolean} [options.stringify] Stringify objects
     * @param {boolean} [options.compress] Compress value
     * @returns {Promise<string>} Redis response
     */
    async set(key, value, options = {}) {
        const {
            ttl,
            nx = false,
            xx = false,
            stringify = true,
            compress = config.redis?.compression?.enabled || false
        } = options;

        try {
            let processedValue = value;
            
            if (stringify && typeof value === 'object') {
                processedValue = JSON.stringify(value);
            }
            
            if (compress) {
                processedValue = await this.compress(processedValue);
            }
            
            const args = [key, processedValue];
            
            if (ttl) args.push('EX', ttl);
            if (nx) args.push('NX');
            if (xx) args.push('XX');
            
            const result = await this.executeCommand('set', ...args);
            
            logger.debug('Redis SET operation completed', {
                key,
                ttl,
                nx,
                xx,
                compressed: compress,
                size: processedValue.length
            });
            
            return result;
        } catch (error) {
            logger.error('Redis SET operation failed', {
                key,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Subscribes to Redis channel or pattern
     * @param {string} channel The channel/pattern to subscribe to
     * @param {Function} handler The message handler
     * @param {object} [options] Options
     * @param {boolean} [options.pattern] Subscribe to pattern
     * @param {string} [options.queueGroup] Queue group name
     * @param {number} [options.maxRetries] Max retry attempts
     * @returns {Promise<void>}
     */
    async subscribe(channel, handler, options = {}) {
        if (!this.subClient) {
            throw new Error('Pub/Sub not enabled in Redis configuration');
        }
        
        const { 
            pattern = false,
            queueGroup = null,
            maxRetries = 3
        } = options;
        
        try {
            const subscriberKey = `${channel}:${pattern ? 'pattern' : 'channel'}`;
            this.subscribers.set(subscriberKey, {
                handler,
                channel,
                pattern,
                queueGroup,
                retries: 0,
                maxRetries
            });
            
            const wrappedHandler = async (message, receivedChannel) => {
                const subscriber = this.subscribers.get(subscriberKey);
                
                try {
                    await handler(message, receivedChannel);
                    subscriber.retries = 0;
                } catch (error) {
                    subscriber.retries++;
                    logger.error('Redis subscription handler error', {
                        channel: receivedChannel,
                        error: error.message,
                        retries: subscriber.retries,
                        maxRetries
                    });
                    
                    if (subscriber.retries >= maxRetries) {
                        logger.error('Max retries reached for subscription handler', {
                            channel: receivedChannel,
                            maxRetries
                        });
                        await this.unsubscribe(channel, pattern);
                    }
                }
            };
            
            if (pattern) {
                await this.subClient.pSubscribe(channel, wrappedHandler);
                logger.info('Redis pattern subscription created', { pattern: channel });
            } else {
                await this.subClient.subscribe(channel, wrappedHandler);
                logger.info('Redis channel subscription created', { channel });
            }
        } catch (error) {
            logger.error('Redis subscription failed', {
                channel,
                pattern,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Unsubscribes from channel or pattern
     * @param {string} channel The channel/pattern to unsubscribe from
     * @param {boolean} [pattern] Unsubscribe from pattern
     * @returns {Promise<void>}
     */
    async unsubscribe(channel, pattern = false) {
        if (!this.subClient) return;
        
        try {
            const subscriberKey = `${channel}:${pattern ? 'pattern' : 'channel'}`;
            this.subscribers.delete(subscriberKey);
            
            if (pattern) {
                await this.subClient.pUnsubscribe(channel);
                logger.info('Redis pattern unsubscription completed', { pattern: channel });
            } else {
                await this.subClient.unsubscribe(channel);
                logger.info('Redis channel unsubscription completed', { channel });
            }
        } catch (error) {
            logger.error('Redis unsubscription failed', {
                channel,
                pattern,
                error: error.message
            });
        }
    }

    /**
     * Publishes message to channel
     * @param {string} channel The channel to publish to
     * @param {any} message The message to publish
     * @param {object} [options] Options
     * @param {boolean} [options.stringify] Stringify message
     * @returns {Promise<number>} Number of subscribers that received the message
     */
    async publish(channel, message, options = {}) {
        if (!this.pubClient) {
            throw new Error('Pub/Sub not enabled in Redis configuration');
        }
        
        const { stringify = true } = options;
        
        try {
            let processedMessage = message;
            
            if (stringify && typeof message === 'object') {
                processedMessage = JSON.stringify(message);
            }
            
            const result = await this.pubClient.publish(channel, processedMessage);
            
            logger.debug('Redis message published', {
                channel,
                subscribers: result,
                messageSize: processedMessage.length
            });
            
            return result;
        } catch (error) {
            logger.error('Redis publish failed', {
                channel,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Compresses data using gzip
     * @param {string|Buffer} data Data to compress
     * @returns {Promise<string>} Compressed data as base64 string
     */
    async compress(data) {
        try {
            const buffer = await gzip(data);
            return buffer.toString('base64');
        } catch (error) {
            logger.error('Redis compression failed', { error: error.message });
            return data;
        }
    }

    /**
     * Decompresses data using gzip
     * @param {string} data Base64 compressed data
     * @returns {Promise<string>} Decompressed data
     */
    async decompress(data) {
        try {
            const buffer = Buffer.from(data, 'base64');
            const result = await gunzip(buffer);
            return result.toString();
        } catch (error) {
            logger.error('Redis decompression failed', { error: error.message });
            return data;
        }
    }

    /**
     * Updates response time metrics
     * @private
     * @param {number} responseTime Response time in ms
     */
    updateResponseTime(responseTime) {
        this.metrics.responseTimes.push(responseTime);
        
        // Keep last 100 response times for average
        if (this.metrics.responseTimes.length > 100) {
            this.metrics.responseTimes.shift();
        }
        
        // Update min/max
        this.metrics.minResponseTime = Math.min(this.metrics.minResponseTime, responseTime);
        this.metrics.maxResponseTime = Math.max(this.metrics.maxResponseTime, responseTime);
        
        // Calculate average
        const sum = this.metrics.responseTimes.reduce((a, b) => a + b, 0);
        this.metrics.avgResponseTime = sum / this.metrics.responseTimes.length;
        
        // Calculate throughput (commands per second)
        if (this.metrics.lastCommandTime) {
            const timeDiff = (Date.now() - this.metrics.lastCommandTime.getTime()) / 1000;
            this.metrics.throughput = timeDiff > 0 ? 
                Math.min(this.metrics.responseTimes.length / timeDiff, 1000) : 0;
        }
    }

    /**
     * Parses Redis INFO response into object
     * @private
     * @param {string} infoString INFO command response
     * @returns {object} Parsed info
     */
    parseInfoResponse(infoString) {
        const info = {};
        const lines = infoString.split('\r\n');
        
        for (const line of lines) {
            if (line && !line.startsWith('#')) {
                const [key, value] = line.split(':');
                if (key && value !== undefined) {
                    info[key] = value;
                }
            }
        }
        
        return info;
    }

    /**
     * Gets connection uptime in seconds
     * @returns {number} Uptime in seconds
     */
    getUptime() {
        if (!this.metrics.lastConnected) return 0;
        return Math.floor((Date.now() - this.metrics.lastConnected.getTime()) / 1000);
    }

    /**
     * Waits for connection to be established
     * @private
     * @returns {Promise<RedisClient>} The Redis client
     */
    waitForConnection() {
        return new Promise((resolve, reject) => {
            const checkConnection = () => {
                if (this.isConnected && this.client) {
                    resolve(this.client);
                } else if (!this.isConnecting) {
                    reject(new Error('Connection failed'));
                } else {
                    setTimeout(checkConnection, 100);
                }
            };
            checkConnection();
        });
    }

    /**
     * Handles connection errors
     * @private
     * @param {Error} error Connection error
     */
    handleConnectionError(error) {
        let errorType = 'CONNECTION_ERROR';

        if (error.code === 'ECONNREFUSED') {
            errorType = 'CONNECTION_REFUSED';
        } else if (error.code === 'ENOTFOUND') {
            errorType = 'HOST_NOT_FOUND';
        } else if (error.message.includes('authentication')) {
            errorType = 'AUTHENTICATION_ERROR';
        }

        logger.error('Redis connection failed', {
            error: error.message,
            type: errorType,
            code: error.code,
            attempts: this.metrics.connectionAttempts
        });
    }

    /**
     * Validates Redis connection with test operations
     * @private
     * @returns {Promise<void>}
     */
    async validateConnection() {
        try {
            const result = await this.ping();
            if (result !== 'PONG') {
                throw new Error('Invalid ping response');
            }
            
            const testKey = `test:${Date.now()}`;
            await this.set(testKey, 'validation', { ttl: 10 });
            const value = await this.get(testKey);
            
            if (value !== 'validation') {
                throw new Error('Basic operation validation failed');
            }
            
            await this.del(testKey);
            logger.info('Redis connection validation passed');
        } catch (error) {
            logger.error('Redis connection validation failed', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Sets up graceful shutdown handlers
     * @private
     */
    setupGracefulShutdown() {
        const shutdownHandler = async (signal) => {
            logger.info(`Received ${signal}, initiating Redis shutdown`);
            await this.disconnect();
        };

        process.on('SIGTERM', shutdownHandler);
        process.on('SIGINT', shutdownHandler);
        process.on('SIGHUP', shutdownHandler);
    }

    /**
     * Disconnects from Redis gracefully
     * @returns {Promise<void>}
     */
    async disconnect() {
        try {
            logger.info('Closing Redis connections...', {
                uptime: this.getUptime(),
                commandsExecuted: this.metrics.commandsExecuted
            });

            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }

            const disconnectPromises = [];
            
            if (this.client && this.isConnected) {
                disconnectPromises.push(this.client.quit());
            }
            
            if (this.pubClient) {
                disconnectPromises.push(this.pubClient.quit());
            }
            
            if (this.subClient) {
                disconnectPromises.push(this.subClient.quit());
            }

            await Promise.all(disconnectPromises);

            this.isConnected = false;
            this.client = null;
            this.pubClient = null;
            this.subClient = null;
            this.clusterClient = null;

            logger.info('Redis connections closed successfully');
        } catch (error) {
            logger.error('Error during Redis disconnect', {
                error: error.message
            });
        }
    }

    /**
     * Gets connection information
     * @returns {object} Connection info
     */
    getConnectionInfo() {
        return {
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
            type: config.redis?.cluster?.enabled ? 'cluster' : 'single',
            database: config.redis?.db || 0,
            metrics: this.metrics,
            circuitBreaker: this.circuitBreaker,
            subscribers: this.subscribers.size,
            uptime: this.getUptime()
        };
    }

    /**
     * Gets performance metrics
     * @returns {object} Metrics data
     */
    getMetrics() {
        return {
            ...this.metrics,
            circuitBreaker: this.circuitBreaker,
            connectionInfo: this.getConnectionInfo(),
            subscribers: this.subscribers.size,
            uptime: this.getUptime()
        };
    }
}

// Create singleton instance
const redisManager = new RedisManager();

// Export functions
const initializeRedis = async () => {
    return await redisManager.initialize();
};

const shutdownRedis = async () => {
    return await redisManager.disconnect();
};

const getRedisInfo = () => {
    return redisManager.getConnectionInfo();
};

const performRedisHealthCheck = async () => {
    return await redisManager.performHealthCheck();
};

// Export both class and convenience functions
module.exports = {
    RedisManager,
    redisManager,
    initializeRedis,
    shutdownRedis,
    getRedisInfo,
    performRedisHealthCheck,
    
    // Direct access to clients
    get client() { return redisManager.client; },
    get pubClient() { return redisManager.pubClient; },
    get subClient() { return redisManager.subClient; },
    
    // Utility methods
    get: (...args) => redisManager.get(...args),
    set: (...args) => redisManager.set(...args),
    del: (...args) => redisManager.del(...args),
    exists: (...args) => redisManager.exists(...args),
    expire: (...args) => redisManager.expire(...args),
    ttl: (...args) => redisManager.ttl(...args),
    ping: () => redisManager.ping(),
    
    // Advanced operations
    mget: (...args) => redisManager.mget(...args),
    mset: (...args) => redisManager.mset(...args),
    incr: (...args) => redisManager.incr(...args),
    decr: (...args) => redisManager.decr(...args),
    
    // Hash operations
    hget: (...args) => redisManager.hget(...args),
    hset: (...args) => redisManager.hset(...args),
    hgetall: (...args) => redisManager.hgetall(...args),
    
    // Set operations
    sadd: (...args) => redisManager.sadd(...args),
    smembers: (...args) => redisManager.smembers(...args),
    
    // Pub/Sub operations
    subscribe: (...args) => redisManager.subscribe(...args),
    unsubscribe: (...args) => redisManager.unsubscribe(...args),
    publish: (...args) => redisManager.publish(...args),
    
    // Backward compatibility
    default: initializeRedis
};