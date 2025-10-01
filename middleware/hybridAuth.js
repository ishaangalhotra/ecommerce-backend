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
 * Normalize user object to ensure consistent ID properties
 */
const normalizeUser = (user, authMethod) => {
  if (!user) return null;
  
  // Ensure both id and _id are present for compatibility
  const userId = user._id || user.id;
  
  return {
    ...user,
    id: userId,
    _id: userId,
    authMethod
  };
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
      logger.warn('Token version mismatch', { 
        userId: decoded.id, 
        expectedVersion: user.tokenVersion || 0, 
        actualVersion: decoded.tokenVersion 
      });
      return null;
    }

    return normalizeUser(user, 'jwt');
  } catch (error) {
    // Only log errors that aren't expected token expirations
    if (error.name !== 'TokenExpiredError') {
      logger.error('JWT verification failed', { error: error.message });
    }
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
          isVerified: supabaseUser.email_confirmed_at ? true : false,
          role: supabaseUser.user_metadata?.role || 'customer',
          authProvider: 'supabase',
          profilePicture: supabaseUser.user_metadata?.profilePicture,
          phone: supabaseUser.user_metadata?.phone || supabaseUser.phone,
          // Generate a random password for MongoDB compatibility
          password: require('crypto').randomBytes(32).toString('hex')
        });

        mongoUser = await newUser.save();
        mongoUser = mongoUser.toObject();
        delete mongoUser.password; // Remove password from response

        logger.info('Auto-created MongoDB user from Supabase', {
          userId: mongoUser._id,
          supabaseId: supabaseUser.id,
          email: supabaseUser.email
        });
      } catch (error) {
        logger.error('Failed to auto-create MongoDB user', { 
          error: error.message,
          supabaseId: supabaseUser.id,
          email: supabaseUser.email 
        });
        return null;
      }
    }

    // Update supabaseId if missing (for existing users)
    if (mongoUser && !mongoUser.supabaseId) {
      await User.findByIdAndUpdate(
        mongoUser._id, 
        { 
          supabaseId: supabaseUser.id,
          lastAuthMethod: 'supabase',
          lastAuthAt: new Date()
        }
      );
      mongoUser.supabaseId = supabaseUser.id;
    }

    // Merge Supabase metadata with MongoDB user data
    const mergedUser = {
      ...mongoUser,
      supabaseUser,
      // Prefer Supabase metadata if more recent
      email: supabaseUser.email || mongoUser.email,
      isVerified: supabaseUser.email_confirmed_at ? true : mongoUser.isVerified
    };

    return normalizeUser(mergedUser, 'supabase');
  } catch (error) {
    logger.error('Supabase verification failed', { error: error.message });
    return null;
  }
};

/**
 * Determine token type based on characteristics
 */
const getTokenType = (token) => {
  if (!token) return null;
  
  // Supabase tokens are typically JWT with specific structure
  if (token.length > 100) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        // Check for Supabase-specific claims
        if (payload.sub && payload.aud && payload.role) {
          return 'supabase';
        }
      }
    } catch (e) {
      // Not a valid JWT, fall through
    }
  }
  
  return 'jwt';
};

/**
 * Main hybrid authentication middleware - FIXED VERSION
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
    const tokenType = getTokenType(token);

    // Try authentication based on detected token type
    if (tokenType === 'supabase') {
      user = await verifySupabaseToken(token);
      // If Supabase verification fails, try JWT as fallback
      if (!user) {
        user = await verifyJWT(token);
      }
    } else {
      // Try JWT first for shorter tokens
      user = await verifyJWT(token);
      // If JWT fails, try Supabase as fallback
      if (!user) {
        user = await verifySupabaseToken(token);
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Invalid or expired token.'
      });
    }

    // Attach normalized user to request
    req.user = user;
    req.authMethod = user.authMethod;
    req.userId = user.id; // Convenience property

    // Update last activity
    setImmediate(async () => {
      try {
        await User.findByIdAndUpdate(
          user.id,
          { 
            lastActiveAt: new Date(),
            lastAuthMethod: user.authMethod 
          },
          { timestamps: false }
        );
      } catch (error) {
        logger.error('Failed to update user activity', { userId: user.id });
      }
    });

    // Log authentication for monitoring
    logger.info('User authenticated', {
      userId: user.id,
      email: user.email,
      authMethod: user.authMethod,
      tokenType,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    next();
  } catch (error) {
    logger.error('Hybrid authentication error', { 
      error: error.message,
      stack: error.stack 
    });
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

    // Support both single role and array of roles
    const userRoles = Array.isArray(req.user.role) ? req.user.role : [req.user.role];
    const hasRequiredRole = roles.some(role => userRoles.includes(role));

    if (!hasRequiredRole) {
      logger.warn('Access denied - insufficient permissions', {
        userId: req.user.id,
        userRoles,
        requiredRoles: roles
      });
      
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
      const tokenType = getTokenType(token);

      // Try authentication based on token type
      if (tokenType === 'supabase') {
        user = await verifySupabaseToken(token);
      }
      
      if (!user) {
        user = await verifyJWT(token);
      }

      if (user) {
        req.user = user;
        req.authMethod = user.authMethod;
        req.userId = user.id;
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors
    logger.warn('Optional auth failed', { error: error.message });
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
          const fullUser = await User.findById(req.user.id).select('+password');
          if (fullUser && fullUser.email && !fullUser.supabaseId) {
            const supabaseUser = await SupabaseHelpers.syncUserToSupabase(fullUser);
            if (supabaseUser) {
              await User.findByIdAndUpdate(
                fullUser._id,
                { 
                  supabaseId: supabaseUser.id,
                  lastSyncedAt: new Date()
                }
              );
              logger.info('User synced to Supabase', {
                userId: fullUser._id,
                supabaseId: supabaseUser.id
              });
            }
          }
        } catch (syncError) {
          logger.error('Background Supabase sync failed', { 
            error: syncError.message,
            userId: req.user.id 
          });
        }
      });
    }

    next();
  } catch (error) {
    logger.error('Supabase sync middleware error', { error: error.message });
    next(); // Continue even if sync fails
  }
};

/**
 * Refresh token middleware for expired tokens
 */
const refreshTokenIfNeeded = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return next();
    }

    // Check if token is expired
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      next(); // Token is valid, continue
    } catch (error) {
      if (error.name === 'TokenExpiredError' && req.cookies?.refreshToken) {
        // Attempt to refresh the token
        try {
          const decoded = jwt.decode(token);
          const user = await User.findById(decoded.id).select('+refreshToken');
          
          if (user && user.refreshToken === req.cookies.refreshToken) {
            // Generate new tokens
            const newAccessToken = jwt.sign(
              { 
                id: user._id,
                email: user.email,
                role: user.role,
                tokenVersion: user.tokenVersion || 0
              },
              process.env.JWT_SECRET,
              { expiresIn: '15m' }
            );
            
            // Set new token in cookie
            res.cookie('accessToken', newAccessToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'strict',
              maxAge: 15 * 60 * 1000 // 15 minutes
            });
            
            // Update request with new token
            req.headers.authorization = `Bearer ${newAccessToken}`;
            
            logger.info('Token refreshed', { userId: user._id });
          }
        } catch (refreshError) {
          logger.error('Token refresh failed', { error: refreshError.message });
        }
      }
      
      next();
    }
  } catch (error) {
    logger.error('Refresh token middleware error', { error: error.message });
    next();
  }
};

module.exports = {
  hybridProtect,
  requireRole,
  optionalAuth,
  ensureSupabaseSync,
  refreshTokenIfNeeded,
  extractToken,
  verifyJWT,
  verifySupabaseToken,
  normalizeUser
};