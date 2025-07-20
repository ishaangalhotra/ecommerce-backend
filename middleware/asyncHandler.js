const logger = require('../utils/logger');
const util = require('util');

/**
 * Advanced async handler wrapper with:
 * 1. Comprehensive error handling and logging
 * 2. Request timeout management
 * 3. Detailed error responses
 * 4. Performance monitoring
 * 5. Request validation
 * 6. Rate limiting support
 */
const asyncHandler = (fn, options = {}) => {
    if (typeof fn !== 'function') {
        throw new Error('asyncHandler requires a function as first argument');
    }

    const {
        logErrors = true,
        includeStack = process.env.NODE_ENV === 'development',
        timeout = 30000,
        validateRequest = false,
        rateLimit = null,
        performanceMonitoring = false
    } = options;

    return async (req, res, next) => {
        // Request validation
        if (validateRequest && typeof validateRequest === 'function') {
            try {
                await validateRequest(req);
            } catch (validationError) {
                return res.status(400).json({
                    success: false,
                    error: 'Request validation failed',
                    code: 'VALIDATION_FAILED',
                    details: validationError.details || validationError.message
                });
            }
        }

        // Rate limiting
        if (rateLimit && typeof rateLimit === 'function') {
            try {
                const rateLimitResult = await rateLimit(req);
                if (rateLimitResult.limited) {
                    res.set('Retry-After', rateLimitResult.retryAfter);
                    return res.status(429).json({
                        success: false,
                        error: 'Too many requests',
                        code: 'RATE_LIMITED',
                        retryAfter: rateLimitResult.retryAfter,
                        limit: rateLimitResult.limit,
                        remaining: rateLimitResult.remaining
                    });
                }
            } catch (rateLimitError) {
                logger.error('Rate limit error:', rateLimitError);
            }
        }

        let timeoutId = null;
        let startTime = performanceMonitoring ? process.hrtime.bigint() : null;

        if (timeout > 0) {
            timeoutId = setTimeout(() => {
                if (!res.headersSent) {
                    const elapsed = performanceMonitoring ? 
                        Number(process.hrtime.bigint() - startTime) / 1e6 : null;
                    
                    logger.warn('Request timeout', {
                        route: req.originalUrl,
                        method: req.method,
                        timeout,
                        elapsedTime: elapsed ? `${elapsed.toFixed(2)}ms` : undefined
                    });
                    
                    res.status(408).json({
                        success: false,
                        error: 'Request timeout',
                        code: 'TIMEOUT',
                        timeout
                    });
                }
            }, timeout);
        }

        try {
            const result = await Promise.resolve(fn(req, res, next));
            
            if (timeoutId) clearTimeout(timeoutId);
            
            // Performance logging
            if (performanceMonitoring && startTime) {
                const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6;
                logger.info('Request completed', {
                    route: req.originalUrl,
                    method: req.method,
                    duration: `${elapsed.toFixed(2)}ms`,
                    statusCode: res.statusCode
                });
            }
            
            return result;
        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            
            if (res.headersSent) {
                return next(error);
            }

            const errorInfo = normalizeError(error, req);
            
            if (logErrors) {
                logErrorDetails(errorInfo, req, includeStack);
            }

            sendErrorResponse(res, errorInfo, includeStack);
        }
    };
};

/**
 * Normalizes different error types into a consistent format
 */
function normalizeError(error, req) {
    const normalized = {
        message: error.message || 'Internal Server Error',
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        details: null,
        stack: error.stack,
        name: error.name || error.constructor.name
    };

    // Handle known error types
    switch (true) {
        case error.name === 'ValidationError':
            Object.assign(normalized, {
                statusCode: 400,
                message: 'Validation Error',
                code: 'VALIDATION_ERROR',
                details: error.errors || error.details
            });
            break;

        case error.name === 'CastError':
            Object.assign(normalized, {
                statusCode: 400,
                message: 'Invalid ID format',
                code: 'INVALID_ID'
            });
            break;

        case error.code === 11000: // MongoDB duplicate key
            Object.assign(normalized, {
                statusCode: 409,
                message: 'Duplicate entry found',
                code: 'DUPLICATE_ENTRY'
            });
            break;

        case error.code === 'LIMIT_FILE_SIZE':
            Object.assign(normalized, {
                statusCode: 413,
                message: 'File too large',
                code: 'FILE_TOO_LARGE'
            });
            break;

        case error.name === 'JsonWebTokenError':
            Object.assign(normalized, {
                statusCode: 401,
                message: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
            break;

        case error.name === 'TokenExpiredError':
            Object.assign(normalized, {
                statusCode: 401,
                message: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
            break;

        case error.name === 'MongoNetworkError':
            Object.assign(normalized, {
                statusCode: 503,
                message: 'Database connection error',
                code: 'DB_CONNECTION_ERROR'
            });
            break;

        case error.statusCode && error.statusCode >= 400:
            Object.assign(normalized, {
                statusCode: error.statusCode,
                message: error.message || normalized.message,
                code: error.code || normalized.code,
                details: error.details
            });
            break;

        default:
            if (error.statusCode) {
                normalized.statusCode = error.statusCode;
            }
            if (error.code) {
                normalized.code = error.code;
            }
            if (error.details) {
                normalized.details = error.details;
            }
    }

    return normalized;
}

/**
 * Detailed error logging
 */
function logErrorDetails(errorInfo, req, includeStack) {
    const logData = {
        error: errorInfo.message,
        stack: includeStack ? errorInfo.stack : undefined,
        route: req.originalUrl,
        method: req.method,
        params: req.params,
        query: req.query,
        body: req.method !== 'GET' ? req.body : undefined,
        userId: req.user?.id || 'anonymous',
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress,
        timestamp: new Date().toISOString(),
        errorType: errorInfo.name,
        statusCode: errorInfo.statusCode,
        errorCode: errorInfo.code
    };

    if (errorInfo.details) {
        logData.details = errorInfo.details instanceof Error ? 
            errorInfo.details.toString() : 
            util.inspect(errorInfo.details, { depth: 3 });
    }

    logger.error('Request processing error', logData);
}

/**
 * Consistent error response formatting
 */
function sendErrorResponse(res, errorInfo, includeStack) {
    const errorResponse = {
        success: false,
        error: errorInfo.message,
        code: errorInfo.code,
        timestamp: new Date().toISOString(),
        path: res.req?.originalUrl,
        method: res.req?.method
    };

    if (errorInfo.details && (includeStack || process.env.NODE_ENV === 'development')) {
        errorResponse.details = errorInfo.details;
    }

    if (includeStack && errorInfo.stack) {
        errorResponse.stack = errorInfo.stack;
    }

    res.status(errorInfo.statusCode).json(errorResponse);
}

// Enhanced error creation utilities
asyncHandler.createError = (message, statusCode = 500, code = 'CUSTOM_ERROR', details = null) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    if (details) error.details = details;
    return error;
};

asyncHandler.TimeoutError = class extends Error {
    constructor(message = 'Request timeout', timeout = 30000) {
        super(message);
        this.name = 'TimeoutError';
        this.statusCode = 408;
        this.code = 'TIMEOUT';
        this.timeout = timeout;
    }
};

// Common error types
asyncHandler.BadRequestError = class extends Error {
    constructor(message = 'Bad Request', details = null) {
        super(message);
        this.name = 'BadRequestError';
        this.statusCode = 400;
        this.code = 'BAD_REQUEST';
        this.details = details;
    }
};

asyncHandler.UnauthorizedError = class extends Error {
    constructor(message = 'Unauthorized', details = null) {
        super(message);
        this.name = 'UnauthorizedError';
        this.statusCode = 401;
        this.code = 'UNAUTHORIZED';
        this.details = details;
    }
};

asyncHandler.ForbiddenError = class extends Error {
    constructor(message = 'Forbidden', details = null) {
        super(message);
        this.name = 'ForbiddenError';
        this.statusCode = 403;
        this.code = 'FORBIDDEN';
        this.details = details;
    }
};

asyncHandler.NotFoundError = class extends Error {
    constructor(message = 'Not Found', details = null) {
        super(message);
        this.name = 'NotFoundError';
        this.statusCode = 404;
        this.code = 'NOT_FOUND';
        this.details = details;
    }
};

asyncHandler.ConflictError = class extends Error {
    constructor(message = 'Conflict', details = null) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
        this.code = 'CONFLICT';
        this.details = details;
    }
};

asyncHandler.ValidationError = class extends Error {
    constructor(message = 'Validation Error', details = null) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 422;
        this.code = 'VALIDATION_ERROR';
        this.details = details;
    }
};

module.exports = asyncHandler;