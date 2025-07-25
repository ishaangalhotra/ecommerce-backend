// Re-export from authMiddleware.js and add missing functions
const authMiddleware = require('./authMiddleware');

// Add authenticateToken as alias for protect
const authenticateToken = authMiddleware.protect;

module.exports = {
  // Re-export everything from authMiddleware
  ...authMiddleware,
  
  // Add the missing function that payment routes expect
  authenticateToken,
  
  // Additional aliases for compatibility
  auth: authMiddleware.protect,
  protect: authMiddleware.protect,
  authorize: authMiddleware.authorize,
  checkPermission: authMiddleware.checkPermission
};
