const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const jwtConfig = require('../../config/jwt.config');
const AppError = require('../appError');

// Promisify JWT functions for async/await
const signToken = promisify(jwt.sign);
const verifyToken = promisify(jwt.verify);

/**
 * Generates both access and refresh tokens
 */
const generateTokens = async (user) => {
  if (!user._id) {
    throw new AppError('User ID is required for token generation', 500);
  }

  const payload = {
    id: user._id,
    role: user.role,
    session: crypto.randomBytes(16).toString('hex') // Unique session ID
  };

  try {
    const [accessToken, refreshToken] = await Promise.all([
      signToken(payload, jwtConfig.secret, {
        expiresIn: jwtConfig.accessExpiresIn,
        issuer: jwtConfig.issuer
      }),
      signToken(payload, jwtConfig.refreshSecret, {
        expiresIn: jwtConfig.refreshExpiresIn,
        issuer: jwtConfig.issuer
      })
    ]);

    return { accessToken, refreshToken };
  } catch (err) {
    throw new AppError('Token generation failed', 500);
  }
};

/**
 * Verifies a JWT token
 */
const verifyJWT = async (token, isRefresh = false) => {
  try {
    return await verifyToken(
      token,
      isRefresh ? jwtConfig.refreshSecret : jwtConfig.secret,
      { issuer: jwtConfig.issuer }
    );
  } catch (err) {
    // Handle specific JWT errors
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Your token has expired', 401);
    }
    if (err.name === 'JsonWebTokenError') {
      throw new AppError('Invalid token', 401);
    }
    throw err;
  }
};

/**
 * Decodes a token without verification
 */
const decodeToken = (token) => {
  return jwt.decode(token);
};

module.exports = {
  generateTokens,
  verifyJWT,
  decodeToken
};