const checkPermission = (requiredPermission) => {
  return (req, res, next) => {
    // Basic permission check - you can enhance this
    if (req.user && req.user.role === 'admin') {
      return next();
    }
    return res.status(403).json({ error: 'Permission denied' });
  };
};

module.exports = { checkPermission };
