// ⚠️ DEPRECATED: This file is deprecated in favor of hybridAuth.js
// Please migrate to hybridAuth middleware for new development
// This file is kept for backward compatibility only

console.warn('⚠️  WARNING: Using deprecated authMiddleware. Please migrate to hybridAuth.js');

const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { ErrorResponse } = require('../utils/error');
const User = require('../models/User');
const redis = require('../utils/redis');
const logger = require('../utils/logger');
const config = require('../config/config');
const crypto = require('crypto');
const util = require('util');

// Enhanced error classes with serialization support
class AuthenticationError extends ErrorResponse {
    constructor(message = 'Authentication required', details = null, code = 'AUTH_ERROR') {
        super(message, 401, details);
        this.name = 'AuthenticationError';
        this.code = code;
        this.isOperational = true;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            details: this.details,
            stack: this.stack
        };
    }
}

class UnauthorizedError extends AuthenticationError {
    constructor(message = 'Authentication required', details = null) {
        super(message, details, 'UNAUTHORIZED');
        this.name = 'UnauthorizedError';
    }
}

class ForbiddenError extends AuthenticationError {
    constructor(message = 'Access forbidden', details = null) {
        super(message, details, 'FORBIDDEN');
        this.name = 'ForbiddenError';
        this.statusCode = 403;
    }
}

class TokenExpiredError extends AuthenticationError {
    constructor(message = 'Token expired', details = null) {
        super(message, details, 'TOKEN_EXPIRED');
        this.name = 'TokenExpiredError';
    }
}

class TokenRevokedError extends AuthenticationError {
    constructor(message = 'Token revoked', details = null) {
        super(message, details, 'TOKEN_REVOKED');
        this.name = 'TokenRevokedError';
    }
}

class SuspiciousActivityError extends AuthenticationError {
    constructor(message = 'Suspicious activity detected', details = null) {
        super(message, details, 'SUSPICIOUS_ACTIVITY');
        this.name = 'SuspiciousActivityError';
    }
}

// Token verification with enhanced security and caching
const verifyToken = async (token, options = {}) => {
    const verificationStart = process.hrtime.bigint();
    const tokenFingerprint = crypto.createHash('sha256').update(token).digest('hex');
    
    try {
        // Input validation
        if (!token || typeof token !== 'string') {
            throw new UnauthorizedError('Invalid token format');
        }

        // Security checks
        if (token.length > 2048) {
            throw new UnauthorizedError('Token too long');
        }

        if (token.split('.').length !== 3) {
            throw new UnauthorizedError('Malformed token structure');
        }

        // Check token cache for known malicious tokens
        if (redis?.client) {
            try {
                const isMalicious = await redis.client.get(`auth:malicious:${tokenFingerprint}`);
                if (isMalicious) {
                    throw new SuspiciousActivityError('Token identified as malicious');
                }
            } catch (redisError) {
                logger.warn('Redis malicious token check failed', {
                    error: redisError.message,
                    fingerprint: tokenFingerprint
                });
            }
        }

        // Use fallback JWT secret if config is not available
        const jwtSecret = config?.jwt?.secret || process.env.JWT_SECRET;
        
        // Verify token with enhanced options (with fallbacks)
        const decoded = jwt.verify(token, jwtSecret, {
            algorithms: ['HS256'],
            clockTolerance: 15,
            issuer: config?.jwt?.issuer,
            audience: options.audience || config?.jwt?.audience,
            maxAge: options.maxAge || config?.jwt?.expiresIn || '24h',
            complete: false,
            ignoreExpiration: false,
            ignoreNotBefore: false,
            ...options
        });

        // Enhanced token claims validation
        const requiredClaims = ['sub', 'iat', 'exp'];
        const missingClaims = requiredClaims.filter(claim => !decoded[claim]);
        
        if (missingClaims.length > 0) {
            throw new UnauthorizedError(`Invalid token structure: missing ${missingClaims.join(', ')}`);
        }

        // Temporal validation
        const now = Math.floor(Date.now() / 1000);
        if (decoded.iat > now + 60) {
            throw new UnauthorizedError('Token issued in the future');
        }

        if (decoded.exp < now) {
            throw new TokenExpiredError('Token has expired');
        }

        // Check token revocation with cache fallback (if jti exists)
        if (decoded.jti && redis?.client) {
            try {
                const isRevoked = await redis.client.get(`auth:revoked:${decoded.jti}`);
                if (isRevoked) {
                    // Cache malicious token fingerprint for future requests
                    await redis.client.setex(`auth:malicious:${tokenFingerprint}`, 86400, '1');
                    throw new TokenRevokedError('Token has been revoked');
                }
            } catch (redisError) {
                logger.warn('Redis revocation check failed', {
                    error: redisError.message,
                    jti: decoded.jti
                });
            }
        }

        // Performance metrics
        const verificationTime = Number(process.hrtime.bigint() - verificationStart) / 1e6;
        logger.debug('Token verification completed', {
            jti: decoded.jti,
            sub: decoded.sub,
            duration: `${verificationTime.toFixed(2)}ms`
        });

        return decoded;
    } catch (err) {
        // Enhanced error logging with security context
        logger.warn('Token verification failed', {
            error: err.message,
            errorType: err.name,
            tokenLength: token?.length || 0,
            tokenPrefix: token?.substring(0, 8) || '',
            fingerprint: tokenFingerprint,
            timestamp: new Date().toISOString()
        });

        // Convert JWT library errors to our custom errors
        if (err instanceof AuthenticationError) {
            throw err;
        }

        switch (err.name) {
            case 'JsonWebTokenError':
                throw new UnauthorizedError('Invalid token signature or format');
            case 'TokenExpiredError':
                throw new TokenExpiredError('Authentication token has expired');
            case 'NotBeforeError':
                throw new UnauthorizedError('Token not yet active');
            default:
                throw new UnauthorizedError('Token verification failed');
        }
    }
};

// Enhanced authentication middleware with comprehensive features
const protect = (options = {}) => {
    const {
        required = true,
        allowCookie = true,
        allowHeader = true,
        allowBearer = true,
        allowQueryParam = false,
        roles = [],
        permissions = [],
        checkIp = false,
        checkUserAgent = false,
        sessionCheck = false // Set to false by default for compatibility
    } = options;

    return async (req, res, next) => {
        const authStart = process.hrtime.bigint();
        const authContext = {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            method: req.method,
            path: req.originalUrl,
            timestamp: new Date().toISOString()
        };

        try {
            // Token extraction from multiple sources
            let token;
            let tokenSource = 'none';
            const extractionSources = [];

            if (allowCookie && req.cookies?.token) {
                extractionSources.push('cookie');
            }
            if (allowBearer && req.headers.authorization?.startsWith('Bearer ')) {
                extractionSources.push('bearer');
            }
            if (allowHeader && req.headers['x-auth-token']) {
                extractionSources.push('header');
            }
            if (allowQueryParam && req.query?.token) {
                extractionSources.push('query');
            }

            // Check for multiple token sources (potential attack)
            if (extractionSources.length > 1) {
                logger.warn('Multiple token sources detected', {
                    sources: extractionSources,
                    ...authContext
                });
            }

            // Get token from highest priority source
            if (allowCookie && req.cookies?.token) {
                token = req.cookies.token;
                tokenSource = 'cookie';
            } else if (allowBearer && req.headers.authorization?.startsWith('Bearer ')) {
                token = req.headers.authorization.split(' ')[1];
                tokenSource = 'bearer';
            } else if (allowHeader && req.headers['x-auth-token']) {
                token = req.headers['x-auth-token'];
                tokenSource = 'header';
            } else if (allowQueryParam && req.query?.token) {
                token = req.query.token;
                tokenSource = 'query';
            }

            if (!token && required) {
                throw new UnauthorizedError('Authentication required: No token provided');
            }

            if (!token && !required) {
                req.auth = { isAuthenticated: false };
                return next();
            }

            // Verify token
            req.tokenPayload = await verifyToken(token);
            req.tokenSource = tokenSource;

            // Enhanced user lookup with caching and freshness check
            const userCacheKey = `user:${req.tokenPayload.sub || req.tokenPayload.id}`;
            let user = await getUserWithCache(req.tokenPayload.sub || req.tokenPayload.id, userCacheKey);

            if (!user) {
                throw new UnauthorizedError('User account not found');
            }

            // Security validations
            validateUserStatus(user);
            validatePasswordRecency(user, req.tokenPayload.iat);
            
            if (checkIp && user.lastKnownIp && user.lastKnownIp !== req.ip) {
                logger.warn('IP address changed', {
                    userId: user._id,
                    oldIp: user.lastKnownIp,
                    newIp: req.ip,
                    ...authContext
                });
            }

            if (checkUserAgent && user.lastKnownUserAgent !== req.get('User-Agent')) {
                logger.info('User agent changed', {
                    userId: user._id,
                    oldAgent: user.lastKnownUserAgent,
                    newAgent: req.get('User-Agent'),
                    ...authContext
                });
            }

            // Role and permission checks
            if (roles.length > 0 && !roles.includes(user.role)) {
                throw new ForbiddenError(`Required roles: ${roles.join(', ')}`);
            }

            if (permissions.length > 0) {
                const missingPermissions = permissions.filter(p => !user.permissions?.includes(p));
                if (missingPermissions.length > 0) {
                    throw new ForbiddenError(`Missing permissions: ${missingPermissions.join(', ')}`);
                }
            }

            // Session validation (optional)
            if (sessionCheck && user.sessionId && user.sessionId !== req.tokenPayload.sessionId) {
                throw new UnauthorizedError('Session invalidated');
            }

            // Set request authentication context
            req.auth = {
                isAuthenticated: true,
                user,
                userId: user._id,
                tokenSource,
                tokenPayload: req.tokenPayload,
                roles: user.roles || [user.role],
                permissions: user.permissions || []
            };

            // Also set req.user for backward compatibility
            req.user = user;

            // Update response headers
            setAuthHeaders(res, user, req.tokenPayload, tokenSource);

            // Log successful authentication
            const authTime = Number(process.hrtime.bigint() - authStart) / 1e6;
            logger.info('Authentication successful', {
                userId: user._id,
                tokenSource,
                duration: `${authTime.toFixed(2)}ms`,
                ...authContext
            });

            next();
        } catch (err) {
            // Security cleanup
            if (req.cookies?.token && (err instanceof UnauthorizedError || err instanceof TokenExpiredError)) {
                clearAuthCookie(res);
            }

            // Log authentication failure
            const authTime = Number(process.hrtime.bigint() - authStart) / 1e6;
            logger.warn('Authentication failed', {
                error: err.message,
                errorType: err.name,
                duration: `${authTime.toFixed(2)}ms`,
                ...authContext
            });

            if (required || err instanceof ForbiddenError) {
                next(err);
            } else {
                req.auth = { isAuthenticated: false };
                next();
            }
        }
    };
};

// Helper function to get user with cache
async function getUserWithCache(userId, cacheKey) {
    let user;
    
    if (redis?.client) {
        try {
            const cachedUser = await redis.client.get(cacheKey);
            if (cachedUser) {
                user = JSON.parse(cachedUser);
                // Verify critical fields from database
                const dbUser = await User.findById(userId)
                    .select('passwordChangedAt isActive accountLocked sessionId lastLoginAt')
                    .lean();
                
                if (dbUser) {
                    user.passwordChangedAt = dbUser.passwordChangedAt;
                    user.isActive = dbUser.isActive;
                    user.accountLocked = dbUser.accountLocked;
                    user.sessionId = dbUser.sessionId;
                    user.lastLoginAt = dbUser.lastLoginAt;
                }
            }
        } catch (cacheError) {
            logger.warn('User cache read failed', { 
                error: cacheError.message,
                userId,
                cacheKey
            });
        }
    }

    if (!user) {
        user = await User.findById(userId)
            .select('-password +passwordChangedAt +isActive +accountLocked +sessionId +lastLoginAt +lastKnownIp +lastKnownUserAgent +roles +permissions')
            .lean();

        if (user && redis?.client) {
            try {
                await redis.client.setex(cacheKey, 300, JSON.stringify(user));
            } catch (cacheError) {
                logger.warn('User cache write failed', {
                    error: cacheError.message,
                    userId,
                    cacheKey
                });
            }
        }
    }

    return user;
}

// Helper function to validate user status
function validateUserStatus(user) {
    if (!user.isActive) {
        throw new ForbiddenError('User account is deactivated');
    }

    if (user.accountLocked) {
        throw new ForbiddenError('User account is locked');
    }
}

// Helper function to validate password recency
function validatePasswordRecency(user, tokenIat) {
    if (user.passwordChangedAt && tokenIat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
        throw new UnauthorizedError('Password changed. Please log in again.');
    }
}

// Helper function to set authentication headers
function setAuthHeaders(res, user, tokenPayload, tokenSource) {
    const headers = {
        'X-Authenticated-User': user._id.toString(),
        'X-Auth-Expires': new Date((tokenPayload.exp || Date.now() / 1000 + 3600) * 1000).toISOString(),
        'X-Auth-Source': tokenSource,
        'X-Request-ID': res.locals.requestId || crypto.randomUUID(),
        'X-User-Role': user.role || 'none'
    };

    if (user.permissions) {
        headers['X-User-Permissions'] = user.permissions.join(',');
    }

    res.set(headers);
}

// Helper function to clear authentication cookie
function clearAuthCookie(res) {
    res.clearCookie('token', {
        httpOnly: true,
        secure: config?.isProduction || process.env.NODE_ENV === 'production',
        sameSite: config?.isProduction ? 'none' : 'lax',
        domain: config?.cookie?.domain,
        path: '/'
    });
}

// Role-based authorization middleware
const authorize = (roles = [], permissions = []) => {
    return (req, res, next) => {
        try {
            if (!req.user && !req.auth?.isAuthenticated) {
                throw new UnauthorizedError('Authentication required');
            }

            const user = req.user || req.auth?.user;
            const userPermissions = req.auth?.permissions || user?.permissions || [];

            if (roles.length > 0 && !roles.includes(user.role)) {
                throw new ForbiddenError(`Required roles: ${roles.join(', ')}`);
            }

            if (permissions.length > 0) {
                const missingPermissions = permissions.filter(
                    p => !userPermissions.includes(p)
                );
                if (missingPermissions.length > 0) {
                    throw new ForbiddenError(`Missing permissions: ${missingPermissions.join(', ')}`);
                }
            }

            next();
        } catch (err) {
            next(err);
        }
    };
};

// Backward compatibility
const restrictTo = authorize;

// Optional authentication middleware
const optionalAuth = protect({ required: false });

// Advanced rate limiting for authentication endpoints
const createAuthRateLimit = (options = {}) => {
    const {
        windowMs = 15 * 60 * 1000, // 15 minutes
        max = 5, // 5 attempts
        message = 'Too many authentication attempts',
        skipSuccessfulRequests = true,
        keyGenerator = (req) => {
            return `${req.ip}:${req.body?.email || 'unknown'}`;
        },
        handler = (req, res) => {
            // Log when rate limit is reached
            logger.warn('Rate limit reached', {
                ip: req.ip,
                identifier: req.body?.email || 'unknown',
                path: req.path,
                timestamp: new Date().toISOString()
            });
            
            res.status(429).json({
                success: false,
                error: message,
                code: 'RATE_LIMITED',
                retryAfter: Math.ceil(options.windowMs / 1000)
            });
        }
    } = options;

    return rateLimit({
        windowMs,
        max,
        skipSuccessfulRequests,
        keyGenerator,
        handler,
        standardHeaders: true,
        legacyHeaders: false
        // Removed deprecated onLimitReached - moved logic to handler
    });
};

// Token refresh validation middleware
const validateRefreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            throw new UnauthorizedError('Refresh token required');
        }

        req.refreshTokenPayload = await verifyToken(refreshToken, { 
            audience: config?.jwt?.refreshAudience,
            maxAge: config?.jwt?.refreshExpiresIn || '7d'
        });

        // Additional refresh token validation
        if (req.refreshTokenPayload.type && req.refreshTokenPayload.type !== 'refresh') {
            throw new UnauthorizedError('Invalid token type');
        }

        next();
    } catch (err) {
        next(err);
    }
};

// Token revocation middleware
const revokeToken = async (req, res, next) => {
    try {
        if (!req.auth?.tokenPayload?.jti) {
            throw new UnauthorizedError('No valid token to revoke');
        }

        if (redis?.client) {
            const ttl = req.auth.tokenPayload.exp - Math.floor(Date.now() / 1000);
            if (ttl > 0) {
                await redis.client.setex(
                    `auth:revoked:${req.auth.tokenPayload.jti}`,
                    ttl,
                    new Date().toISOString()
                );
            }
        }

        next();
    } catch (err) {
        next(err);
    }
};

// Check permission middleware - Enhanced version
const checkPermission = (permission) => {
    return (req, res, next) => {
        try {
            if (!req.user && !req.auth?.isAuthenticated) {
                throw new UnauthorizedError('Authentication required');
            }

            const user = req.user || req.auth?.user;
            
            // Enhanced role-based permission system
            const rolePermissions = {
                'super_admin': ['*'], // All permissions
                'admin': [
                    'user:view:all', 'user:create', 'user:update', 'user:delete',
                    'user:manage:roles', 'profile:view:all', 'address:view:all', 
                    'order:view:all'
                ],
                'regional_manager': [
                    'profile:view:own', 'profile:update:own',
                    'address:manage:own', 'order:view:own'
                ],
                'seller': [
                    'profile:view:own', 'profile:update:own', 
                    'address:manage:own', 'order:view:own'
                ],
                'customer': [
                    'profile:view:own', 'profile:update:own', 
                    'address:manage:own', 'order:view:own'
                ],
                'moderator': [
                    'profile:view:own', 'profile:update:own',
                    'address:manage:own', 'order:view:own'
                ],
                'delivery_agent': [
                    'profile:view:own', 'profile:update:own',
                    'address:manage:own', 'order:view:own'
                ],
                'support': [
                    'profile:view:own', 'profile:update:own',
                    'address:manage:own', 'order:view:own'
                ]
            };

            const userPermissions = user.permissions || rolePermissions[user.role] || [];
            
            if (userPermissions.includes('*') || userPermissions.includes(permission)) {
                return next();
            }

            throw new ForbiddenError('Insufficient permissions');
        } catch (err) {
            next(err);
        }
    };
};

// Create default auth limiter instance
const authLimiter = createAuthRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: 'Too many authentication attempts, please try again later.',
    skipSuccessfulRequests: true
});

module.exports = {
    protect,
    authorize,
    restrictTo, // Backward compatibility
    optionalAuth,
    validateRefreshToken,
    createAuthRateLimit,
    authLimiter, // Export default rate limiter
    checkPermission, // Export permission checker
    revokeToken,
    verifyToken,
    // Error classes
    AuthenticationError,
    UnauthorizedError,
    ForbiddenError,
    TokenExpiredError,
    TokenRevokedError,
    SuspiciousActivityError
};