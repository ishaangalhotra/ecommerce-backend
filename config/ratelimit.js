const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const slowDown = require('express-slow-down');
const { createHash } = require('crypto');
const { ErrorResponse } = require('../middleware/error');
const logger = require('../utils/logger');
const { redisManager } = require('../config/redis');
const config = require('../config/config');

/**
 * Enterprise-Grade Rate Limiting System
 * 
 * Features:
 * 1. Multi-tier rate limiting with progressive penalties
 * 2. Intelligent key generation and user tracking
 * 3. Dynamic rate limiting based on user behavior
 * 4. Distributed rate limiting with Redis clustering
 * 5. Advanced monitoring and analytics
 * 6. Whitelist/blacklist management
 * 7. DDoS protection and attack mitigation
 * 8. Graceful degradation and circuit breaker patterns
 */

// Enhanced error classes
class TooManyRequestsError extends ErrorResponse {
    constructor(message = 'Too many requests, please try again later', details = null, code = 'RATE_LIMIT_EXCEEDED') {
        super(message, 429, details, code);
        this.name = 'TooManyRequestsError';
    }
}

class SuspiciousActivityError extends ErrorResponse {
    constructor(message = 'Suspicious activity detected', details = null) {
        super(message, 429, details, 'SUSPICIOUS_ACTIVITY');
        this.name = 'SuspiciousActivityError';
    }
}

// Configuration constants
const RATE_LIMIT_CONFIG = {
    DEFAULT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    DEFAULT_MAX_REQUESTS: 100,
    REDIS_PREFIX: 'rl:',
    SUSPICIOUS_THRESHOLD: 0.85, // 85% of limit
    PENALTY_MULTIPLIER: 2,
    MAX_PENALTY_LEVEL: 5,
    WHITELIST_CACHE_TTL: 300, // 5 minutes
    BLACKLIST_CACHE_TTL: 3600 // 1 hour
};

// IP whitelists and blacklists
const TRUSTED_IP_RANGES = new Set([
    '127.0.0.1',
    '::1',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    ...(config.security?.trustedIPs || [])
]);

const BLOCKED_IP_RANGES = new Set([
    ...(config.security?.blockedIPs || [])
]);

/**
 * Advanced rate limiter factory with comprehensive features
 */
class RateLimiterFactory {
    constructor() {
        this.analytics = {
            requestCounts: new Map(),
            blockedRequests: 0,
            suspiciousActivity: new Set(),
            lastAnalyticsReset: Date.now()
        };
        
        this.circuitBreaker = {
            failures: new Map(),
            threshold: config.rateLimit?.circuitBreaker?.threshold || 100,
            timeout: config.rateLimit?.circuitBreaker?.timeout || 60000
        };

        this.setupAnalytics();
    }

    /**
     * Create enhanced rate limiter with advanced options
     */
    create(options = {}) {
        const {
            windowMs = config.rateLimit?.windowMs || RATE_LIMIT_CONFIG.DEFAULT_WINDOW_MS,
            max = config.rateLimit?.max || RATE_LIMIT_CONFIG.DEFAULT_MAX_REQUESTS,
            message = 'Too many requests, please try again later',
            keyGenerator = null,
            skip = null,
            onLimitReached = null,
            enableSlowDown = true,
            enablePenalties = true,
            enableSuspiciousDetection = true,
            dynamicLimits = false,
            skipSuccessfulRequests = false,
            skipFailedRequests = false,
            standardHeaders = true,
            legacyHeaders = false,
            requestPropertyName = 'rateLimit',
            store = null,
            ...customOptions
        } = options;

        // Create Redis store if available
        const rateLimitStore = this.createStore(store, windowMs);

        // Enhanced key generation
        const enhancedKeyGenerator = this.createKeyGenerator(keyGenerator);

        // Enhanced skip function
        const enhancedSkip = this.createSkipFunction(skip);

        // Enhanced handler with comprehensive features
        const enhancedHandler = this.createHandler({
            message,
            onLimitReached,
            enableSuspiciousDetection,
            enablePenalties,
            windowMs,
            max
        });

        // Dynamic limit calculation
        const dynamicMaxCalculation = dynamicLimits ? 
            this.createDynamicLimitCalculator(max) : 
            undefined;

        // Rate limiter configuration
        const limiterConfig = {
            windowMs,
            max: dynamicMaxCalculation || max,
            standardHeaders,
            legacyHeaders,
            keyGenerator: enhancedKeyGenerator,
            skip: enhancedSkip,
            handler: enhancedHandler,
            store: rateLimitStore,
            skipSuccessfulRequests,
            skipFailedRequests,
            requestPropertyName,
            validate: {
                trustProxy: config.security?.trustProxy || false,
                xForwardedForTrust: config.security?.xForwardedForTrust || false
            },
            ...customOptions
        };

        const limiter = rateLimit(limiterConfig);

        // Add slow down middleware if enabled
        if (enableSlowDown) {
            return this.combineWithSlowDown(limiter, windowMs, max);
        }

        return limiter;
    }

    /**
     * Create Redis store with clustering support
     */
    createStore(customStore, windowMs) {
        if (customStore) return customStore;
        
        if (!redisManager.client) {
            logger.warn('Redis not available, using in-memory rate limiting');
            return undefined; // Use default memory store
        }

        try {
            return new RedisStore({
                client: redisManager.client,
                prefix: RATE_LIMIT_CONFIG.REDIS_PREFIX,
                expiry: Math.ceil(windowMs / 1000),
                resetExpiryOnChange: true,
                sendCommand: async (...args) => {
                    try {
                        return await redisManager.client.sendCommand(args);
                    } catch (error) {
                        logger.warn('Redis rate limit command failed', {
                            error: error.message,
                            command: args[0]
                        });
                        throw error;
                    }
                }
            });
        } catch (error) {
            logger.error('Failed to create Redis store for rate limiting', {
                error: error.message
            });
            return undefined;
        }
    }

    /**
     * Create intelligent key generator
     */
    createKeyGenerator(customKeyGenerator) {
        return (req) => {
            if (customKeyGenerator && typeof customKeyGenerator === 'function') {
                return customKeyGenerator(req);
            }

            const components = [];
            
            // Primary identifier - IP address
            const clientIP = this.getClientIP(req);
            components.push(clientIP);

            // Add user-specific component if authenticated
            if (req.user?.id) {
                components.push(`user:${req.user.id}`);
            }

            // Add route-specific component for granular control
            if (req.route?.path) {
                const routeHash = createHash('md5')
                    .update(`${req.method}:${req.route.path}`)
                    .digest('hex')
                    .substring(0, 8);
                components.push(`route:${routeHash}`);
            }

            // Add API key if present
            if (req.headers['x-api-key']) {
                const apiKeyHash = createHash('md5')
                    .update(req.headers['x-api-key'])
                    .digest('hex')
                    .substring(0, 8);
                components.push(`apikey:${apiKeyHash}`);
            }

            return components.join(':');
        };
    }

    /**
     * Create enhanced skip function with security checks
     */
    createSkipFunction(customSkip) {
        return async (req) => {
            const clientIP = this.getClientIP(req);

            // Custom skip function takes precedence
            if (customSkip && await customSkip(req)) {
                return true;
            }

            // Check IP blacklist first
            if (await this.isBlacklisted(clientIP)) {
                logger.warn('Blocked request from blacklisted IP', {
                    ip: clientIP,
                    path: req.path,
                    userAgent: req.get('User-Agent')
                });
                throw new SuspiciousActivityError('IP address is blocked');
            }

            // Check IP whitelist
            if (await this.isWhitelisted(clientIP)) {
                logger.debug('Allowing whitelisted IP', { ip: clientIP });
                return true;
            }

            // Skip for health checks and monitoring
            const skipPaths = ['/health', '/metrics', '/favicon.ico', '/.well-known'];
            if (skipPaths.some(path => req.path.startsWith(path))) {
                return true;
            }

            // Skip for trusted user agents (monitoring tools)
            const trustedAgents = config.security?.trustedUserAgents || [
                'HealthCheck',
                'Monitoring',
                'Prometheus',
                'UptimeRobot'
            ];
            const userAgent = req.get('User-Agent') || '';
            if (trustedAgents.some(agent => userAgent.includes(agent))) {
                return true;
            }

            // Skip for OPTIONS requests (CORS preflight)
            if (req.method === 'OPTIONS') {
                return true;
            }

            return false;
        };
    }

    /**
     * Create comprehensive rate limit handler
     */
    createHandler({ message, onLimitReached, enableSuspiciousDetection, enablePenalties, windowMs, max }) {
        return async (req, res, next) => {
            const clientIP = this.getClientIP(req);
            const rateLimitInfo = req.rateLimit || {};
            
            try {
                // Update analytics
                this.updateAnalytics(clientIP, rateLimitInfo);

                // Check for suspicious activity
                if (enableSuspiciousDetection) {
                    await this.detectSuspiciousActivity(req, rateLimitInfo);
                }

                // Apply progressive penalties
                let penaltyMultiplier = 1;
                if (enablePenalties) {
                    penaltyMultiplier = await this.calculatePenaltyMultiplier(clientIP);
                }

                const adjustedLimit = Math.floor(max / penaltyMultiplier);

                // Enhanced logging
                const logData = {
                    clientIP,
                    method: req.method,
                    path: req.path,
                    userAgent: req.get('User-Agent'),
                    userId: req.user?.id || 'anonymous',
                    originalLimit: max,
                    adjustedLimit,
                    current: rateLimitInfo.current || 0,
                    remaining: rateLimitInfo.remaining || 0,
                    resetTime: rateLimitInfo.resetTime,
                    penaltyLevel: penaltyMultiplier > 1 ? Math.log2(penaltyMultiplier) : 0,
                    windowMs,
                    forwardedFor: req.headers['x-forwarded-for'],
                    realIP: req.headers['x-real-ip']
                };

                logger.warn('Rate limit exceeded', logData);

                // Execute custom callback
                if (onLimitReached && typeof onLimitReached === 'function') {
                    await onLimitReached(req, res, rateLimitInfo);
                }

                // Update penalty level
                if (enablePenalties) {
                    await this.updatePenaltyLevel(clientIP);
                }

                // Set retry-after header
                const retryAfter = Math.ceil(windowMs / 1000);
                res.set('Retry-After', retryAfter.toString());

                // Enhanced response headers
                res.set({
                    'X-RateLimit-Client-IP': clientIP,
                    'X-RateLimit-Penalty-Level': penaltyMultiplier > 1 ? Math.log2(penaltyMultiplier).toString() : '0',
                    'X-RateLimit-Window': windowMs.toString(),
                    'X-RateLimit-Policy': 'progressive-penalty'
                });

                // Create detailed error
                const error = new TooManyRequestsError(message, {
                    limit: adjustedLimit,
                    current: rateLimitInfo.current,
                    remaining: 0,
                    resetTime: rateLimitInfo.resetTime,
                    retryAfter,
                    penaltyLevel: penaltyMultiplier > 1 ? Math.log2(penaltyMultiplier) : 0,
                    windowMs
                });

                next(error);

            } catch (error) {
                logger.error('Rate limit handler error', {
                    error: error.message,
                    stack: error.stack,
                    clientIP,
                    path: req.path
                });
                next(error);
            }
        };
    }

    /**
     * Create dynamic limit calculator based on system load
     */
    createDynamicLimitCalculator(baseMax) {
        return (req) => {
            // Get system metrics
            const memUsage = process.memoryUsage();
            const memoryPressure = memUsage.heapUsed / memUsage.heapTotal;
            
            // Get CPU load (simplified)
            const loadAvg = require('os').loadavg()[0];
            const cpuCount = require('os').cpus().length;
            const cpuPressure = Math.min(loadAvg / cpuCount, 1);

            // Calculate dynamic multiplier based on system pressure
            let multiplier = 1;
            
            if (memoryPressure > 0.8 || cpuPressure > 0.8) {
                multiplier = 0.5; // Reduce limits by 50% under high load
            } else if (memoryPressure > 0.6 || cpuPressure > 0.6) {
                multiplier = 0.75; // Reduce limits by 25% under medium load
            }

            const adjustedMax = Math.floor(baseMax * multiplier);
            
            if (multiplier < 1) {
                logger.info('Dynamic rate limiting activated', {
                    memoryPressure: (memoryPressure * 100).toFixed(1) + '%',
                    cpuPressure: (cpuPressure * 100).toFixed(1) + '%',
                    originalLimit: baseMax,
                    adjustedLimit: adjustedMax,
                    multiplier
                });
            }

            return adjustedMax;
        };
    }

    /**
     * Combine rate limiter with slow down middleware
     */
    combineWithSlowDown(limiter, windowMs, max) {
        const slowDownMiddleware = slowDown({
            windowMs,
            delayAfter: Math.floor(max * 0.8), // Start slowing down at 80% of limit
            delayMs: (hits) => {
                const baseDelay = 250; // Base delay in ms
                const exponentialDelay = Math.min(baseDelay * Math.pow(2, hits - Math.floor(max * 0.8)), 5000);
                return exponentialDelay;
            },
            maxDelayMs: 5000, // Maximum delay of 5 seconds
            skipFailedRequests: true,
            skipSuccessfulRequests: false,
            headers: true
        });

        return [slowDownMiddleware, limiter];
    }

    /**
     * Get client IP with proxy support
     */
    getClientIP(req) {
        // Check for forwarded IPs in order of preference
        const forwardedFor = req.headers['x-forwarded-for'];
        if (forwardedFor) {
            const ips = forwardedFor.split(',').map(ip => ip.trim());
            return ips[0]; // Return first IP (client)
        }

        const realIP = req.headers['x-real-ip'];
        if (realIP) {
            return realIP.trim();
        }

        const cfConnectingIP = req.headers['cf-connecting-ip'];
        if (cfConnectingIP) {
            return cfConnectingIP.trim();
        }

        return req.ip || req.connection.remoteAddress || '127.0.0.1';
    }

    /**
     * Check if IP is whitelisted
     */
    async isWhitelisted(ip) {
        // Check static whitelist
        if (TRUSTED_IP_RANGES.has(ip)) {
            return true;
        }

        // Check private IP ranges
        if (this.isPrivateIP(ip)) {
            return true;
        }

        // Check dynamic whitelist from Redis
        if (redisManager.client) {
            try {
                const isWhitelisted = await redisManager.client.get(`whitelist:${ip}`);
                return !!isWhitelisted;
            } catch (error) {
                logger.warn('Failed to check IP whitelist', {
                    error: error.message,
                    ip
                });
            }
        }

        return false;
    }

    /**
     * Check if IP is blacklisted
     */
    async isBlacklisted(ip) {
        // Check static blacklist
        if (BLOCKED_IP_RANGES.has(ip)) {
            return true;
        }

        // Check dynamic blacklist from Redis
        if (redisManager.client) {
            try {
                const isBlacklisted = await redisManager.client.get(`blacklist:${ip}`);
                return !!isBlacklisted;
            } catch (error) {
                logger.warn('Failed to check IP blacklist', {
                    error: error.message,
                    ip
                });
            }
        }

        return false;
    }

    /**
     * Check if IP is private/local
     */
    isPrivateIP(ip) {
        const privateRanges = [
            /^127\./,                    // 127.0.0.0/8 (localhost)
            /^192\.168\./,               // 192.168.0.0/16
            /^10\./,                     // 10.0.0.0/8
            /^172\.(1[6-9]|2[0-9]|3[01])\./,  // 172.16.0.0/12
            /^::1$/,                     // IPv6 localhost
            /^fe80:/,                    // IPv6 link-local
            /^fc00:/,                    // IPv6 unique local
        ];

        return privateRanges.some(range => range.test(ip));
    }

    /**
     * Calculate progressive penalty multiplier
     */
    async calculatePenaltyMultiplier(clientIP) {
        if (!redisManager.client) return 1;

        try {
            const penaltyKey = `${RATE_LIMIT_CONFIG.REDIS_PREFIX}penalty:${clientIP}`;
            const penaltyLevel = await redisManager.client.get(penaltyKey);

            if (!penaltyLevel) return 1;

            const level = Math.min(parseInt(penaltyLevel), RATE_LIMIT_CONFIG.MAX_PENALTY_LEVEL);
            return Math.pow(RATE_LIMIT_CONFIG.PENALTY_MULTIPLIER, level);
        } catch (error) {
            logger.warn('Failed to calculate penalty multiplier', {
                error: error.message,
                clientIP
            });
            return 1;
        }
    }

    /**
     * Update penalty level for repeat offenders
     */
    async updatePenaltyLevel(clientIP) {
        if (!redisManager.client) return;

        try {
            const penaltyKey = `${RATE_LIMIT_CONFIG.REDIS_PREFIX}penalty:${clientIP}`;
            const current = await redisManager.client.get(penaltyKey);
            const newLevel = Math.min((parseInt(current) || 0) + 1, RATE_LIMIT_CONFIG.MAX_PENALTY_LEVEL);

            // Set penalty with exponential decay
            const ttl = Math.pow(2, newLevel) * 3600; // 2^level hours
            await redisManager.client.setex(penaltyKey, ttl, newLevel.toString());

            logger.info('Updated penalty level', {
                clientIP,
                oldLevel: current || 0,
                newLevel,
                ttlSeconds: ttl
            });
        } catch (error) {
            logger.warn('Failed to update penalty level', {
                error: error.message,
                clientIP
            });
        }
    }

    /**
     * Detect suspicious activity patterns
     */
    async detectSuspiciousActivity(req, rateLimitInfo) {
        const clientIP = this.getClientIP(req);
        const suspiciousThreshold = RATE_LIMIT_CONFIG.SUSPICIOUS_THRESHOLD;

        // Check if approaching rate limit
        const currentRatio = (rateLimitInfo.current || 0) / (rateLimitInfo.limit || 1);
        
        if (currentRatio > suspiciousThreshold) {
            this.analytics.suspiciousActivity.add(clientIP);
            
            logger.security('Suspicious activity detected', {
                clientIP,
                currentRequests: rateLimitInfo.current,
                limit: rateLimitInfo.limit,
                ratio: (currentRatio * 100).toFixed(1) + '%',
                path: req.path,
                userAgent: req.get('User-Agent'),
                threat: 'potential_abuse'
            });

            // Auto-blacklist for extremely suspicious behavior
            if (currentRatio > 0.95 && rateLimitInfo.current > 50) {
                await this.addToBlacklist(clientIP, 3600, 'Automated suspicious activity detection');
            }
        }
    }

    /**
     * Add IP to dynamic blacklist
     */
    async addToBlacklist(ip, ttl = 3600, reason = 'Manual blacklist') {
        if (!redisManager.client) return;

        try {
            await redisManager.client.setex(`blacklist:${ip}`, ttl, JSON.stringify({
                reason,
                timestamp: new Date().toISOString(),
                ttl
            }));

            logger.security('IP blacklisted', {
                ip,
                reason,
                ttlSeconds: ttl
            });
        } catch (error) {
            logger.error('Failed to blacklist IP', {
                error: error.message,
                ip
            });
        }
    }

    /**
     * Update analytics
     */
    updateAnalytics(clientIP, rateLimitInfo) {
        // Update request counts
        const currentCount = this.analytics.requestCounts.get(clientIP) || 0;
        this.analytics.requestCounts.set(clientIP, currentCount + 1);

        // Count blocked requests
        if (rateLimitInfo.current >= rateLimitInfo.limit) {
            this.analytics.blockedRequests++;
        }

        // Clean up analytics periodically (every hour)
        const now = Date.now();
        if (now - this.analytics.lastAnalyticsReset > 3600000) {
            this.resetAnalytics();
        }
    }

    /**
     * Setup analytics collection
     */
    setupAnalytics() {
        // Reset analytics every hour
        setInterval(() => {
            this.resetAnalytics();
        }, 3600000);
    }

    /**
     * Reset analytics data
     */
    resetAnalytics() {
        this.analytics.requestCounts.clear();
        this.analytics.suspiciousActivity.clear();
        this.analytics.blockedRequests = 0;
        this.analytics.lastAnalyticsReset = Date.now();
    }

    /**
     * Get analytics data
     */
    getAnalytics() {
        const topIPs = Array.from(this.analytics.requestCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([ip, count]) => ({ ip, requests: count }));

        return {
            totalUniqueIPs: this.analytics.requestCounts.size,
            totalBlockedRequests: this.analytics.blockedRequests,
            suspiciousIPs: Array.from(this.analytics.suspiciousActivity),
            topRequesters: topIPs,
            lastReset: new Date(this.analytics.lastAnalyticsReset).toISOString()
        };
    }
}

// Create factory instance
const rateLimiterFactory = new RateLimiterFactory();

/**
 * Pre-configured rate limiters for different use cases
 */
const rateLimiters = {
    // Global API rate limiter
    api: rateLimiterFactory.create({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 1000, // 1000 requests per window
        message: 'API rate limit exceeded, please try again later',
        enableSlowDown: true,
        enablePenalties: true,
        dynamicLimits: true,
        onLimitReached: async (req, res, info) => {
            logger.warn('Global API rate limit exceeded', {
                ip: req.ip,
                path: req.path,
                current: info.current,
                limit: info.limit
            });
        }
    }),

    // Strict authentication rate limiter
    auth: rateLimiterFactory.create({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 attempts per window
        message: 'Too many authentication attempts, please try again later',
        skipSuccessfulRequests: true, // Only count failed attempts
        enablePenalties: true,
        enableSuspiciousDetection: true,
        onLimitReached: async (req, res, info) => {
            const clientIP = rateLimiterFactory.getClientIP(req);
            logger.security('Authentication rate limit exceeded', {
                clientIP,
                email: req.body?.email,
                attempts: info.current,
                userAgent: req.get('User-Agent'),
                threat: 'brute_force_attack'
            });

            // Auto-blacklist after multiple authentication failures
            if (info.current > 10) {
                await rateLimiterFactory.addToBlacklist(clientIP, 3600, 'Multiple auth failures');
            }
        }
    }),

    // Password reset rate limiter
    passwordReset: rateLimiterFactory.create({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 3, // 3 reset requests per hour
        message: 'Too many password reset requests, please try again later',
        keyGenerator: (req) => {
            // Rate limit by email if provided, otherwise by IP
            return req.body?.email || rateLimiterFactory.getClientIP(req);
        }
    }),

    // File upload rate limiter
    upload: rateLimiterFactory.create({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 20, // 20 uploads per hour
        message: 'Upload rate limit exceeded, please try again later',
        skipFailedRequests: true,
        onLimitReached: async (req, res, info) => {
            logger.warn('Upload rate limit exceeded', {
                ip: req.ip,
                userId: req.user?.id,
                uploads: info.current
            });
        }
    }),

    // Admin operations rate limiter
    admin: rateLimiterFactory.create({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 100, // 100 admin operations per 5 minutes
        message: 'Admin operation rate limit exceeded',
        keyGenerator: (req) => `admin:${req.user?.id || req.ip}`,
        enableSlowDown: false // No slow down for admin operations
    }),

    // Public API rate limiter (more lenient)
    public: rateLimiterFactory.create({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 300, // 300 requests per window
        message: 'Public API rate limit exceeded',
        enableSlowDown: true,
        dynamicLimits: true
    }),

    // Search rate limiter (prevent search abuse)
    search: rateLimiterFactory.create({
        windowMs: 60 * 1000, // 1 minute
        max: 30, // 30 searches per minute
        message: 'Search rate limit exceeded, please slow down',
        keyGenerator: (req) => `search:${req.user?.id || req.ip}`,
        onLimitReached: async (req, res, info) => {
            logger.info('Search rate limit exceeded', {
                query: req.query?.q || req.body?.query,
                ip: req.ip,
                userId: req.user?.id
            });
        }
    })
};

/**
 * Rate limiter analytics and management
 */
const analytics = {
    getStats: () => rateLimiterFactory.getAnalytics(),
    
    addToWhitelist: async (ip, ttl = RATE_LIMIT_CONFIG.WHITELIST_CACHE_TTL) => {
        if (!redisManager.client) return false;
        
        try {
            await redisManager.client.setex(`whitelist:${ip}`, ttl, JSON.stringify({
                timestamp: new Date().toISOString(),
                ttl
            }));
            logger.info('IP whitelisted', { ip, ttlSeconds: ttl });
            return true;
        } catch (error) {
            logger.error('Failed to whitelist IP', { error: error.message, ip });
            return false;
        }
    },
    
    addToBlacklist: (ip, ttl, reason) => rateLimiterFactory.addToBlacklist(ip, ttl, reason),
    
    removeFromWhitelist: async (ip) => {
        if (!redisManager.client) return false;
        
        try {
            await redisManager.client.del(`whitelist:${ip}`);
            logger.info('IP removed from whitelist', { ip });
            return true;
        } catch (error) {
            logger.error('Failed to remove IP from whitelist', { error: error.message, ip });
            return false;
        }
    },
    
    removeFromBlacklist: async (ip) => {
        if (!redisManager.client) return false;
        
        try {
            await redisManager.client.del(`blacklist:${ip}`);
            logger.info('IP removed from blacklist', { ip });
            return true;
        } catch (error) {
            logger.error('Failed to remove IP from blacklist', { error: error.message, ip });
            return false;
        }
    }
};

// Export rate limiters and utilities
module.exports = {
    // Factory
    RateLimiterFactory,
    rateLimiterFactory,
    
    // Pre-configured rate limiters
    ...rateLimiters,
    
    // Analytics and management
    analytics,
    
    // Error classes
    TooManyRequestsError,
    SuspiciousActivityError,
    
    // Configuration
    RATE_LIMIT_CONFIG,
    
    // Backward compatibility
    apiLimiter: rateLimiters.api,
    authLimiter: rateLimiters.auth
};
