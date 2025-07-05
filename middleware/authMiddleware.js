const jwt = require('jsonwebtoken');
const { OperationalError, Unauthorized, Forbidden } = require('./error');
const User = require('../models/User');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

const verifyToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      clockTolerance: 15,
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE
    });

    if (!decoded?.sub || !decoded?.jti) {
      throw new Unauthorized('Invalid token structure');
    }

    // Redis token revocation check
    if (await redis.get(`auth:revoked:${decoded.jti}`)) {
      throw new Unauthorized('Token revoked');
    }

    return decoded;
  } catch (err) {
    logger.warn(`Token verification failed: ${err.message}`);
    throw err;
  }
};

exports.authenticate = async (req, res, next) => {
  try {
    const token = req.cookies?.token || 
                 req.headers['authorization']?.replace('Bearer ', '');

    if (!token) throw new Unauthorized('Authentication required');

    req.tokenPayload = await verifyToken(token);
    req.user = await User.findById(req.tokenPayload.sub)
      .select('+passwordChangedAt')
      .lean();

    if (!req.user) throw new Unauthorized('User not found');
    if (req.tokenPayload.iat < new Date(req.user.passwordChangedAt) / 1000) {
      throw new Unauthorized('Password changed - please reauthenticate');
    }

    // Security headers
    res.set({
      'X-Authenticated-User': req.user._id,
      'X-Auth-Expires': new Date(req.tokenPayload.exp * 1000).toISOString()
    });

    next();
  } catch (err) {
    // Clear invalid token cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      domain: process.env.COOKIE_DOMAIN
    });
    next(err);
  }
};

exports.authorize = (roles = []) => (req, res, next) => {
  if (!req.user) throw new Unauthorized();
  if (roles.length && !roles.includes(req.user.role)) {
    throw new Forbidden('Insufficient permissions');
  }
  next();
};

exports.invalidateToken = async (jti) => {
  const expiresIn = Math.floor((req.tokenPayload.exp - Date.now() / 1000));
  await redis.set(`auth:revoked:${jti}`, '1', 'EX', expiresIn);
};