// Add this with your other exports at the bottom of authController.js

// @desc    Restrict access to specific roles
// @usage   router.use(restrictTo('admin', 'editor'))
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles ['admin', 'editor']. role='user'
    if (!roles.includes(req.user.role)) {
      return next(
        new ErrorResponse(
          `User role ${req.user.role} is not authorized to access this route`,
          403
        )
      );
    }
    next();
  };
};

// Also add this protect middleware which is needed before restrictTo
// @desc    Protect routes - require authentication
// @usage   router.use(protect)
exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  // 1) Get token from header or cookies
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.token) {
    token = req.cookies.token;
  }

  // 2) Verify token exists
  if (!token) {
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }

  try {
    // 3) Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // 4) Get user from token
    req.user = await User.findById(decoded.id);
    next();
  } catch (err) {
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }
});