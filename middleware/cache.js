const { getCache, setCache, deleteCache } = require('../services/cache');
const logger = require('../utils/logger');
const crypto = require('crypto');
const util = require('util');

// Constants for better maintainability
const CACHE_CONFIG = {
    DEFAULT_TTL: 300, // 5 minutes
    MAX_KEY_LENGTH: 250,
    MAX_BODY_SIZE: 1024 * 1024, // 1MB
    COMPRESSION_THRESHOLD: 1024 // 1KB
};

const HTTP_STATUS = {
    OK: 200,
    NOT_MODIFIED: 304,
    INTERNAL_SERVER_ERROR: 500
};

/**
 * Advanced cache middleware with comprehensive features:
 * 1. Flexible key generation strategies
 * 2. Conditional caching based on status codes and content
 * 3. Cache invalidation and warming
 * 4. Performance monitoring
 * 5. Error handling and fallbacks
 * 6. ETag support for client-side caching
 */
const cacheMiddleware = (options = {}) => {
    const {
        keyPrefix = 'cache',
        ttl = CACHE_CONFIG.DEFAULT_TTL,
        keyGenerator = null,
        condition = null,
        skipCache = false,
        invalidatePattern = null,
        warmCache = false,
        compress = true,
        includeHeaders = false,
        varyBy = [],
        skipMethods = ['POST', 'PUT', 'PATCH', 'DELETE'],
        cachePrivate = false,
        maxAge = null,
        staleWhileRevalidate = false,
        bypassQueryParams = ['_', 'timestamp', 'nocache']
    } = options;

    return async (req, res, next) => {
        const startTime = process.hrtime.bigint();
        
        try {
            // Skip caching for non-cacheable methods
            if (skipMethods.includes(req.method)) {
                return next();
            }

            // Skip caching based on custom condition
            if (skipCache || (condition && !await condition(req, res))) {
                return next();
            }

            // Generate cache key
            const cacheKey = await generateCacheKey(req, keyPrefix, keyGenerator, varyBy, bypassQueryParams);
            
            // Validate cache key
            if (!cacheKey || cacheKey.length > CACHE_CONFIG.MAX_KEY_LENGTH) {
                logger.warn('Invalid cache key generated', {
                    key: cacheKey?.substring(0, 100),
                    length: cacheKey?.length,
                    route: req.originalUrl
                });
                return next();
            }

            // Check for cache bypass headers
            if (req.headers['cache-control']?.includes('no-cache') || 
                req.headers['pragma'] === 'no-cache') {
                logger.debug('Cache bypass requested', { 
                    cacheKey,
                    headers: req.headers['cache-control']
                });
                return handleCacheBypass(req, res, next, cacheKey, ttl, includeHeaders);
            }

            // Try to get cached data
            const cachedResult = await getCachedData(cacheKey, req);
            
            if (cachedResult) {
                return sendCachedResponse(res, cachedResult, cacheKey);
            }

            // Cache miss - set up response caching
            return setupResponseCaching(req, res, next, cacheKey, ttl, includeHeaders, compress, staleWhileRevalidate);

        } catch (error) {
            logger.error('Cache middleware error', {
                error: error.message,
                stack: error.stack,
                route: req.originalUrl,
                method: req.method
            });
            
            // Continue without caching on error
            return next();
        } finally {
            // Performance logging
            const duration = Number(process.hrtime.bigint() - startTime) / 1e6;
            if (duration > 50) { // Log slow cache operations
                logger.warn('Slow cache operation', {
                    duration: `${duration.toFixed(2)}ms`,
                    route: req.originalUrl,
                    method: req.method
                });
            }
        }
    };
};

/**
 * Generate cache key with various strategies
 */
async function generateCacheKey(req, keyPrefix, keyGenerator, varyBy, bypassQueryParams) {
    try {
        if (keyGenerator && typeof keyGenerator === 'function') {
            const customKey = await keyGenerator(req);
            return `${keyPrefix}:${customKey}`;
        }

        // Build key components
        const keyComponents = [keyPrefix];
        
        // Add path
        keyComponents.push(req.path);
        
        // Add filtered query parameters
        const queryParams = { ...req.query };
        bypassQueryParams.forEach(param => delete queryParams[param]);
        
        if (Object.keys(queryParams).length > 0) {
            const sortedQuery = Object.keys(queryParams)
                .sort()
                .map(key => `${key}=${queryParams[key]}`)
                .join('&');
            keyComponents.push(sortedQuery);
        }
        
        // Add vary-by headers
        if (varyBy.length > 0) {
            const varyValues = varyBy
                .map(header => `${header}:${req.get(header) || ''}`)
                .join('|');
            keyComponents.push(varyValues);
        }
        
        // Add user-specific data if available
        if (req.user?.id) {
            keyComponents.push(`user:${req.user.id}`);
        }
        
        const fullKey = keyComponents.join(':');
        
        // Hash long keys for storage efficiency
        if (fullKey.length > 200) {
            const hash = crypto.createHash('sha256').update(fullKey).digest('hex');
            return `${keyPrefix}:${hash.substring(0, 32)}`;
        }
        
        return fullKey;
    } catch (error) {
        logger.warn('Cache key generation failed', {
            error: error.message,
            route: req.originalUrl
        });
        return null;
    }
}

/**
 * Get cached data with metadata
 */
async function getCachedData(cacheKey, req) {
    try {
        const cachedData = await getCache(cacheKey);
        if (!cachedData) return null;

        // Parse cached metadata
        const cached = typeof cachedData === 'string' ? 
            JSON.parse(cachedData) : cachedData;

        // Check if cached data is still valid
        if (cached.expiresAt && Date.now() > cached.expiresAt) {
            // Clean up expired cache
            deleteCache(cacheKey).catch(err => 
                logger.warn('Failed to delete expired cache', { error: err.message, cacheKey })
            );
            return null;
        }

        // Check ETag for conditional requests
        if (req.headers['if-none-match'] && cached.etag) {
            if (req.headers['if-none-match'] === cached.etag) {
                return { ...cached, notModified: true };
            }
        }

        return cached;
    } catch (error) {
        logger.warn('Cache retrieval failed', {
            error: error.message,
            cacheKey
        });
        return null;
    }
}

/**
 * Send cached response with proper headers
 */
function sendCachedResponse(res, cachedResult, cacheKey) {
    try {
        // Handle 304 Not Modified
        if (cachedResult.notModified) {
            res.status(HTTP_STATUS.NOT_MODIFIED);
            if (cachedResult.headers) {
                Object.entries(cachedResult.headers).forEach(([key, value]) => {
                    res.set(key, value);
                });
            }
            return res.end();
        }

        // Set cache headers
        res.set({
            'X-Cache': 'HIT',
            'X-Cache-Key': cacheKey,
            'X-Cache-Age': Math.floor((Date.now() - cachedResult.timestamp) / 1000).toString(),
            'X-Cache-TTL': cachedResult.ttl?.toString() || '0'
        });

        // Set ETag if available
        if (cachedResult.etag) {
            res.set('ETag', cachedResult.etag);
        }

        // Set cached headers if stored
        if (cachedResult.headers) {
            Object.entries(cachedResult.headers).forEach(([key, value]) => {
                res.set(key, value);
            });
        }

        // Send cached data
        const statusCode = cachedResult.statusCode || HTTP_STATUS.OK;
        return res.status(statusCode).json({
            success: true,
            fromCache: true,
            data: cachedResult.data,
            meta: {
                cached: true,
                timestamp: cachedResult.timestamp,
                age: Math.floor((Date.now() - cachedResult.timestamp) / 1000)
            }
        });
    } catch (error) {
        logger.error('Failed to send cached response', {
            error: error.message,
            cacheKey
        });
        throw error;
    }
}

/**
 * Setup response caching for cache miss
 */
function setupResponseCaching(req, res, next, cacheKey, ttl, includeHeaders, compress, staleWhileRevalidate) {
    const originalJson = res.json;
    const originalSend = res.send;
    const originalStatus = res.status;
    let statusCode = HTTP_STATUS.OK;
    let responseHeaders = {};

    // Track status code changes
    res.status = function(code) {
        statusCode = code;
        return originalStatus.call(this, code);
    };

    // Intercept json responses
    res.json = function(data) {
        if (shouldCacheResponse(statusCode, data, req)) {
            cacheResponse(cacheKey, {
                data,
                statusCode,
                headers: includeHeaders ? responseHeaders : null,
                timestamp: Date.now(),
                ttl,
                compress,
                staleWhileRevalidate
            }).catch(err => {
                logger.warn('Failed to cache response', {
                    error: err.message,
                    cacheKey,
                    statusCode
                });
            });
        }

        // Set cache headers for client
        res.set({
            'X-Cache': 'MISS',
            'X-Cache-Key': cacheKey
        });

        return originalJson.call(this, data);
    };

    // Intercept send responses
    res.send = function(data) {
        if (shouldCacheResponse(statusCode, data, req)) {
            const parsedData = typeof data === 'string' ? 
                tryParseJSON(data) : data;

            if (parsedData) {
                cacheResponse(cacheKey, {
                    data: parsedData,
                    statusCode,
                    headers: includeHeaders ? responseHeaders : null,
                    timestamp: Date.now(),
                    ttl,
                    compress,
                    staleWhileRevalidate
                }).catch(err => {
                    logger.warn('Failed to cache send response', {
                        error: err.message,
                        cacheKey
                    });
                });
            }
        }

        res.set({
            'X-Cache': 'MISS',
            'X-Cache-Key': cacheKey
        });

        return originalSend.call(this, data);
    };

    // Capture response headers if needed
    if (includeHeaders) {
        const originalSet = res.set;
        res.set = function(field, val) {
            if (typeof field === 'object') {
                Object.assign(responseHeaders, field);
            } else {
                responseHeaders[field] = val;
            }
            return originalSet.call(this, field, val);
        };
    }

    next();
}

/**
 * Determine if response should be cached
 */
function shouldCacheResponse(statusCode, data, req) {
    // Only cache successful responses
    if (statusCode < 200 || statusCode >= 300) {
        return false;
    }

    // Don't cache empty responses
    if (!data) {
        return false;
    }

    // Don't cache if explicitly disabled
    if (req.headers['x-no-cache'] === 'true') {
        return false;
    }

    // Check data size
    const dataSize = Buffer.byteLength(JSON.stringify(data));
    if (dataSize > CACHE_CONFIG.MAX_BODY_SIZE) {
        logger.warn('Response too large to cache', {
            size: dataSize,
            route: req.originalUrl
        });
        return false;
    }

    return true;
}

/**
 * Cache response data with metadata
 */
async function cacheResponse(cacheKey, responseData) {
    try {
        const cachePayload = {
            ...responseData,
            etag: generateETag(responseData.data),
            expiresAt: Date.now() + (responseData.ttl * 1000)
        };

        await setCache(cacheKey, cachePayload, responseData.ttl);

        logger.debug('Response cached successfully', {
            cacheKey,
            size: Buffer.byteLength(JSON.stringify(cachePayload)),
            ttl: responseData.ttl,
            statusCode: responseData.statusCode
        });
    } catch (error) {
        logger.error('Cache storage failed', {
            error: error.message,
            cacheKey,
            dataSize: Buffer.byteLength(JSON.stringify(responseData))
        });
        throw error;
    }
}

/**
 * Generate ETag for response data
 */
function generateETag(data) {
    const content = JSON.stringify(data);
    return `"${crypto.createHash('md5').update(content).digest('hex')}"`;
}

/**
 * Handle cache bypass scenarios
 */
function handleCacheBypass(req, res, next, cacheKey, ttl, includeHeaders) {
    // Delete existing cache
    deleteCache(cacheKey).catch(err => 
        logger.warn('Failed to delete bypassed cache', { error: err.message })
    );
    
    // Set up fresh caching
    return setupResponseCaching(req, res, next, cacheKey, ttl, includeHeaders, true, false);
}

/**
 * Safely parse JSON
 */
function tryParseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

// Cache invalidation utilities
const invalidateCache = async (pattern) => {
    try {
        if (typeof pattern === 'string') {
            await deleteCache(pattern);
        } else if (pattern instanceof RegExp) {
            // This would need to be implemented in your cache service
            logger.warn('Pattern-based cache invalidation not implemented', { pattern });
        }
    } catch (error) {
        logger.error('Cache invalidation failed', {
            error: error.message,
            pattern
        });
    }
};

// Cache warming utility
const warmCache = async (routes = []) => {
    try {
        for (const route of routes) {
            // This would make requests to warm the cache
            logger.info('Cache warming not implemented', { route });
        }
    } catch (error) {
        logger.error('Cache warming failed', { error: error.message });
    }
};

// Conditional caching helpers
const cacheConditions = {
    // Only cache for authenticated users
    authenticated: (req) => !!req.user,
    
    // Only cache GET requests
    getOnly: (req) => req.method === 'GET',
    
    // Cache based on user role
    role: (roles) => (req) => roles.includes(req.user?.role),
    
    // Cache based on content type
    jsonOnly: (req, res) => res.get('Content-Type')?.includes('application/json'),
    
    // Custom time-based caching
    timeWindow: (startHour, endHour) => () => {
        const hour = new Date().getHours();
        return hour >= startHour && hour <= endHour;
    }
};

module.exports = {
    cache: cacheMiddleware,
    invalidateCache,
    warmCache,
    cacheConditions,
    CACHE_CONFIG
};
