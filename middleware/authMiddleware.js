const jwt = require('jsonwebtoken');
const { ErrorResponse } = require('../utils/error');
const User = require('../models/User');
const redis = require('../utils/redis');
const logger = require('../utils/logger');
const config = require('../config/config');

// Custom error classes
class Unauthorized extends ErrorResponse {
  constructor(message = 'Authentication required', details = null) {
    super(message, 401, details);
  }
}
class Forbidden extends ErrorResponse {
  constructor(message = 'Access forbidden', details = null) {
    super(message, 403, details);
  }
}

// Token verification
const verifyToken = async (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      clockTolerance: 15,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });

    if (!decoded?.sub || !decoded?.jti) {
      throw new Unauthorized('Invalid token structure');
    }

    if (redis.client && (await redis.client.get(`auth:revoked:${decoded.jti}`))) {
      throw new Unauthorized('Token revoked');
    }

    return decoded;
  } catch (err) {
    logger.warn(`Token verification failed: ${err.message}`);
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      throw new Unauthorized(err.message);
    }
    throw err;
  }
};

// Middleware to protect routes
const protect = async (req, res, next) => {
  try {
    let token;
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new Unauthorized('Authentication required: No token provided');
    }

    req.tokenPayload = await verifyToken(token);

    const user = await User.findById(req.tokenPayload.sub).select('+passwordChangedAt');
    if (!user) {
      throw new Unauthorized('User not found');
    }

    if (user.passwordChangedAt && req.tokenPayload.iat < (user.passwordChangedAt.getTime() / 1000)) {
      throw new Unauthorized('Password changed. Please log in again.');
    }

    req.user = user;
    req.userId = user._id;

    res.set({
      'X-Authenticated-User': user._id.toString(),
      'X-Auth-Expires': new Date(req.tokenPayload.exp * 1000).toISOString()
    });

    next();
  } catch (err) {
    if (req.cookies?.token) {
      res.clearCookie('token', {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: config.isProduction ? 'none' : 'lax',
        domain: config.cookie?.domain || 'localhost'
      });
    }
    next(err);
  }
};

// Middleware to restrict to certain roles
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied: insufficient permissions' });
    }
    next();
  };
};

// Alternative role-based middleware
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    throw new Unauthorized('Authorization required');
  }

  if (!roles.includes(req.user.role)) {
    throw new Forbidden(`User role '${req.user.role}' is not authorized to access this route.`);
  }

  next();
};

module.exports = {
  protect,
  restrictTo,
  authorize,
  Unauthorized,
  Forbidden
};
