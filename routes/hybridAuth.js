const express = require('express');
const { body, check, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const validator = require('validator');

const router = express.Router();

// Import utilities
const User = require('../models/User');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const { hybridProtect, requireRole } = require('../middleware/hybridAuth');
const { supabase, supabaseAdmin, SupabaseHelpers } = require('../config/supabase');

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * HYBRID REGISTER - Uses Supabase Auth + MongoDB for user data
 * Reduces memory usage by offloading auth to Supabase
 * Supports email as primary identifier (Supabase requirement)
 */
router.post(
  '/register',
  authLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
    body('phone').optional().isMobilePhone('en-IN').withMessage('Valid Indian phone number required'),
    body('role').optional().isIn(['customer', 'seller']).withMessage('Role must be customer or seller')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          message: errors.array()[0].msg,
          errors: errors.array() 
        });
      }

      const { name, email, password, phone, role = 'customer' } = req.body;

      // Check if user already exists in MongoDB (email or phone)
      const existingUserQuery = { 
        $or: [
          { email: email.toLowerCase() },
          ...(phone ? [{ phone }] : [])
        ]
      };
      const existingUser = await User.findOne(existingUserQuery);
      if (existingUser) {
        const conflict = existingUser.email === email.toLowerCase() ? 'email' : 'phone number';
        return res.status(409).json({
          success: false,
          message: `An account already exists with this ${conflict}.`
        });
      }

      // Create user in Supabase Auth (handles password hashing, email verification)
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.toLowerCase(),
        password,
        user_metadata: {
          name,
          role
        },
        email_confirm: true // Auto-confirm all new users
      });

      if (authError) {
        logger.error('Supabase user creation failed', authError);
        return res.status(400).json({
          success: false,
          message: authError.message || 'Registration failed due to authentication service error'
        });
      }

      // Create user in MongoDB with Supabase ID
      const userData = {
        name: name.trim(),
        email: email.toLowerCase(),
        supabaseId: authData.user.id,
        role,
        isVerified: true, // Mark as verified in our database as well
        authProvider: 'supabase',
        walletBalance: role === 'customer' ? 50 : 0, // Welcome bonus for customers
        // No password needed in MongoDB for Supabase users
        password: crypto.randomBytes(32).toString('hex'),
        ...(phone && { phone })
      };

      const user = new User(userData);
      await user.save();

      // Log analytics event to Supabase (memory-efficient logging)
      await SupabaseHelpers.logAnalyticsEvent('user_registered', {
        role,
        email: email.toLowerCase(),
        method: 'supabase_hybrid'
      }, authData.user.id);

      logger.info(`Hybrid user registered: ${email}`, {
        userId: user._id,
        supabaseId: authData.user.id,
        role,
        method: 'supabase_hybrid'
      });

      res.status(201).json({
        success: true,
        message: 'Registration successful! You can now log in.',
        userId: user._id,
        requiresVerification: false // No longer requires verification
      });

    } catch (err) {
      logger.error('Hybrid registration error', err);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred during registration.'
      });
    }
  }
);


/**
 * HYBRID LOGIN - Supports both Supabase and legacy JWT users
 * Supports email OR phone as identifier (like frontend expects)
 */
router.post(
  '/login',
  authLimiter,
  [
    body('identifier')
      .notEmpty()
      .withMessage('Email or phone number required')
      .custom((value) => {
        // Check if it's a valid email or phone number
        if (validator.isEmail(value) || validator.isMobilePhone(value, 'en-IN')) {
          return true;
        }
        throw new Error('Please provide a valid email address or Indian phone number');
      }),
    body('password').notEmpty().withMessage('Password required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          message: errors.array()[0].msg,
          errors: errors.array() 
        });
      }

      const { identifier, password } = req.body;
      
      // Determine if identifier is email or phone
      const isEmail = validator.isEmail(identifier);
      const searchQuery = isEmail 
        ? { email: identifier.toLowerCase() }
        : { phone: identifier };

      // Find user in MongoDB
      const user = await User.findOne({ 
        ...searchQuery,
        isActive: true 
      }).lean(); // Use .lean() for faster, plain object read

      if (!user || !user.supabaseId) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials or account not found.'
        });
      }

      let authData = null;

      // If user has Supabase ID, authenticate via Supabase
      if (user.supabaseId) {
        // Supabase only supports email login, so use user's email
        const { data, error } = await supabase.auth.signInWithPassword({
          email: user.email.toLowerCase(),
          password
        });

        if (error) {
          logger.warn('Supabase login failed', { identifier, error: error.message });
          return res.status(401).json({
            success: false,
            message: 'Invalid credentials. Please check and try again.'
          });
        }

        authData = data;
      } else {
        // Legacy JWT authentication for existing users
        const legacyUser = await User.findOne(searchQuery)
          .select('+password');

        if (!legacyUser || !(await legacyUser.correctPassword(password))) {
          return res.status(401).json({
            success: false,
            message: 'Invalid email or password'
          });
        }

        // Migrate legacy user to Supabase in background
        setImmediate(async () => {
          try {
            await SupabaseHelpers.syncUserToSupabase(legacyUser);
            logger.info('Legacy user synced to Supabase', { userId: legacyUser._id });
          } catch (syncError) {
            logger.error('Failed to sync legacy user to Supabase', syncError);
          }
        });

        // Create JWT token for legacy users
        const token = legacyUser.getSignedJwtToken();
        return res.json({
          success: true,
          message: 'Login successful (legacy mode)',
          token,
          user: {
            id: legacyUser._id,
            name: legacyUser.name,
            email: legacyUser.email,
            role: legacyUser.role,
            isVerified: legacyUser.isVerified
          }
        });
      }

      // For Supabase users, return the session token
      await SupabaseHelpers.logAnalyticsEvent('user_login', {
        identifier,
        email: user.email,
        method: 'supabase_hybrid',
        loginType: isEmail ? 'email' : 'phone',
        ip: req.ip
      }, user.supabaseId);

      logger.info(`Hybrid login successful: ${identifier}`, {
        userId: user._id,
        supabaseId: user.supabaseId,
        method: 'supabase_hybrid'
      });

      res.json({
        success: true,
        message: 'Login successful',
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          isVerified: user.isVerified,
          walletBalance: user.walletBalance
        }
      });

    } catch (err) {
      logger.error('Hybrid login error', err);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred during login.'
      });
    }
  }
);

/**
 * HYBRID LOGOUT - Works with both auth methods
 */
router.post('/logout', hybridProtect, async (req, res) => {
  try {
    // If using Supabase auth, sign out from Supabase
    if (req.authMethod === 'supabase') {
      await supabase.auth.signOut();
    }

    logger.info('Hybrid logout successful', {
      userId: req.user._id,
      authMethod: req.authMethod
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (err) {
    logger.error('Hybrid logout error', err);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

/**
 * GET USER PROFILE - Works with hybrid auth
 */
router.get('/me', hybridProtect, async (req, res) => {
  try {
    // Get fresh user data from MongoDB
    const user = await User.findById(req.user._id || req.user.id)
      .select('-password -refreshToken')
      .populate('addresses', 'street city state pincode isDefault')
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        ...user,
        authMethod: req.authMethod
      }
    });

  } catch (err) {
    logger.error('Get profile error', err);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

/**
 * UPDATE USER PROFILE (ADDRESS) - PUT/PATCH /api/v1/auth/profile
 * Handles address updates for authenticated users
 */
const profileValidators = [
  check('address')
    .exists()
    .withMessage('address is required')
    .custom(val => val && typeof val === 'object')
    .withMessage('address must be an object')
];

async function handleProfileUpdate(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: errors.array()[0].msg, 
        errors: errors.array() 
      });
    }

    const userId = req.user && (req.user._id || req.user.id);
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const address = req.body.address;
    if (!address || typeof address !== 'object') {
      return res.status(400).json({ 
        success: false, 
        message: 'Address object is required' 
      });
    }

    // Normalize address fields (trim strings)
    const normalizedAddress = {};
    for (const k of Object.keys(address)) {
      const val = address[k];
      normalizedAddress[k] = typeof val === 'string' ? val.trim() : val;
    }

    // Update user with normalized address
    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: { address: normalizedAddress } },
      { new: true, runValidators: true, context: 'query' }
    ).select('-password -refreshToken').lean();

    if (!updated) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    logger.info('Profile updated', { userId });

    return res.json({ 
      success: true, 
      message: 'Profile updated successfully', 
      user: updated 
    });

  } catch (err) {
    logger.error('Profile update error', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to update profile' 
    });
  }
}

// Register both PUT and PATCH routes for profile updates
router.put('/profile', hybridProtect, profileValidators, handleProfileUpdate);
router.patch('/profile', hybridProtect, profileValidators, handleProfileUpdate);

/**
 * REFRESH TOKEN - Supabase handles this automatically
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token
    });

    if (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    res.json({
      success: true,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    });

  } catch (err) {
    logger.error('Token refresh error', err);
    res.status(500).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
});

/**
 * PASSWORD RESET - Uses Supabase for memory efficiency
 */
router.post('/forgot-password', 
  authLimiter,
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { email } = req.body;

      // Use Supabase reset password (more memory efficient)
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.CLIENT_URL}/reset-password`
      });

      // Always return success for security (don't reveal if email exists)
      res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });

      if (!error) {
        logger.info('Password reset requested', { email });
      } else {
        logger.error('Password reset failed', { email, error });
      }

    } catch (err) {
      logger.error('Forgot password error', err);
      res.status(500).json({ success: false, message: 'Password reset request failed' });
    }
  }
);

module.exports = router;