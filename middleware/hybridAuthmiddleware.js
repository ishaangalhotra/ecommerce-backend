const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { SupabaseHelpers } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Hybrid Authentication Middleware
 * Supports both traditional JWT and Supabase authentication
 * Allows gradual migration from JWT to Supabase
 */

/**
 * Extract token from various sources
 */
const extractToken = (req) => {
  let token = null;

  // Check Authorization header (Bearer token)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  // Check cookies
  else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }
  // Check custom headers
  else if (req.headers['x-access-token']) {
    token = req.headers['x-access-token'];
  }

  return token;
};

/**
 * Verify traditional JWT token
 */
const verifyJWT = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id)
      .select('-password -refreshToken')
      .lean();

    if (!user || !user.isActive) {
      return null;
    }

    // Check token version for security
    if (decoded.tokenVersion !== (user.tokenVersion || 0)) {
      return null;
    }

    return {
      ...user,
      authMethod: 'jwt'
    };
  } catch (error) {
    logger.error('JWT verification failed', error);
    return null;
  }
};

/**
 * Verify Supabase token and get user data
 */
const verifySupabaseToken = async (token) => {
  try {
    const supabaseUser = await SupabaseHelpers.verifySupabaseToken(token);
    if (!supabaseUser) return null;

    // Find corresponding MongoDB user
    let mongoUser = await User.findOne({
      $or: [
        { supabaseId: supabaseUser.id },
        { email: supabaseUser.email }
      ]
    }).select('-password -refreshToken').lean();

    // If no MongoDB user found, create one (auto-migration)
    if (!mongoUser && supabaseUser.email) {
      try {
        const newUser = new User({
          name: supabaseUser.user_metadata?.name || supabaseUser.email.split('@')[0],
          email: supabaseUser.email,
          supabaseId: supabaseUser.id,
          isVerified: true,
          role: supabaseUser.user_metadata?.role || 'customer',
          authProvider: 'supabase',
          profilePicture: supabaseUser.user_metadata?.profilePicture,
          phone: supabaseUser.user_metadata?.phone,
          // Generate a random password for MongoDB compatibility
          password: require('crypto').randomBytes(32).toString('hex')
        });

        mongoUser = await newUser.save();
        mongoUser = mongoUser.toObject();

        logger.info('Auto-created MongoDB user from Supabase', {
          userId: mongoUser._id,
          supabaseId: supabaseUser.id,
          email: supabaseUser.email
        });
      } catch (error) {
        logger.error('Failed to auto-create MongoDB user', error);
        return null;
      }
    }

    // Update supabaseId if missing
    if (mongoUser && !mongoUser.supabaseId) {
      await User.findByIdAndUpdate(mongoUser._id, { supabaseId: supabaseUser.id });
      mongoUser.supabaseId = supabaseUser.id;
    }

    return {
      ...mongoUser,
      authMethod: 'supabase',
      supabaseUser
    };
  } catch (error) {
    logger.error('Supabase verification failed', error);
    return null;
  }
};

/**
 * Main hybrid authentication middleware
 */
const hybridProtect = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    let user = null;

    // Try Supabase authentication first (for new users)
    if (token.length > 100) { // Supabase tokens are typically longer
      user = await verifySupabaseToken(token);
    }

    // Fallback to JWT authentication (for existing users)
    if (!user) {
      user = await verifyJWT(token);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Invalid token.'
      });
    }

    // Add user to request object
    req.user = user;
    req.authMethod = user.authMethod;

    // Log authentication for monitoring
    logger.info('User authenticated', {
      userId: user._id || user.id,
      email: user.email,
      authMethod: user.authMethod,
      ip: req.ip
    });

    next();
  } catch (error) {
    logger.error('Hybrid authentication error', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication service error'
    });
  }
};

/**
 * Role-based access control for hybrid auth
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

/**
 * Optional authentication (for public endpoints that benefit from user context)
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (token) {
      let user = null;

      // Try both authentication methods
      if (token.length > 100) {
        user = await verifySupabaseToken(token);
      }

      if (!user) {
        user = await verifyJWT(token);
      }

      if (user) {
        req.user = user;
        req.authMethod = user.authMethod;
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors
    logger.warn('Optional auth failed', error);
    next();
  }
};

/**
 * Migration helper - sync user to Supabase if needed
 */
const ensureSupabaseSync = async (req, res, next) => {
  try {
    if (req.user && req.authMethod === 'jwt' && !req.user.supabaseId) {
      // Background sync to Supabase for JWT users
      setImmediate(async () => {
        try {
          const fullUser = await User.findById(req.user._id);
          if (fullUser && fullUser.email && !fullUser.supabaseId) {
            await SupabaseHelpers.syncUserToSupabase(fullUser);
          }
        } catch (syncError) {
          logger.error('Background Supabase sync failed', syncError);
        }
      });
    }

    next();
  } catch (error) {
    logger.error('Supabase sync middleware error', error);
    next(); // Continue even if sync fails
  }
};

module.exports = {
  hybridProtect,
  requireRole,
  optionalAuth,
  ensureSupabaseSync,
  extractToken,
  verifyJWT,
  verifySupabaseToken
};
