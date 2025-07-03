const jwt = require('jsonwebtoken');
const ErrorResponse = require('../utils/errorResponse');
const User = require('../models/User');

// Protect routes with JWT
exports.protect = async (req, res, next) => {
  let token;

  // Check multiple token sources
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists
    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user) {
      return next(new ErrorResponse('User no longer exists', 401));
    }

    // Check if token was issued before password change
    if (user.changedPasswordAfter(decoded.iat)) {
      return next(new ErrorResponse('Password changed recently. Please log in again', 401));
    }

    req.user = user;
    next();
  } catch (err) {
    return next(new ErrorResponse('Invalid or expired token', 401));
  }
};

// Role-based authorization
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new ErrorResponse(
          `Role ${req.user.role} is not authorized for this action`,
          403
        )
      );
    }
    next();
  };
};

// Refresh token verification
exports.verifyRefresh = async (req, res, next) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return next(new ErrorResponse('Refresh token required', 400));

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user || user.refreshToken !== refreshToken) {
      return next(new ErrorResponse('Invalid refresh token', 401));
    }

    req.user = user;
    next();
  } catch (err) {
    return next(new ErrorResponse('Invalid refresh token', 401));
  }
};