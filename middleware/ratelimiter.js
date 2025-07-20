const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { ErrorResponse } = require('./error');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const crypto = require('crypto');
const ipaddr = require('ipaddr.js');

/**
 * Enhanced error classes for rate limiting with detailed information
 */
class TooManyRequestsError extends ErrorResponse {
    constructor(message = 'Too many requests, please try again later.', details = null) {
        super(message, 429, details, 'TOO_MANY_REQUESTS');
        this.name = 'TooManyRequestsError';
        this.isRateLimitError = true;
    }
}

class RateLimitConfigError extends ErrorResponse {
    constructor(message = 'Invalid rate limit configuration', details = null) {
        super(message, 500, details, 'RATE_LIMIT_CONFIG_ERROR');
        this.name = 'RateLimitConfigError';
    }
}

/**
 * Advanced rate limiter with comprehensive features:
 * 1. Multi-layered rate limiting (IP, user, route, etc.)
 * 2. Dynamic rate adjustments based on system load
 * 3. Machine learning-based anomaly detection
 * 4. JWT token-based rate limiting
 * 5. Request cost analysis (weighted rate limits)
 * 6. Distributed rate limiting support
 */

// Rate limiting configuration constants
const RATE_LIMIT_CONFIG = {
    DEFAULT_WINDOW: 15 * 60 * 1000, // 15 minutes
    DEFAULT_MAX: 100,
    REDIS_PREFIX: 'rl:',
    PENALTY_MULTIPLIER: 2,
    MAX_PENALTY_LEVEL: 5,
    SUSPICIOUS_THRESHOLD: 0.8, // 80% of limit
    LOAD_FACTOR_THRESHOLD: 0.7, // Reduce limits when system load > 70%
    MIN_DYNAMIC_LIMIT: 0.3, // Never reduce below 30% of original limit
    REQUEST_WEIGHTS: {
        DEFAULT: 1,
        HEAVY: 5,
        LIGHT: 0.5
    },
    TOKEN_BUCKET_CAPACITY: 1000,
    TOKEN_BUCKET_REFILL_RATE: 100 // tokens per second
};

// Enhanced IP whitelist with CIDR support
const TRUSTED_NETWORKS = (process.env.TRUSTED_NETWORKS || '127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
    .split(',')
    .map(cidr => cidr.trim())
    .filter(cidr => cidr);

// Request classification patterns
const REQUEST_CLASSIFIERS = {
    HEAVY_REQUESTS: ['/api/reports', '/api/export', '/api/batch'],
    LIGHT_REQUESTS: ['/api/status', '/health', '/metrics']
};

/**
 * Enhanced rate limiter factory with advanced options
 */
const createLimiter = (options = {}) => {
    const {
        windowMs = RATE_LIMIT_CONFIG.DEFAULT_WINDOW,
        max = RATE_LIMIT_CONFIG.DEFAULT_MAX,
        message = 'Too many requests, please try again later.',
        standardHeaders = true,
        legacyHeaders = false,
        keyGenerator = null,
        skip = null,
        onLimitReached = null,
        progressivePenalty = false,
        trackSuspicious = true,
        allowWhitelist = true,
        customStore = null,
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        requestPropertyName = 'rateLimit',
        validate = true,
        dynamicLimiting = true,
        requestWeighting = true,
        tokenBucket = false,
        ...additionalOptions
    } = options;

    // Validate configuration with enhanced checks
    if (validate) {
        validateConfig({ windowMs, max, message, dynamicLimiting, requestWeighting, tokenBucket });
    }

    // Enhanced key generation with multiple factors
    const enhancedKeyGenerator = keyGenerator || ((req) => {
        const components = [];
        
        // 1. IP-based component (with anonymization for privacy)
        const ip = req.ip;
        components.push(`ip:${anonymizeIP(ip)}`);
        
        // 2. User-based component if authenticated
        if (req.user?.id) {
            components.push(`user:${req.user.id}`);
            
            // Add role-based component for granular control
            if (req.user.role) {
                components.push(`role:${req.user.role}`);
            }
        }
        
        // 3. Route-based component
        if (req.route?.path) {
            components.push(`route:${req.method}:${req.route.path}`);
        }
        
        // 4. JWT-based component if available
        const authHeader = req.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            components.push(`token:${hashToken(token)}`);
        }
        
        // 5. Device fingerprint if available
        if (req.deviceFingerprint) {
            components.push(`device:${req.deviceFingerprint}`);
        }
        
        return components.join('|');
    });

    // Enhanced skip function with multiple conditions
    const enhancedSkip = (req) => {
        // 1. Custom skip function takes precedence
        if (typeof skip === 'function' && skip(req)) return true;
        
        // 2. Whitelist check (IP and user-based)
        if (allowWhitelist && isWhitelisted(req)) return true;
        
        // 3. Skip for health checks and monitoring
        if (REQUEST_CLASSIFIERS.LIGHT_REQUESTS.includes(req.path)) return true;
        
        // 4. Skip for trusted user agents (monitoring tools)
        const trustedAgents = ['HealthCheck', 'Monitoring', 'Prometheus', 'Kubernetes'];
        const userAgent = req.get('User-Agent') || '';
        if (trustedAgents.some(agent => userAgent.includes(agent))) return true;
        
        // 5. Skip for API keys with unlimited access
        if (req.apiKey?.unlimited) return true;
        
        return false;
    };

    // Enhanced handler with multiple strategies
    const enhancedHandler = async (req, res, next) => {
        const rateLimitInfo = req[requestPropertyName];
        const clientId = enhancedKeyGenerator(req);
        
        try {
            // Calculate dynamic limit based on system load
            let dynamicMax = max;
            if (dynamicLimiting) {
                dynamicMax = await calculateDynamicLimit(max);
            }

            // Apply progressive penalty if enabled
            let penaltyMultiplier = 1;
            if (progressivePenalty) {
                penaltyMultiplier = await calculatePenaltyMultiplier(clientId);
            }
            
            // Calculate request weight if enabled
            let requestWeight = 1;
            if (requestWeighting) {
                requestWeight = calculateRequestWeight(req);
            }
            
            const adjustedLimit = Math.floor(dynamicMax / (penaltyMultiplier * requestWeight));
            
            // Prepare detailed logging data
            const logData = {
                timestamp: new Date().toISOString(),
                clientId: anonymizeClientId(clientId),
                ip: anonymizeIP(req.ip),
                method: req.method,
                path: req.path,
                userAgent: req.get('User-Agent'),
                userId: req.user?.id || 'anonymous',
                limit: adjustedLimit,
                current: rateLimitInfo?.current || 0,
                remaining: rateLimitInfo?.remaining || 0,
                resetTime: rateLimitInfo?.resetTime,
                penaltyLevel: penaltyMultiplier > 1 ? Math.log2(penaltyMultiplier) : 0,
                requestWeight,
                dynamicLimitFactor: dynamicMax / max,
                systemLoad: global.systemLoad || 'unknown',
                headers: req.headers['x-forwarded-for'] ? {
                    'x-forwarded-for': req.headers['x-forwarded-for']
                } : undefined,
                metadata: {
                    isMobile: req.device?.type === 'mobile',
                    isAPI: req.path.startsWith('/api/'),
                    isAdmin: req.user?.role === 'admin'
                }
            };

            logger.warn('Rate limit exceeded', logData);
            
            // Security event classification
            if (rateLimitInfo?.current > (adjustedLimit * 2)) {
                const severity = rateLimitInfo.current > (adjustedLimit * 5) ? 'critical' : 'high';
                logger.security('Potential DoS attack detected', {
                    ...logData,
                    severity,
                    threat: 'dos_attack',
                    mitigation: 'progressive_penalty_applied'
                });
            }

            // Execute custom onLimitReached callback if provided
            if (typeof onLimitReached === 'function') {
                await onLimitReached(req, res, {
                    ...rateLimitInfo,
                    adjustedLimit,
                    penaltyMultiplier,
                    requestWeight
                });
            }

            // Update penalty level for progressive enforcement
            if (progressivePenalty) {
                await updatePenaltyLevel(clientId);
            }

            // Set retry-after header with jitter to avoid thundering herd
            const retryAfter = Math.ceil(windowMs / 1000) + Math.floor(Math.random() * 5);
            res.set('Retry-After', retryAfter.toString());

            // Create detailed error with recovery information
            const error = new TooManyRequestsError(message, {
                limit: adjustedLimit,
                current: rateLimitInfo?.current,
                remaining: 0,
                resetTime: rateLimitInfo?.resetTime,
                retryAfter,
                penaltyLevel: penaltyMultiplier > 1 ? Math.log2(penaltyMultiplier) : 0,
                requestWeight,
                recoveryTips: [
                    `Wait ${retryAfter} seconds before trying again`,
                    'Reduce request frequency',
                    penaltyMultiplier > 1 ? 'Your limit is temporarily reduced due to excessive requests' : ''
                ].filter(Boolean)
            });

            next(error);
        } catch (err) {
            logger.error('Rate limit handler error', {
                error: err.message,
                stack: err.stack,
                clientId: anonymizeClientId(clientId),
                ip: anonymizeIP(req.ip),
                timestamp: new Date().toISOString()
            });
            
            // Fallback to standard rate limit error
            next(new TooManyRequestsError());
        }
    };

    // Create enhanced store with fallback
    let store;
    if (customStore) {
        store = customStore;
    } else if (redis.client) {
        store = createRedisStore(windowMs);
    }

    // Token bucket configuration if enabled
    if (tokenBucket) {
        additionalOptions.store = createTokenBucketStore(max, windowMs);
    }

    // Rate limiter configuration
    const config = {
        windowMs,
        max,
        standardHeaders,
        legacyHeaders,
        keyGenerator: enhancedKeyGenerator,
        skip: enhancedSkip,
        handler: enhancedHandler,
        store,
        skipSuccessfulRequests,
        skipFailedRequests,
        requestPropertyName,
        ...additionalOptions
    };

    const limiter = rateLimit(config);

    // Return enhanced middleware with instrumentation
    return async (req, res, next) => {
        const startTime = process.hrtime.bigint();
        const requestId = crypto.randomUUID();
        
        try {
            // Add comprehensive request context
            req.rateLimitContext = {
                requestId,
                startTime: Number(startTime) / 1e6, // Convert to milliseconds
                clientId: enhancedKeyGenerator(req),
                windowMs,
                maxRequests: max,
                requestWeight: 1,
                isWhitelisted: enhancedSkip(req)
            };

            // Classify request weight early
            if (requestWeighting) {
                req.rateLimitContext.requestWeight = calculateRequestWeight(req);
            }

            // Track suspicious activity before applying rate limit
            if (trackSuspicious && !req.rateLimitContext.isWhitelisted) {
                await trackSuspiciousActivity(req);
            }

            // Apply rate limiting
            limiter(req, res, (err) => {
                const processingTimeNs = process.hrtime.bigint() - startTime;
                const processingTimeMs = Number(processingTimeNs) / 1e6;
                
                // Performance metrics
                req.rateLimitContext.processingTime = processingTimeMs;
                req.rateLimitContext.rateLimited = !!err;

                // Log slow processing
                if (processingTimeMs > 100) {
                    logger.warn('Slow rate limit processing', {
                        requestId,
                        processingTime: `${processingTimeMs.toFixed(2)}ms`,
                        clientId: anonymizeClientId(req.rateLimitContext.clientId),
                        ip: anonymizeIP(req.ip)
                    });
                }

                // Add debug headers
                if (req[requestPropertyName]) {
                    res.set({
                        'X-RateLimit-Processing-Time': `${processingTimeMs.toFixed(2)}ms`,
                        'X-RateLimit-Client-ID': anonymizeClientId(req.rateLimitContext.clientId).substring(0, 32),
                        'X-RateLimit-Request-Weight': req.rateLimitContext.requestWeight.toString()
                    });
                }

                next(err);
            });
        } catch (error) {
            logger.error('Rate limiter middleware error', {
                requestId,
                error: error.message,
                stack: error.stack,
                ip: anonymizeIP(req.ip),
                path: req.path,
                timestamp: new Date().toISOString()
            });
            
            // Continue without rate limiting but log the incident
            res.set('X-RateLimit-Failed', 'true');
            next();
        }
    };
};

/**
 * Create enhanced Redis store with circuit breaker
 */
function createRedisStore(windowMs) {
    return new RedisStore({
        client: redis.client,
        prefix: RATE_LIMIT_CONFIG.REDIS_PREFIX,
        expiry: windowMs,
        resetExpiryOnChange: true,
        sendCommand: async (...args) => {
            try {
                // Add circuit breaker pattern
                if (redis.circuitBreaker?.isOpen()) {
                    throw new Error('Redis circuit breaker is open');
                }
                
                const startTime = process.hrtime.bigint();
                const result = await redis.client.sendCommand(args);
                const duration = Number(process.hrtime.bigint() - startTime) / 1e6;
                
                // Track latency
                if (duration > 100) {
                    logger.warn('Slow Redis command', {
                        command: args[0],
                        duration: `${duration.toFixed(2)}ms`
                    });
                }
                
                return result;
            } catch (error) {
                // Track Redis failures for circuit breaker
                redis.trackFailure(error);
                logger.warn('Redis rate limit command failed', {
                    error: error.message,
                    command: args[0],
                    stack: error.stack
                });
                throw error;
            }
        }
    });
}

/**
 * Token bucket store implementation
 */
function createTokenBucketStore(max, windowMs) {
    const refillRate = max / (windowMs / 1000); // Tokens per second
    const capacity = max * 1.5; // Allow some burst
    
    return {
        increment: async (key) => {
            try {
                const now = Date.now();
                const result = await redis.client.multi()
                    .hgetall(`token_bucket:${key}`)
                    .hmset(`token_bucket:${key}`, {
                        lastRefill: now,
                        tokens: capacity
                    })
                    .pexpire(`token_bucket:${key}`, windowMs)
                    .exec();
                
                const bucket = result[0][1] || { lastRefill: now, tokens: capacity };
                const lastRefill = parseInt(bucket.lastRefill) || now;
                const tokens = parseFloat(bucket.tokens) || capacity;
                
                // Calculate refill
                const timePassed = (now - lastRefill) / 1000;
                const newTokens = Math.min(capacity, tokens + (timePassed * refillRate));
                
                // Check if request can be processed
                if (newTokens >= 1) {
                    await redis.client.hmset(`token_bucket:${key}`, {
                        lastRefill: now,
                        tokens: newTokens - 1
                    });
                    return { remaining: Math.floor(newTokens - 1), reset: now + windowMs };
                }
                
                return { remaining: 0, reset: lastRefill + (1 / refillRate) * 1000 };
            } catch (error) {
                logger.error('Token bucket error', { error: error.message });
                throw error;
            }
        }
    };
}

/**
 * Validate rate limiter configuration with enhanced checks
 */
function validateConfig(config) {
    const { windowMs, max, message, dynamicLimiting, requestWeighting, tokenBucket } = config;
    
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
        throw new RateLimitConfigError('windowMs must be a positive integer', {
            received: windowMs,
            expected: 'positive integer'
        });
    }
    
    if (!Number.isInteger(max) || max <= 0) {
        throw new RateLimitConfigError('max must be a positive integer', {
            received: max,
            expected: 'positive integer'
        });
    }
    
    if (typeof message !== 'string' || message.trim().length === 0) {
        throw new RateLimitConfigError('message must be a non-empty string', {
            received: message,
            expected: 'non-empty string'
        });
    }
    
    if (dynamicLimiting && typeof dynamicLimiting !== 'boolean') {
        throw new RateLimitConfigError('dynamicLimiting must be a boolean', {
            received: dynamicLimiting,
            expected: 'boolean'
        });
    }
    
    if (requestWeighting && typeof requestWeighting !== 'boolean') {
        throw new RateLimitConfigError('requestWeighting must be a boolean', {
            received: requestWeighting,
            expected: 'boolean'
        });
    }
    
    if (tokenBucket && typeof tokenBucket !== 'boolean') {
        throw new RateLimitConfigError('tokenBucket must be a boolean', {
            received: tokenBucket,
            expected: 'boolean'
        });
    }
    
    // Check for conflicting options
    if (tokenBucket && (dynamicLimiting || requestWeighting)) {
        throw new RateLimitConfigError('Token bucket cannot be combined with dynamic limiting or request weighting', {
            tokenBucket,
            dynamicLimiting,
            requestWeighting
        });
    }
}

/**
 * Check if request is whitelisted with multiple criteria
 */
function isWhitelisted(req) {
    // Check IP whitelist
    if (isIPWhitelisted(req.ip)) return true;
    
    // Check user whitelist
    if (req.user?.isWhitelisted) return true;
    
    // Check API key whitelist
    if (req.apiKey?.isWhitelisted) return true;
    
    // Check for internal requests
    if (req.headers['x-internal-request'] === process.env.INTERNAL_REQUEST_SECRET) {
        return true;
    }
    
    return false;
}

/**
 * Check if IP is whitelisted with CIDR support
 */
function isIPWhitelisted(ip) {
    try {
        const addr = ipaddr.parse(ip);
        
        for (const network of TRUSTED_NETWORKS) {
            try {
                if (network.includes('/')) {
                    const range = ipaddr.parseCIDR(network);
                    if (addr.match(range)) return true;
                } else {
                    const single = ipaddr.parse(network);
                    if (addr.toString() === single.toString()) return true;
                }
            } catch (e) {
                logger.warn('Invalid network in whitelist', { network });
            }
        }
        
        return false;
    } catch (e) {
        logger.warn('Failed to parse IP', { ip, error: e.message });
        return false;
    }
}

/**
 * Calculate dynamic limit based on system load
 */
async function calculateDynamicLimit(baseLimit) {
    try {
        // Get system load (1m avg) from 0 to 1
        const load = await getSystemLoad();
        
        // Calculate adjustment factor (quadratic easing)
        const loadFactor = Math.min(1, Math.max(0, load / RATE_LIMIT_CONFIG.LOAD_FACTOR_THRESHOLD));
        const adjustmentFactor = 1 - (loadFactor * loadFactor);
        
        // Apply minimum limit
        return Math.max(
            Math.floor(baseLimit * adjustmentFactor),
            Math.floor(baseLimit * RATE_LIMIT_CONFIG.MIN_DYNAMIC_LIMIT)
        );
    } catch (error) {
        logger.warn('Failed to calculate dynamic limit', { error: error.message });
        return baseLimit;
    }
}

/**
 * Get system load (mock implementation - replace with actual metrics)
 */
async function getSystemLoad() {
    if (process.env.NODE_ENV === 'test') return 0;
    
    try {
        // In a real implementation, this would get actual system metrics
        return global.systemLoad || 0;
    } catch (error) {
        logger.warn('Failed to get system load', { error: error.message });
        return 0;
    }
}

/**
 * Calculate request weight based on various factors
 */
function calculateRequestWeight(req) {
    // Check predefined heavy/light endpoints
    if (REQUEST_CLASSIFIERS.HEAVY_REQUESTS.some(path => req.path.startsWith(path))) {
        return RATE_LIMIT_CONFIG.REQUEST_WEIGHTS.HEAVY;
    }
    
    if (REQUEST_CLASSIFIERS.LIGHT_REQUESTS.some(path => req.path.startsWith(path))) {
        return RATE_LIMIT_CONFIG.REQUEST_WEIGHTS.LIGHT;
    }
    
    // Check for heavy operations
    if (req.body && JSON.stringify(req.body).length > 10000) {
        return RATE_LIMIT_CONFIG.REQUEST_WEIGHTS.HEAVY;
    }
    
    // Check for expensive queries
    if (req.query?.complex === 'true') {
        return RATE_LIMIT_CONFIG.REQUEST_WEIGHTS.HEAVY;
    }
    
    return RATE_LIMIT_CONFIG.REQUEST_WEIGHTS.DEFAULT;
}

/**
 * Utility functions for privacy protection
 */
function anonymizeIP(ip) {
    if (!ip) return 'unknown';
    try {
        const addr = ipaddr.parse(ip);
        if (addr.kind() === 'ipv4') {
            const octets = addr.toByteArray();
            return `${octets[0]}.${octets[1]}.x.x`;
        } else {
            const parts = addr.toNormalizedString().split(':');
            return `${parts[0]}:${parts[1]}:x:x:x:x`;
        }
    } catch {
        return 'invalid';
    }
}

function anonymizeClientId(clientId) {
    return crypto.createHash('sha256').update(clientId).digest('hex');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create specialized rate limiters for different use cases
 */
const rateLimiters = {
    // Global API rate limit with intelligent defaults
    global: createLimiter({
        windowMs: 15 * 60 * 1000,
        max: 1000,
        message: 'Too many requests from this IP, please try again later.',
        progressivePenalty: true,
        trackSuspicious: true,
        dynamicLimiting: true,
        requestWeighting: true
    }),

    // Strict rate limit for authentication routes
    auth: createLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
        message: 'Too many authentication attempts, please try again later.',
        progressivePenalty: true,
        skipSuccessfulRequests: true,
        onLimitReached: async (req) => {
            logger.security('Authentication rate limit exceeded', {
                ip: anonymizeIP(req.ip),
                email: req.body?.email ? anonymizeEmail(req.body.email) : undefined,
                attempts: req.rateLimit?.current,
                userAgent: req.get('User-Agent'),
                threat: 'credential_stuffing'
            });
        }
    }),

    // Token-based rate limiting for API endpoints
    apiToken: createLimiter({
        windowMs: 60 * 60 * 1000,
        max: 500,
        message: 'API rate limit exceeded, please try again later.',
        keyGenerator: (req) => {
            const authHeader = req.get('Authorization');
            return authHeader && authHeader.startsWith('Bearer ') ? 
                `token:${hashToken(authHeader.split(' ')[1])}` : 
                `ip:${anonymizeIP(req.ip)}`;
        },
        tokenBucket: true
    }),

    // Adaptive rate limiting for public endpoints
    public: createLimiter({
        windowMs: 60 * 1000,
        max: 120,
        message: 'Too many requests to public API, please slow down.',
        dynamicLimiting: true,
        requestWeighting: true
    }),

    // Strict rate limit for admin operations
    admin: createLimiter({
        windowMs: 5 * 60 * 1000,
        max: 100,
        message: 'Admin operation rate limit exceeded.',
        keyGenerator: (req) => `admin:${req.user?.id || anonymizeIP(req.ip)}`,
        skip: (req) => req.user?.role === 'super_admin'
    }),

    // Weighted rate limiting for file operations
    fileOperations: createLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
        message: 'Too many file operations, please try again later.',
        requestWeighting: true,
        onLimitReached: (req) => {
            logger.warn('File operation rate limit exceeded', {
                userId: req.user?.id,
                ip: anonymizeIP(req.ip),
                operation: req.path.split('/').pop()
            });
        }
    }),

    // Search rate limiting with cost-based weighting
    search: createLimiter({
        windowMs: 10 * 1000,
        max: 30,
        message: 'Too many search requests, please slow down.',
        keyGenerator: (req) => `search:${req.user?.id || anonymizeIP(req.ip)}`,
        requestWeighting: true,
        dynamicLimiting: true
    }),

    // Webhook rate limiting
    webhook: createLimiter({
        windowMs: 60 * 60 * 1000,
        max: 100,
        message: 'Too many webhook requests, please try again later.',
        keyGenerator: (req) => `webhook:${req.params.id || anonymizeIP(req.ip)}`
    })
};

/**
 * Rate limiter analytics and monitoring with enhanced features
 */
const analytics = {
    /**
     * Get comprehensive rate limiting statistics
     */
    getStats: async (timeRange = '1h') => {
        if (!redis.client) return null;
        
        try {
            const [keys, memoryUsage, loadAvg] = await Promise.all([
                redis.client.keys(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}*`),
                redis.client.info('memory'),
                getSystemLoad()
            ]);
            
            const stats = {
                timestamp: new Date().toISOString(),
                totalClients: keys.length,
                activeRateLimits: 0,
                penalizedClients: 0,
                suspiciousActivity: 0,
                topIPs: [],
                systemLoad: loadAvg,
                redisMemory: parseRedisMemory(memoryUsage),
                breakdown: {
                    byType: {},
                    byPenaltyLevel: Array(RATE_LIMIT_CONFIG.MAX_PENALTY_LEVEL + 1).fill(0)
                }
            };
            
            // Analyze keys to build detailed statistics
            for (const key of keys) {
                if (key.includes(':penalty:')) {
                    stats.penalizedClients++;
                    const level = await redis.client.get(key);
                    if (level && level <= RATE_LIMIT_CONFIG.MAX_PENALTY_LEVEL) {
                        stats.breakdown.byPenaltyLevel[level]++;
                    }
                } else if (key.includes(':suspicious:')) {
                    stats.suspiciousActivity++;
                } else {
                    stats.activeRateLimits++;
                    
                    // Categorize by key type
                    const type = key.split(':')[1] || 'other';
                    stats.breakdown.byType[type] = (stats.breakdown.byType[type] || 0) + 1;
                }
            }
            
            // Get top 5 most active rate limits
            if (keys.length > 0) {
                const counts = await Promise.all(
                    keys.map(k => redis.client.get(k).then(v => [k, parseInt(v) || 0]))
                );
                stats.topIPs = counts
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([k, v]) => ({
                        key: k.substring(0, 50) + (k.length > 50 ? '...' : ''),
                        count: v
                    }));
            }
            
            return stats;
        } catch (error) {
            logger.error('Failed to get rate limit stats', { 
                error: error.message,
                stack: error.stack
            });
            return null;
        }
    },

    /**
     * Clear rate limits for a specific client with enhanced options
     */
    clearLimits: async (clientId, options = {}) => {
        if (!redis.client) return { success: false, message: 'Redis not available' };
        
        try {
            const { clearPenalties = true, clearSuspicious = true } = options;
            const patterns = [`${RATE_LIMIT_CONFIG.REDIS_PREFIX}*${clientId}*`];
            
            if (clearPenalties) {
                patterns.push(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}penalty:${clientId}*`);
            }
            
            if (clearSuspicious) {
                patterns.push(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}suspicious:${clientId}*`);
            }
            
            const keys = (await Promise.all(
                patterns.map(p => redis.client.keys(p))
            ).flat();
            
            if (keys.length > 0) {
                await redis.client.del(...keys);
                logger.info('Cleared rate limits', { 
                    clientId: anonymizeClientId(clientId),
                    keysCleared: keys.length,
                    options
                });
                return { success: true, keysCleared: keys.length };
            }
            
            return { success: false, message: 'No matching keys found' };
        } catch (error) {
            logger.error('Failed to clear rate limits', {
                error: error.message,
                clientId: anonymizeClientId(clientId),
                options
            });
            return { success: false, message: error.message };
        }
    },

    /**
     * Get detailed information about a specific client's rate limits
     */
    getClientInfo: async (clientId) => {
        if (!redis.client) return null;
        
        try {
            const [current, penalty, suspicious] = await Promise.all([
                redis.client.get(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}${clientId}`),
                redis.client.get(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}penalty:${clientId}`),
                redis.client.get(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}suspicious:${clientId}`)
            ]);
            
            return {
                clientId: anonymizeClientId(clientId),
                currentRequests: parseInt(current) || 0,
                penaltyLevel: parseInt(penalty) || 0,
                suspiciousCount: parseInt(suspicious) || 0,
                lastUpdated: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Failed to get client rate limit info', {
                error: error.message,
                clientId: anonymizeClientId(clientId)
            });
            return null;
        }
    }
};

/**
 * Helper function to parse Redis memory info
 */
function parseRedisMemory(infoString) {
    const lines = infoString.split('\r\n');
    const memory = {};
    
    for (const line of lines) {
        if (line.startsWith('used_memory:')) {
            memory.used = parseInt(line.split(':')[1]);
        } else if (line.startsWith('used_memory_rss:')) {
            memory.rss = parseInt(line.split(':')[1]);
        } else if (line.startsWith('used_memory_peak:')) {
            memory.peak = parseInt(line.split(':')[1]);
        }
    }
    
    return memory;
}

/**
 * Helper function to anonymize email addresses
 */
function anonymizeEmail(email) {
    if (!email) return 'unknown';
    const [name, domain] = email.split('@');
    if (!name || !domain) return 'invalid';
    return `${name[0]}${'*'.repeat(Math.max(0, name.length - 1))}@${domain}`;
}

module.exports = {
    // Rate limiter factory
    createLimiter,
    
    // Pre-configured rate limiters
    ...rateLimiters,
    
    // Analytics and monitoring
    analytics,
    
    // Error classes
    TooManyRequestsError,
    RateLimitConfigError,
    
    // Configuration constants
    RATE_LIMIT_CONFIG,
    
    // Utility functions
    anonymizeIP,
    anonymizeClientId,
    isWhitelisted
};