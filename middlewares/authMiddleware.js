const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('express-async-handler'); // For handling async errors

// Middleware to protect routes (ensure user is logged in and has a valid token)
const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Check if token exists in Authorization header (Bearer token)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header (e.g., "Bearer TOKEN_STRING")
      token = req.headers.authorization.split(' ')[1];

      // Verify token using JWT_SECRET
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Find user by ID from the token payload and attach to req.user
      // .select('-password') excludes the password field from the returned user object
      req.user = await User.findById(decoded.user.id).select('-password');

      next(); // Proceed to the next middleware/route handler
    } catch (error) {
      console.error('Not authorized, token failed:', error.message);
      res.status(401); // Unauthorized
      throw new Error('Not authorized, token failed');
    }
  }

  if (!token) {
    res.status(401); // Unauthorized
    throw new Error('Not authorized, no token');
  }
});

// Middleware to check for admin role
const admin = (req, res, next) => {
  // Check if user is logged in and has the 'admin' role
  if (req.user && req.user.role === 'admin') {
    next(); // User is admin, proceed
  } else {
    res.status(403); // Forbidden
    throw new Error('Not authorized as an admin');
  }
};

// Middleware to check for seller role
const isSeller = (req, res, next) => {
  // Allow admins to act as sellers too, or strictly 'seller'
  if (req.user && (req.user.role === 'seller' || req.user.role === 'admin')) {
    next(); // User is seller or admin, proceed
  } else {
    res.status(403); // Forbidden
    throw new Error('Not authorized as a seller');
  }
};

module.exports = { protect, admin, isSeller };