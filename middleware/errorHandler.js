const logger = require('../utils/logger');
const config = require('../config/config');
const util = require('util');
const crypto = require('crypto');
const { inspect } = require('util');

/**
 * Enhanced ErrorResponse class with comprehensive error handling
 */
class ErrorResponse extends Error {
    constructor(message, statusCode = 500, details = null, code = null) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.details = details;
        this.code = code || this.generateDefaultCode(statusCode);
        this.isOperational = true;
        this.timestamp = new Date().toISOString();
        this.errorId = `err_${crypto.randomBytes(8).toString('hex')}`;
        
        Error.captureStackTrace(this, this.constructor);
    }

    generateDefaultCode(statusCode) {
        const codes = {
            400: 'BAD_REQUEST',
            401: 'UNAUTHORIZED',
            403: 'FORBIDDEN',
            404: 'NOT_FOUND',
            409: 'CONFLICT',
            429: 'RATE_LIMITED',
            500: 'INTERNAL_ERROR',
            503: 'SERVICE_UNAVAILABLE'
        };
        return codes[statusCode] || 'UNKNOWN_ERROR';
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            statusCode: this.statusCode,
            code: this.code,
            errorId: this.errorId,
            timestamp: this.timestamp,
            ...(this.details && { details: this.details })
        };
    }

    static fromError(error, overrides = {}) {
        if (error instanceof ErrorResponse) return error;
        
        const statusCode = error.statusCode || 
                         (error.status && error.status >= 400 ? error.status : 500);
        
        return new ErrorResponse(
            error.message,
            statusCode,
            error.details,
            error.code
        );
    }
}

/**
 * Specialized error classes with enhanced metadata
 */
class ValidationError extends ErrorResponse {
    constructor(message = 'Validation failed', details = null) {
        super(message, 400, details, 'VALIDATION_ERROR');
        this.validationErrors = details?.errors || [];
    }

    addValidationError(field, message, value, kind) {
        this.validationErrors.push({ field, message, value, kind });
        this.details = this.details || {};
        this.details.errors = this.validationErrors;
        return this;
    }
}

class AuthenticationError extends ErrorResponse {
    constructor(message = 'Authentication required', details = null) {
        super(message, 401, details, 'AUTHENTICATION_ERROR');
        this.reason = details?.reason || 'invalid_credentials';
    }
}

class AuthorizationError extends ErrorResponse {
    constructor(message = 'Access forbidden', details = null) {
        super(message, 403, details, 'AUTHORIZATION_ERROR');
        this.requiredRoles = details?.roles || [];
        this.requiredPermissions = details?.permissions || [];
    }
}

class NotFoundError extends ErrorResponse {
    constructor(message = 'Resource not found', details = null) {
        super(message, 404, details, 'NOT_FOUND');
        this.resourceType = details?.resourceType;
        this.resourceId = details?.resourceId;
    }
}

class ConflictError extends ErrorResponse {
    constructor(message = 'Resource conflict', details = null) {
        super(message, 409, details, 'CONFLICT');
        this.conflictingField = details?.field;
        this.conflictingValue = details?.value;
    }
}

class RateLimitError extends ErrorResponse {
    constructor(message = 'Rate limit exceeded', details = null) {
        super(message, 429, details, 'RATE_LIMIT_EXCEEDED');
        this.retryAfter = details?.retryAfter;
        this.limit = details?.limit;
        this.remaining = details?.remaining;
    }
}

class DatabaseError extends ErrorResponse {
    constructor(message = 'Database operation failed', details = null) {
        super(message, 503, details, 'DATABASE_ERROR');
        this.operation = details?.operation;
        this.query = details?.query;
    }
}

class ExternalServiceError extends ErrorResponse {
    constructor(message = 'External service failed', details = null) {
        super(message, 502, details, 'EXTERNAL_SERVICE_ERROR');
        this.serviceName = details?.serviceName;
        this.endpoint = details?.endpoint;
    }
}

/**
 * Comprehensive error handler middleware
 */
class ErrorHandler {
    constructor(options = {}) {
        this.options = {
            logErrors: true,
            includeStack: config.NODE_ENV === 'development',
            exposeDetails: config.NODE_ENV === 'development',
            monitoring: config.errorMonitoring?.enabled || false,
            rateLimitTracking: true,
            ...options
        };

        this.initialize();
    }

    initialize() {
        this.setupProcessHandlers();
        this.setupMonitoring();
    }

    setupProcessHandlers() {
        process.on('uncaughtException', (error) => {
            this.handleUncaughtException(error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            this.handleUnhandledRejection(reason, promise);
        });

        process.on('warning', (warning) => {
            this.handleProcessWarning(warning);
        });
    }

    setupMonitoring() {
        if (this.options.monitoring) {
            // Initialize Sentry, New Relic, or other monitoring tools
            // this.monitoringClient = new MonitoringClient(config.monitoring);
        }
    }

    handleUncaughtException(error) {
        const errorContext = this.buildErrorContext(null, error);
        this.logError(error, errorContext, 'fatal');
        
        if (this.options.monitoring) {
            this.captureException(error, errorContext);
        }

        // Graceful shutdown
        if (!this.shouldRestartProcess(error)) {
            process.exit(1);
        }
    }

    handleUnhandledRejection(reason, promise) {
        const error = reason instanceof Error ? reason : new Error(util.inspect(reason));
        const errorContext = this.buildErrorContext(null, error, { promise });
        this.logError(error, errorContext, 'error');
        
        if (this.options.monitoring) {
            this.captureException(error, errorContext);
        }
    }

    handleProcessWarning(warning) {
        const errorContext = this.buildErrorContext(null, warning);
        this.logError(warning, errorContext, 'warn');
    }

    middleware() {
        return (err, req, res, next) => {
            const errorStart = process.hrtime.bigint();
            const normalizedError = this.normalizeError(err);
            const errorContext = this.buildErrorContext(req, normalizedError);
            
            // Log the error
            if (this.options.logErrors) {
                this.logError(normalizedError, errorContext);
            }

            // Send to monitoring
            if (this.options.monitoring && this.shouldMonitorError(normalizedError)) {
                this.captureException(normalizedError, errorContext);
            }

            // Build response
            const response = this.buildErrorResponse(normalizedError, errorContext);
            
            // Set headers
            this.setSecurityHeaders(res, normalizedError);

            // Performance metrics
            const processingTime = Number(process.hrtime.bigint() - errorStart) / 1e6;
            res.set('X-Error-Processing-Time', `${processingTime.toFixed(2)}ms`);
            
            // Send response
            res.status(normalizedError.statusCode).json(response);
        };
    }

    normalizeError(err) {
        if (err instanceof ErrorResponse) return err;

        // Handle common error types
        switch (true) {
            // Database errors
            case err.name === 'MongoError' && err.code === 11000:
                return this.handleDuplicateKeyError(err);
            
            case err.name === 'ValidationError':
                return this.handleValidationError(err);
            
            case err.name === 'CastError':
                return this.handleCastError(err);
            
            case err.name === 'DocumentNotFoundError':
                return new NotFoundError('Document not found', { 
                    resourceType: err.model?.modelName 
                });
            
            // Authentication errors
            case err.name === 'JsonWebTokenError':
                return new AuthenticationError('Invalid authentication token', {
                    reason: 'invalid_token'
                });
            
            case err.name === 'TokenExpiredError':
                return new AuthenticationError('Authentication token expired', {
                    reason: 'token_expired',
                    expiredAt: err.expiredAt
                });
            
            // Rate limiting
            case err.statusCode === 429:
                return new RateLimitError(err.message, {
                    retryAfter: err.retryAfter,
                    limit: err.limit,
                    remaining: err.remaining
                });
            
            // External service errors
            case err.isAxiosError:
                return new ExternalServiceError(
                    err.response?.data?.message || 'External service request failed',
                    {
                        serviceName: err.config?.url,
                        endpoint: err.config?.url,
                        statusCode: err.response?.status,
                        responseData: err.response?.data
                    }
                );
            
            // Default case
            default:
                return ErrorResponse.fromError(err);
        }
    }

    handleDuplicateKeyError(err) {
        const duplicateFields = Object.keys(err.keyValue || {});
        const field = duplicateFields[0] || 'unknown';
        const value = err.keyValue?.[field];
        
        return new ConflictError(
            `Duplicate value for field '${field}'`,
            {
                field,
                value,
                duplicateFields,
                index: err.keyPattern
            }
        );
    }

    handleValidationError(err) {
        const validationError = new ValidationError('Data validation failed');
        
        Object.values(err.errors || {}).forEach(error => {
            validationError.addValidationError(
                error.path,
                error.message,
                error.value,
                error.kind
            );
        });
        
        return validationError;
    }

    handleCastError(err) {
        return new ValidationError(
            `Invalid ${err.path}: ${err.value}`,
            {
                field: err.path,
                value: err.value,
                expectedType: err.kind,
                model: err.model?.modelName
            }
        );
    }

    buildErrorContext(req, error, additionalContext = {}) {
        const context = {
            errorId: error.errorId || crypto.randomBytes(8).toString('hex'),
            timestamp: new Date().toISOString(),
            environment: config.NODE_ENV,
            ...additionalContext
        };

        if (req) {
            context.request = {
                method: req.method,
                url: req.originalUrl,
                path: req.path,
                params: this.sanitizeData(req.params),
                query: this.sanitizeData(req.query),
                body: req.method !== 'GET' ? this.sanitizeData(req.body) : undefined,
                headers: this.sanitizeData(req.headers),
                ip: req.ip || req.connection?.remoteAddress,
                userAgent: req.get('User-Agent'),
                userId: req.user?.id || req.auth?.userId,
                sessionId: req.sessionID || req.session?.id,
                requestId: req.id || req.headers['x-request-id'],
                correlationId: req.headers['x-correlation-id'],
                referer: req.get('Referer'),
                origin: req.get('Origin')
            };
        }

        return context;
    }

    sanitizeData(data) {
        if (!data || typeof data !== 'object') return data;

        const sensitiveKeys = [
            'password', 'token', 'secret', 'key', 'apikey', 'authorization',
            'creditcard', 'ssn', 'social', 'passport', 'license', 'cookie',
            'x-auth-token', 'x-api-key', 'x-access-token', 'authentication'
        ];

        const sanitized = Array.isArray(data) ? [...data] : { ...data };

        Object.keys(sanitized).forEach(key => {
            if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof sanitized[key] === 'object') {
                sanitized[key] = this.sanitizeData(sanitized[key]);
            }
        });

        return sanitized;
    }

    logError(error, context, level = this.determineLogLevel(error)) {
        const logData = {
            error: {
                name: error.name,
                message: error.message,
                statusCode: error.statusCode,
                code: error.code,
                isOperational: error.isOperational,
                ...(this.options.includeStack && { stack: error.stack })
            },
            context,
            system: {
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime(),
                pid: process.pid
            }
        };

        switch (level) {
            case 'fatal':
                logger.fatal('Fatal error occurred', logData);
                break;
            case 'error':
                logger.error('Error occurred', logData);
                break;
            case 'warn':
                logger.warn('Client error occurred', logData);
                break;
            case 'info':
                logger.info('Operational error occurred', logData);
                break;
            case 'debug':
                logger.debug('Debug error information', logData);
                break;
            default:
                logger.error('Unclassified error occurred', logData);
        }
    }

    determineLogLevel(error) {
        if (error.statusCode >= 500) return 'error';
        if (error.statusCode === 429) return 'warn';
        if (error.statusCode >= 400) return 'warn';
        if (error.isOperational) return 'info';
        return 'error';
    }

    buildErrorResponse(error, context) {
        const response = {
            success: false,
            error: error.message,
            code: error.code,
            errorId: context.errorId,
            timestamp: context.timestamp,
            ...(context.request && {
                path: context.request.path,
                method: context.request.method
            })
        };

        // Add details if configured to expose them
        if (this.options.exposeDetails || error.isOperational) {
            if (error.details) {
                response.details = error.details;
            }
            
            if (error instanceof ValidationError && error.validationErrors.length > 0) {
                response.validationErrors = error.validationErrors;
            }
        }

        // Add stack trace only in development
        if (this.options.includeStack && error.stack) {
            response.stack = error.stack;
        }

        // Add correlation ID if present
        if (context.request?.correlationId) {
            response.correlationId = context.request.correlationId;
        }

        return response;
    }

    setSecurityHeaders(res, error) {
        const headers = {
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Error-Code': error.code,
            'X-Error-ID': error.errorId
        };

        // Add CSP header only for certain error types
        if (error.statusCode >= 500) {
            headers['Content-Security-Policy'] = "default-src 'none'";
        }

        res.set(headers);
    }

    captureException(error, context) {
        if (!this.options.monitoring) return;

        try {
            // this.monitoringClient.captureException(error, {
            //     tags: {
            //         errorId: context.errorId,
            //         statusCode: error.statusCode,
            //         environment: context.environment
            //     },
            //     extra: {
            //         context: this.sanitizeData(context)
            //     }
            // });
        } catch (monitoringError) {
            logger.warn('Failed to capture exception in monitoring service', {
                error: monitoringError.message,
                originalError: error.message
            });
        }
    }

    shouldMonitorError(error) {
        // Monitor all server errors and important client errors
        return error.statusCode >= 500 || 
               error.statusCode === 429 || 
               error instanceof AuthenticationError ||
               error instanceof AuthorizationError;
    }

    shouldRestartProcess(error) {
        // Don't restart for operational errors
        if (error.isOperational) return false;
        
        // Don't restart for database connection errors (let container orchestrator handle it)
        if (error instanceof DatabaseError) return false;
        
        // Restart for memory issues
        if (error.message.includes('heap out of memory')) return true;
        
        // Default case
        return false;
    }

    notFoundHandler() {
        return (req, res, next) => {
            const error = new NotFoundError(
                `Route ${req.method} ${req.originalUrl} not found`,
                {
                    availableRoutes: this.getAvailableRoutes(req.app)
                }
            );
            
            next(error);
        };
    }

    getAvailableRoutes(app) {
        try {
            return app._router?.stack
                ?.filter(layer => layer.route)
                ?.map(layer => ({
                    path: layer.route.path,
                    methods: Object.keys(layer.route.methods).filter(m => m !== '_all')
                })) || [];
        } catch (err) {
            logger.warn('Failed to extract available routes', { error: err.message });
            return [];
        }
    }
}

// Singleton instance with default configuration
const errorHandler = new ErrorHandler();

module.exports = {
    ErrorResponse,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    DatabaseError,
    ExternalServiceError,
    errorHandler,
    ErrorHandler
};