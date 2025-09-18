const express = require('express');
const { body, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const validator = require('validator');

const router = express.Router();

// Import utilities
// const User = require('../models/User'); // MongoDB User model is no longer needed
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
 * REGISTER - Uses Supabase Auth
 * Creates a new user in Supabase Auth only.
 * This endpoint no longer interacts with MongoDB.
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

      // Use Supabase to create the user. It handles password hashing and existence checks.
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.toLowerCase(),
        password,
        user_metadata: {
          name,
          role,
          phone
        },
        email_confirm: true // Auto-confirm all new users
      });

      if (authError) {
        logger.error('Supabase user creation failed', authError);
        return res.status(400).json({ success: false, message: authError.message || 'Registration failed due to authentication service error' });
      }

      logger.info('User successfully registered via Supabase Auth', { id: authData.user.id, email: authData.user.email });

      return res.status(201).json({
        success: true,
        message: 'Registration successful!',
        data: {
          id: authData.user.id,
          email: authData.user.email,
          role: role,
        }
      });
    } catch (err) {
      logger.error('Registration failed', err);
      res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
  }
);

/**
 * LOGIN - Uses Supabase Auth
 * Authenticates user credentials against Supabase.
 */
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg });
      }

      const { email, password } = req.body;

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        logger.warn('Login attempt failed', { email, error: error.message });
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials. Please check and try again.'
        });
      }

      if (!data.session || !data.user) {
        return res.status(401).json({ success: false, message: 'Authentication failed. Please try again.' });
      }

      logger.info('User logged in successfully', { email: data.user.email, id: data.user.id });

      res.status(200).json({
        success: true,
        message: 'Login successful!',
        session: data.session,
        user: data.user
      });
    } catch (err) {
      logger.error('Login error', err);
      res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
    }
  }
);

/**
 * REFRESH TOKEN - Uses Supabase for memory efficiency
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      logger.error('Token refresh failed', error);
      return res.status(401).json({
        success: false,
        message: 'Token refresh failed due to invalid token',
        error: error.message
      });
    }

    if (!data.session) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token. No session returned.'
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
        logger.error('Password reset failed', { email, error: error.message });
      }
    } catch (err) {
      logger.error('Forgot password endpoint failed', err);
      res.status(500).json({ success: false, message: 'Server error.' });
    }
  }
);

// ==================================================================
// == START: NEWLY ADDED ENDPOINT
// ==================================================================
/**
 * GET CURRENT USER (ME) - Protected Route
 * Verifies the token and returns the current user's data.
 * This is essential for the frontend to restore sessions on page load.
 */
router.get('/me', hybridProtect, async (req, res) => {
  // The hybridProtect middleware has already verified the token
  // and attached the user object to req.user.
  if (!req.user) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  logger.info('Fetched current user data', { userId: req.user._id, authMethod: req.user.authMethod });

  res.status(200).json({
    success: true,
    user: req.user
  });
});
// ==================================================================
// == END: NEWLY ADDED ENDPOINT
// ==================================================================


/**
 * LOGOUT - Logs out of Supabase
 */
router.post('/logout', async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      logger.error('Supabase logout failed', error);
      return res.status(500).json({ success: false, message: 'Failed to log out.' });
    }
    res.json({ success: true, message: 'Successfully logged out.' });
  } catch (err) {
    logger.error('Logout failed', err);
    res.status(500).json({ success: false, message: 'Server error during logout.' });
  }
});

module.exports = router;