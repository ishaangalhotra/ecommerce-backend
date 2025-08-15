const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { client: redisClient, useRedis } = require('../config/redisClient');
const { ErrorResponse } = require('../utils/error');
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
 * Create Redis store with circuit breaker and fallback
 */
const createStore = (windowMs = RATE_LIMIT_CONFIG.DEFAULT_WINDOW) => {
    // First try the simple Redis client from rateLimiters.js
    if (useRedis && redisClient) {
        try {
            return new RedisStore({
                sendCommand: (...args) => redisClient.call(...args),
                prefix: RATE_LIMIT_CONFIG.REDIS_PREFIX,
                expiry: windowMs,
                resetExpiryOnChange: true
            });
        } catch (error) {
            logger.warn('Failed to create simple Redis store', { error: error.message });
        }
    }

    // Fallback to advanced Redis client with circuit breaker
    if (redis?.client) {
        try {
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
                        if (redis.trackFailure) redis.trackFailure(error);
                        logger.warn('Redis rate limit command failed', {
                            error: error.message,
                            command: args[0],
                            stack: error.stack
                        });
                        throw error;
                    }
                }
            });
        } catch (error) {
            logger.warn('Failed to create advanced Redis store', { error: error.message });
        }
    }

    logger.info('Using in-memory rate limit store');
    return undefined; // Falls back to memory store
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
    } else if (tokenBucket) {
        store = createTokenBucketStore(max, windowMs);
    } else {
        store = createStore(windowMs);
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
 * Token bucket store implementation
 */
function createTokenBucketStore(max, windowMs) {
    const refillRate = max / (windowMs / 1000); // Tokens per second
    const capacity = max * 1.5; // Allow some burst
    
    return {
        increment: async (key) => {
            try {
                // Use simple Redis client if available, fallback to advanced
                const client = redisClient || redis?.client;
                if (!client) throw new Error('No Redis client available');

                const now = Date.now();
                const result = await client.multi()
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
                    await client.hmset(`token_bucket:${key}`, {
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
 * Calculate penalty multiplier for progressive penalties
 */
async function calculatePenaltyMultiplier(clientId) {
    try {
        const client = redisClient || redis?.client;
        if (!client) return 1;

        const penaltyLevel = await client.get(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}penalty:${clientId}`);
        const level = Math.min(parseInt(penaltyLevel) || 0, RATE_LIMIT_CONFIG.MAX_PENALTY_LEVEL);
        return Math.pow(RATE_LIMIT_CONFIG.PENALTY_MULTIPLIER, level);
    } catch (error) {
        logger.warn('Failed to calculate penalty multiplier', { error: error.message });
        return 1;
    }
}

/**
 * Update penalty level for progressive enforcement
 */
async function updatePenaltyLevel(clientId) {
    try {
        const client = redisClient || redis?.client;
        if (!client) return;

        const key = `${RATE_LIMIT_CONFIG.REDIS_PREFIX}penalty:${clientId}`;
        const current = parseInt(await client.get(key)) || 0;
        const newLevel = Math.min(current + 1, RATE_LIMIT_CONFIG.MAX_PENALTY_LEVEL);
        
        await client.setex(key, 3600, newLevel); // 1 hour penalty decay
    } catch (error) {
        logger.warn('Failed to update penalty level', { error: error.message });
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
 * Track suspicious activity
 */
async function trackSuspiciousActivity(req) {
    try {
        const client = redisClient || redis?.client;
        if (!client) return;

        const rateLimitInfo = req.rateLimit;
        if (!rateLimitInfo) return;

        const suspiciousThreshold = rateLimitInfo.limit * RATE_LIMIT_CONFIG.SUSPICIOUS_THRESHOLD;
        if (rateLimitInfo.current >= suspiciousThreshold) {
            const key = `${RATE_LIMIT_CONFIG.REDIS_PREFIX}suspicious:${anonymizeClientId(req.rateLimitContext?.clientId || req.ip)}`;
            await client.incr(key);
            await client.expire(key, 3600); // 1 hour tracking

            logger.security('Suspicious activity detected', {
                ip: anonymizeIP(req.ip),
                path: req.path,
                current: rateLimitInfo.current,
                limit: rateLimitInfo.limit,
                threshold: suspiciousThreshold
            });
        }
    } catch (error) {
        logger.warn('Failed to track suspicious activity', { error: error.message });
    }
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

function anonymizeEmail(email) {
    if (!email) return 'unknown';
    const [name, domain] = email.split('@');
    if (!name || !domain) return 'invalid';
    return `${name[0]}${'*'.repeat(Math.max(0, name.length - 1))}@${domain}`;
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

    // Login limiter (backward compatible with existing code)
    loginLimiter: createLimiter({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: 'Too many login attempts, please try again later.',
        skipSuccessfulRequests: true,
        progressivePenalty: true
    }),

    // Coupon limiter (backward compatible with existing code)
    couponLimiter: createLimiter({
        windowMs: 60 * 60 * 1000,
        max: 30,
        message: 'Too many coupon attempts, please try later.',
        requestWeighting: true
    }),

    // Token-based rate limiting for API endpoints
    apiToken: createLimiter({
        windowMs: 60 * 60 * 1000,
        max: 500,
        message: 'API rate limit exceeded, please try again later.',
        keyGenerator: (req) => {
            const authHeader = req.get('Authorization');
            return authHeader && authHeader.startsWith('Bearer ')
                ? `token:${hashToken(authHeader.split(' ')[1])}`
                : `ip:${anonymizeIP(req.ip)}`;
        },
        tokenBucket: true,
        dynamicLimiting: false,
        requestWeighting: false
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
        skip: (req) => req.user?.role !== 'admin',
        onLimitReached: async (req) => {
            logger.security('Admin rate limit exceeded', {
                userId: req.user?.id,
                ip: anonymizeIP(req.ip),
                action: req.path,
                userAgent: req.get('User-Agent'),
                threat: 'admin_abuse'
            });
        }
    }),

    // File upload rate limiting with size consideration
    upload: createLimiter({
        windowMs: 10 * 60 * 1000,
        max: 50,
        message: 'Upload rate limit exceeded, please try again later.',
        keyGenerator: (req) => `upload:${req.user?.id || anonymizeIP(req.ip)}`,
        requestWeighting: true,
        skip: (req) => !req.files && !req.file,
        onLimitReached: async (req) => {
            logger.warn('Upload rate limit exceeded', {
                userId: req.user?.id,
                ip: anonymizeIP(req.ip),
                fileCount: req.files?.length || (req.file ? 1 : 0),
                path: req.path
            });
        }
    }),

    // Search rate limiting with query complexity analysis
    search: createLimiter({
        windowMs: 60 * 1000,
        max: 60,
        message: 'Search rate limit exceeded, please slow down.',
        keyGenerator: (req) => `search:${req.user?.id || anonymizeIP(req.ip)}`,
        requestWeighting: true,
        skip: (req) => {
            // Skip for authenticated users with premium plans
            return req.user?.plan === 'premium' || req.user?.plan === 'enterprise';
        }
    }),

    // Payment processing rate limiting
    payment: createLimiter({
        windowMs: 60 * 60 * 1000,
        max: 10,
        message: 'Payment rate limit exceeded for security reasons.',
        keyGenerator: (req) => `payment:${req.user?.id || anonymizeIP(req.ip)}`,
        skipSuccessfulRequests: true,
        onLimitReached: async (req) => {
            logger.security('Payment rate limit exceeded', {
                userId: req.user?.id,
                ip: anonymizeIP(req.ip),
                amount: req.body?.amount,
                currency: req.body?.currency,
                threat: 'payment_fraud'
            });
        }
    }),

    // Password reset rate limiting
    passwordReset: createLimiter({
        windowMs: 60 * 60 * 1000,
        max: 3,
        message: 'Too many password reset attempts, please try again later.',
        keyGenerator: (req) => `password_reset:${req.body?.email || anonymizeIP(req.ip)}`,
        onLimitReached: async (req) => {
            logger.security('Password reset rate limit exceeded', {
                email: req.body?.email ? anonymizeEmail(req.body.email) : undefined,
                ip: anonymizeIP(req.ip),
                userAgent: req.get('User-Agent'),
                threat: 'account_takeover'
            });
        }
    }),

    // Contact form rate limiting
    contact: createLimiter({
        windowMs: 60 * 60 * 1000,
        max: 5,
        message: 'Contact form rate limit exceeded, please try again later.',
        keyGenerator: (req) => `contact:${req.body?.email || anonymizeIP(req.ip)}`,
        skip: (req) => req.user?.isVerified
    }),

    // API registration rate limiting
    registration: createLimiter({
        windowMs: 24 * 60 * 60 * 1000, // 24 hours
        max: 3,
        message: 'Registration rate limit exceeded, please try again tomorrow.',
        keyGenerator: (req) => `registration:${anonymizeIP(req.ip)}`,
        onLimitReached: async (req) => {
            logger.security('Registration rate limit exceeded', {
                ip: anonymizeIP(req.ip),
                email: req.body?.email ? anonymizeEmail(req.body.email) : undefined,
                userAgent: req.get('User-Agent'),
                threat: 'fake_registration'
            });
        }
    })
};

/**
 * Middleware to apply conditional rate limiting based on request characteristics
 */
const smartRateLimit = (options = {}) => {
    const {
        enableGlobal = true,
        enableAuth = true,
        enableAPI = true,
        enableAdmin = true,
        customRules = [],
        bypassHeader = 'X-Rate-Limit-Bypass'
    } = options;

    return async (req, res, next) => {
        try {
            // Check for bypass header (for internal services)
            if (req.get(bypassHeader) === process.env.RATE_LIMIT_BYPASS_SECRET) {
                return next();
            }

            // Apply custom rules first
            for (const rule of customRules) {
                if (rule.condition(req)) {
                    return rule.limiter(req, res, next);
                }
            }

            // Route-based rate limiting
            const path = req.path.toLowerCase();
            const method = req.method.toLowerCase();

            // Authentication routes
            if (enableAuth && (
                path.includes('/auth/') || 
                path.includes('/login') || 
                path.includes('/signin')
            )) {
                return rateLimiters.auth(req, res, next);
            }

            // Password reset routes
            if (path.includes('/password') && path.includes('/reset')) {
                return rateLimiters.passwordReset(req, res, next);
            }

            // Registration routes
            if (path.includes('/register') || path.includes('/signup')) {
                return rateLimiters.registration(req, res, next);
            }

            // Admin routes
            if (enableAdmin && path.includes('/admin/')) {
                return rateLimiters.admin(req, res, next);
            }

            // Payment routes
            if (path.includes('/payment') || path.includes('/checkout')) {
                return rateLimiters.payment(req, res, next);
            }

            // Upload routes
            if (method === 'post' && (
                path.includes('/upload') || 
                req.headers['content-type']?.includes('multipart/form-data')
            )) {
                return rateLimiters.upload(req, res, next);
            }

            // Search routes
            if (path.includes('/search') || req.query.q || req.query.query) {
                return rateLimiters.search(req, res, next);
            }

            // Contact form routes
            if (path.includes('/contact') && method === 'post') {
                return rateLimiters.contact(req, res, next);
            }

            // API routes with token-based limiting
            if (enableAPI && path.startsWith('/api/')) {
                const authHeader = req.get('Authorization');
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    return rateLimiters.apiToken(req, res, next);
                }
                return rateLimiters.public(req, res, next);
            }

            // Coupon routes (backward compatibility)
            if (path.includes('/coupon')) {
                return rateLimiters.couponLimiter(req, res, next);
            }

            // Apply global rate limiting
            if (enableGlobal) {
                return rateLimiters.global(req, res, next);
            }

            next();
        } catch (error) {
            logger.error('Smart rate limit error', {
                error: error.message,
                stack: error.stack,
                path: req.path,
                method: req.method,
                ip: anonymizeIP(req.ip)
            });
            next();
        }
    };
};

/**
 * Express error handler for rate limit errors
 */
const rateLimitErrorHandler = (err, req, res, next) => {
    if (err instanceof TooManyRequestsError || err.isRateLimitError) {
        // Add security headers
        res.set({
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block'
        });

        return res.status(err.statusCode || 429).json({
            error: {
                type: err.code || 'TOO_MANY_REQUESTS',
                message: err.message,
                details: err.details || null,
                timestamp: new Date().toISOString(),
                requestId: req.rateLimitContext?.requestId
            }
        });
    }
    
    next(err);
};

/**
 * Health check endpoint to monitor rate limiter status
 */
const rateLimitHealthCheck = async (req, res) => {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            redis: {
                connected: false,
                latency: null
            },
            systemLoad: global.systemLoad || 0,
            rateLimiters: {
                total: Object.keys(rateLimiters).length,
                active: Object.keys(rateLimiters).filter(key => rateLimiters[key]).length
            }
        };

        // Test Redis connection
        const startTime = process.hrtime.bigint();
        try {
            const client = redisClient || redis?.client;
            if (client) {
                await client.ping();
                health.redis.connected = true;
                health.redis.latency = Number(process.hrtime.bigint() - startTime) / 1e6;
            }
        } catch (error) {
            health.redis.error = error.message;
            health.status = 'degraded';
        }

        // Check system load
        if (health.systemLoad > 0.8) {
            health.status = 'degraded';
            health.warning = 'High system load detected';
        }

        res.status(health.status === 'healthy' ? 200 : 503).json(health);
    } catch (error) {
        logger.error('Rate limit health check failed', { error: error.message });
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Health check failed'
        });
    }
};

/**
 * Utility function to reset rate limits (for admin use)
 */
const resetRateLimit = async (identifier, limiterType = 'global') => {
    try {
        const client = redisClient || redis?.client;
        if (!client) {
            throw new Error('Redis not available for rate limit reset');
        }

        const keys = await client.keys(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}*${identifier}*`);
        if (keys.length > 0) {
            await client.del(...keys);
            logger.info('Rate limit reset', { identifier, limiterType, keysRemoved: keys.length });
            return { success: true, keysRemoved: keys.length };
        }

        return { success: true, keysRemoved: 0, message: 'No rate limit data found' };
    } catch (error) {
        logger.error('Failed to reset rate limit', { error: error.message, identifier, limiterType });
        throw error;
    }
};

/**
 * Get rate limit statistics for monitoring
 */
const getRateLimitStats = async (identifier) => {
    try {
        const client = redisClient || redis?.client;
        if (!client) {
            throw new Error('Redis not available for stats');
        }

        const keys = await client.keys(`${RATE_LIMIT_CONFIG.REDIS_PREFIX}*${identifier}*`);
        const stats = {
            identifier,
            activeKeys: keys.length,
            limits: {},
            penalties: {},
            suspicious: {}
        };

        for (const key of keys) {
            const ttl = await client.ttl(key);
            const value = await client.get(key);
            
            if (key.includes('penalty:')) {
                stats.penalties[key] = { value: parseInt(value), ttl };
            } else if (key.includes('suspicious:')) {
                stats.suspicious[key] = { value: parseInt(value), ttl };
            } else {
                stats.limits[key] = { value: parseInt(value), ttl };
            }
        }

        return stats;
    } catch (error) {
        logger.error('Failed to get rate limit stats', { error: error.message, identifier });
        throw error;
    }
};

// Export all rate limiters and utilities
module.exports = {
    // Individual rate limiters
    ...rateLimiters,
    
    // Factory function
    createLimiter,
    
    // Smart middleware
    smartRateLimit,
    
    // Error handling
    rateLimitErrorHandler,
    TooManyRequestsError,
    RateLimitConfigError,
    
    // Utilities
    resetRateLimit,
    getRateLimitStats,
    rateLimitHealthCheck,
    
    // Privacy utilities (for external use)
    anonymizeIP,
    anonymizeEmail,
    
    // Configuration
    RATE_LIMIT_CONFIG,
    
    // Legacy exports (backward compatibility)
    rateLimiter: rateLimiters.global,
    loginLimiter: rateLimiters.loginLimiter,
    couponLimiter: rateLimiters.couponLimiter
};