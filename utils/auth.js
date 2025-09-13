// ⚠️ DEPRECATED: This file is deprecated in favor of hybridAuth system
// Please use Supabase authentication for new development
// This file is kept for backward compatibility only

console.warn('⚠️  WARNING: Using deprecated auth utils. Please migrate to Supabase/hybridAuth system');

const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const crypto = require('crypto');
const logger = require('./logger');
const User = require('../models/User');

// Generate JWT tokens
const generateTokens = (id) => {
  const accessToken = jwt.sign({ id }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN,
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE
  });
  
  const refreshToken = jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE
  });
  
  return { accessToken, refreshToken };
};

// Verify JWT token
const verifyToken = async (token, isRefresh = false) => {
  const secret = isRefresh ? process.env.JWT_REFRESH_SECRET : process.env.JWT_ACCESS_SECRET;
  return await promisify(jwt.verify)(token, secret);
};

// Generate random token
const generateRandomToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Create and send token response
const sendTokenResponse = (user, statusCode, res) => {
  const { accessToken, refreshToken } = generateTokens(user._id);
  
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    domain: process.env.COOKIE_DOMAIN
  };

  res.cookie('accessToken', accessToken, cookieOptions);
  res.cookie('refreshToken', refreshToken, { 
    ...cookieOptions,
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  });

  // Remove sensitive data
  user.password = undefined;
  user.refreshToken = undefined;

  res.status(statusCode).json({
    status: 'success',
    accessToken,
    refreshToken,
    data: {
      user
    }
  });
};

// Hash token for DB storage
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

module.exports = {
  generateTokens,
  verifyToken,
  generateRandomToken,
  sendTokenResponse,
  hashToken
};