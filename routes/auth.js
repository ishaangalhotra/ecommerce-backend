const { loginLimiter } = require('../middleware/rateLimiters');
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const geoip = require('geoip-lite');
const { body, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');

// CREATE THE ROUTER
const router = express.Router();

// Models & utilities
const User = require('../models/User');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');
const { protect, authLimiter } = require('../middleware/authMiddleware');

// Import validateActiveSession separately with fallback
let validateActiveSession;
try {
  const authMiddleware = require('../middleware/authMiddleware');
  validateActiveSession = authMiddleware.validateActiveSession || ((req, res, next) => next());
} catch (err) {
  // Fallback middleware if validateActiveSession doesn't exist
  validateActiveSession = (req, res, next) => next();
}

/* =========================================================
   UTILITY FUNCTIONS
   ========================================================= */

// Enhanced token response with better UX and security
const sendEnhancedTokenResponse = async (user, statusCode, res, remember = false, additionalData = {}) => {
  try {
    // Generate tokens
    const accessToken = jwt.sign(
      { id: user._id, tokenVersion: user.tokenVersion || 0 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
    );

    const refreshToken = jwt.sign(
      { id: user._id, tokenVersion: user.tokenVersion || 0 },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: remember ? '30d' : '7d' }
    );

    // Save refresh token to user
    user.refreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    // Update login history
    if (!user.loginHistory) user.loginHistory = [];
    user.loginHistory.push({
      timestamp: new Date(),
      ip: res.req.ip,
      userAgent: res.req.get('User-Agent'),
      location: geoip.lookup(res.req.ip)?.city || 'Unknown'
    });
    
    // Keep only last 10 login records
    if (user.loginHistory.length > 10) {
      user.loginHistory = user.loginHistory.slice(-10);
    }
    
    user.lastLogin = new Date();
    await user.save();

    // Set secure cookies
    const cookieOptions = {
      expires: new Date(Date.now() + (remember ? 30 : 7) * 24 * 60 * 60 * 1000),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    };

    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      expires: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });
    
    res.cookie('refreshToken', refreshToken, cookieOptions);

    // Response data (exclude sensitive fields)
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
      walletBalance: user.walletBalance,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    };

    res.status(statusCode).json({
      success: true,
      accessToken,
      user: userData,
      ...additionalData
    });

  } catch (error) {
    logger.error('Enhanced token response error', error);
    throw error;
  }
};

/* =========================================================
   1. REGISTER
   ========================================================= */
router.post(
  '/register',
  //authLimiter, // Kept commented out for development testing
  [
    body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    // UPDATED: Simplified password validation
    body('password')
      .isLength({ min: 6, max: 128 })
      .withMessage('Password must be at least 6 characters'),
    // UPDATED: Allow 'vendor' from frontend
    body('role').isIn(['customer', 'seller', 'vendor']).withMessage('Role must be customer, seller, or vendor'),
    body('phone').optional().isMobilePhone('en-IN').withMessage('Enter a valid phone number')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, email, password, phone } = req.body;

      // UPDATED: Map 'vendor' to 'seller' for database consistency
      const userRole = req.body.role === 'vendor' ? 'seller' : req.body.role;

      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email'
        });
      }

      // Create new user with the corrected role
      const user = new User({
        name: name.trim(),
        email: email.toLowerCase(),
        password,
        role: userRole,
        phone: phone || undefined,
        walletBalance: userRole === 'customer' ? 0 : undefined
      });

      // Generate email verification token
      const rawToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

      await user.save();

      // Send verification email
      try {
        await sendEmail({
          email: user.email,
          subject: 'Verify Your Email - QuickLocal',
          template: 'verify-email',
          data: {
            name: user.name,
            verificationUrl: `${process.env.CLIENT_URL}/verify-email/${rawToken}`
          }
        });

        logger.info(`User registered: ${user.email}`, { 
          userId: user._id, 
          role: user.role, 
          ip: req.ip 
        });

        res.status(201).json({
          success: true,
          message: 'Registration successful! Please check your email to verify your account.',
          userId: user._id
        });

      } catch (emailError) {
        logger.error('Registration email failed', emailError);
        await User.findByIdAndDelete(user._id); // Cleanup on email failure
        
        return res.status(500).json({
          success: false,
          message: 'Registration failed - could not send verification email'
        });
      }

    } catch (err) {
      logger.error('Registration error', err);
      
      if (err.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email'
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Registration failed'
      });
    }
  }
);

/* =========================================================
   2. LOGIN
   ========================================================= */
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
    body('remember').optional().isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { email, password, remember = false } = req.body;

      // Find user and include password for verification
      const user = await User.findOne({ 
        email: email.toLowerCase(),
        isActive: true 
      }).select('+password +loginAttempts +lockUntil');

      if (!user || !(await user.correctPassword(password, user.password))) {
        // Handle failed login attempts
        if (user) {
          user.loginAttempts = (user.loginAttempts || 0) + 1;
          
          if (user.loginAttempts >= 5) {
            user.lockUntil = Date.now() + 15 * 60 * 1000; // 15 minutes
            await user.save();
            
            logger.warn(`Account locked due to failed attempts: ${user.email}`, {
              userId: user._id,
              attempts: user.loginAttempts,
              ip: req.ip
            });
          } else {
            await user.save();
          }
        }

        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Check if account is locked
      if (user.lockUntil && user.lockUntil > Date.now()) {
        const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 60000);
        return res.status(423).json({
          success: false,
          message: `Account locked. Try again in ${remainingTime} minutes.`
        });
      }

      // Check if email is verified
      if (!user.isVerified) {
        return res.status(403).json({
          success: false,
          message: 'Please verify your email before logging in',
          needsVerification: true
        });
      }

      // Reset login attempts on successful login
      if (user.loginAttempts > 0) {
        user.loginAttempts = 0;
        user.lockUntil = undefined;
      }

      logger.info(`User logged in: ${user.email}`, { 
        userId: user._id, 
        ip: req.ip,
        remember 
      });

      // Send enhanced token response
      await sendEnhancedTokenResponse(user, 200, res, remember, {
        message: 'Login successful'
      });

    } catch (err) {
      logger.error('Login error', err);
      res.status(500).json({
        success: false,
        message: 'Login failed'
      });
    }
  }
);

/* =========================================================
   3. LOGOUT
   ========================================================= */
router.post('/logout', protect, async (req, res) => {
  try {
    // Clear refresh token from database
    const user = await User.findById(req.user.id);
    if (user) {
      user.refreshToken = undefined;
      await user.save();
    }

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    logger.info(`User logged out: ${req.user.email}`, { 
      userId: req.user.id, 
      ip: req.ip 
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (err) {
    logger.error('Logout error', err);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

/* =========================================================
   4. FORGOT-PASSWORD
   ========================================================= */
router.post(
  '/forgot-password',
  authLimiter,
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const user = await User.findOne({ email: req.body.email.toLowerCase() });
      
      if (!user) {
        return res.json({ 
          success: true, 
          message: 'If an account with that email exists, a password reset link has been sent.' 
        });
      }

      // Generate reset token
      const rawToken = crypto.randomBytes(32).toString('hex');
      user.passwordResetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
      await user.save();

      try {
        await sendEmail({
          email: user.email,
          subject: 'Password Reset Request - QuickLocal',
          template: 'password-reset',
          data: {
            name: user.name,
            resetUrl: `${process.env.CLIENT_URL}/reset-password/${rawToken}`,
            expiresIn: '10 minutes'
          }
        });

        logger.info(`Password reset requested for ${user.email}`, { 
          userId: user._id, 
          ip: req.ip 
        });

      } catch (emailError) {
        logger.error('Password reset email failed', emailError);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();
        
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to send reset email' 
        });
      }

      res.json({ 
        success: true, 
        message: 'Password reset link sent to your email' 
      });

    } catch (err) {
      logger.error('Forgot password error', err);
      res.status(500).json({ success: false, message: 'Password reset request failed' });
    }
  }
);

/* =========================================================
   5. VERIFY-EMAIL
   ========================================================= */
router.post('/verify-email/:token', async (req, res) => {
  try {
    const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashed,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or expired verification token' 
      });
    }

    user.isVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    user.verifiedAt = new Date();

    // Welcome bonus for customers
    if (user.role === 'customer') {
      user.walletBalance = (user.walletBalance || 0) + 50;
    }

    await user.save();

    logger.info(`Email verified for ${user.email}`, { userId: user._id, ip: req.ip });

    // Send welcome email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Welcome to QuickLocal! 🎉',
        template: 'welcome',
        data: {
          name: user.name,
          dashboardUrl: `${process.env.CLIENT_URL}/dashboard`,
          welcomeBonus: user.role === 'customer' ? 50 : null
        }
      });
    } catch (emailError) {
      logger.error('Welcome email failed', emailError);
    }

    // Use enhanced token response for better UX
    await sendEnhancedTokenResponse(user, 200, res, false, { 
      message: 'Email verified successfully!' 
    });
    
  } catch (err) {
    logger.error('Email verification error', err);
    res.status(500).json({ success: false, message: 'Email verification failed' });
  }
});

/* =========================================================
   6. RESEND-VERIFICATION-EMAIL
   ========================================================= */
router.post(
  '/resend-verification',
  authLimiter,
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const user = await User.findOne({ email: req.body.email.toLowerCase() });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      
      if (user.isVerified) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email is already verified' 
        });
      }

      // Generate & save new token
      const rawToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
      await user.save();

      // Send email
      await sendEmail({
        email: user.email,
        subject: 'Verify Your Email - QuickLocal',
        template: 'verify-email',
        data: {
          name: user.name,
          verificationUrl: `${process.env.CLIENT_URL}/verify-email/${rawToken}`
        }
      });

      res.json({ success: true, message: 'Verification email sent' });
      
    } catch (err) {
      logger.error('Resend verification error', err);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to resend verification email' 
      });
    }
  }
);

/* =========================================================
   7. RESET-PASSWORD
   ========================================================= */
router.post(
  '/reset-password/:token',
  [
    body('password')
      .isLength({ min: 6, max: 128 })
      .withMessage('Password must be 6-128 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
      .withMessage('Password must contain upper, lower, number & special char'),
    body('confirmPassword').custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Passwords do not match');
      return true;
    })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
      const user = await User.findOne({
        passwordResetToken: hashed,
        passwordResetExpires: { $gt: Date.now() }
      });
      
      if (!user) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid or expired reset token' 
        });
      }

      // Update password and invalidate all sessions
      user.password = req.body.password;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      user.passwordChangedAt = new Date();
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      user.refreshToken = undefined; // Clear refresh token
      user.tokenVersion = (user.tokenVersion || 0) + 1; // Invalidate all tokens
      await user.save();

      logger.info(`Password reset for ${user.email}`, { userId: user._id, ip: req.ip });

      // Send confirmation email
      try {
        await sendEmail({
          email: user.email,
          subject: 'Password Reset Successful',
          template: 'password-reset-success',
          data: {
            name: user.name,
            resetTime: new Date(),
            ip: req.ip,
            location: geoip.lookup(req.ip)?.city || 'Unknown'
          }
        });
      } catch (emailError) {
        logger.error('Password-reset confirmation email failed', emailError);
      }

      // Use enhanced token response for immediate login
      await sendEnhancedTokenResponse(user, 200, res, false, { 
        message: 'Password reset successful' 
      });
      
    } catch (err) {
      logger.error('Password reset error', err);
      res.status(500).json({ success: false, message: 'Password reset failed' });
    }
  }
);

/* =========================================================
   8. GET /me
   ========================================================= */
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -passwordResetToken -emailVerificationToken -refreshToken')
      .populate('addresses', 'street city state pincode isDefault');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if user is still active
    if (!user.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account has been deactivated' 
      });
    }

    res.json({
      success: true,
      user: {
        ...user.toObject(),
        loginHistory: user.loginHistory ? user.loginHistory.slice(-5) : []
      }
    });
    
  } catch (err) {
    logger.error('Get profile error', err);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

/* =========================================================
   9. PATCH /update-profile
   ========================================================= */
router.patch(
  '/update-profile',
  protect,
  [
    body('name').optional().trim().isLength({ min: 2, max: 50 })
      .withMessage('Name must be 2-50 characters'),
    body('phone').optional().isMobilePhone('en-IN')
      .withMessage('Enter a valid phone number'),
    body('dateOfBirth').optional().isISO8601().toDate()
      .withMessage('Enter a valid date'),
    body('gender').optional().isIn(['male', 'female', 'other'])
      .withMessage('Gender must be male, female, or other')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const allowed = ['name', 'phone', 'dateOfBirth', 'gender'];
      const updates = {};
      Object.keys(req.body).forEach(k => { 
        if (allowed.includes(k) && req.body[k] !== undefined) {
          updates[k] = req.body[k];
        }
      });

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid fields to update'
        });
      }

      const user = await User.findByIdAndUpdate(req.user.id, updates, {
        new: true,
        runValidators: true
      }).select('-password -refreshToken');

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      logger.info(`Profile updated for ${user.email}`, { 
        userId: user._id, 
        updates: Object.keys(updates) 
      });

      res.json({ 
        success: true, 
        message: 'Profile updated successfully', 
        user 
      });
      
    } catch (err) {
      logger.error('Profile update error', err);
      res.status(500).json({ success: false, message: 'Profile update failed' });
    }
  }
);

/* =========================================================
   10. DELETE /delete-account
   ========================================================= */
router.delete(
  '/delete-account',
  protect,
  // Use validateActiveSession only if it exists, otherwise skip
  (req, res, next) => {
    if (typeof validateActiveSession === 'function') {
      return validateActiveSession(req, res, next);
    }
    next();
  },
  [body('password').notEmpty().withMessage('Password required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const user = await User.findById(req.user.id).select('+password');
      
      if (!(await user.correctPassword(req.body.password, user.password))) {
        return res.status(400).json({ 
          success: false, 
          message: 'Incorrect password' 
        });
      }

      // Soft delete with session cleanup
      user.isActive = false;
      user.deletedAt = new Date();
      user.email = `deleted_${Date.now()}_${user.email}`;
      user.refreshToken = undefined;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save();

      logger.info(`Account deleted for ${req.user.email}`, { 
        userId: user._id, 
        ip: req.ip 
      });

      // Send confirmation email to original email
      try {
        await sendEmail({
          email: req.user.email, // Use original email from token
          subject: 'Account Deleted – We\'ll miss you!',
          template: 'account-deleted',
          data: {
            name: user.name,
            reactivationUrl: `${process.env.CLIENT_URL}/reactivate`
          }
        });
      } catch (emailError) {
        logger.error('Deletion email failed', emailError);
      }

      // Clear all cookies
      res.clearCookie('token');
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');

      res.json({ success: true, message: 'Account deleted successfully' });
      
    } catch (err) {
      logger.error('Account deletion error', err);
      res.status(500).json({ success: false, message: 'Account deletion failed' });
    }
  }
);

/* =========================================================
   11. CHANGE-PASSWORD
   ========================================================= */
router.patch(
  '/change-password',
  protect,
  // Use validateActiveSession only if it exists, otherwise skip
  (req, res, next) => {
    if (typeof validateActiveSession === 'function') {
      return validateActiveSession(req, res, next);
    }
    next();
  },
  [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword')
      .isLength({ min: 6, max: 128 })
      .withMessage('Password must be 6-128 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
      .withMessage('Password must contain upper, lower, number & special char'),
    body('confirmPassword').custom((val, { req }) => {
      if (val !== req.body.newPassword) throw new Error('Passwords do not match');
      return true;
    })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const user = await User.findById(req.user.id).select('+password');
      
      // Verify current password
      if (!(await user.correctPassword(req.body.currentPassword, user.password))) {
        return res.status(400).json({ 
          success: false, 
          message: 'Current password is incorrect' 
        });
      }

      // Update password and invalidate other sessions
      user.password = req.body.newPassword;
      user.passwordChangedAt = new Date();
      user.refreshToken = undefined; // Clear current refresh token
      user.tokenVersion = (user.tokenVersion || 0) + 1; // Invalidate all other tokens
      await user.save();

      logger.info(`Password changed for ${user.email}`, { 
        userId: user._id, 
        ip: req.ip 
      });

      // Send notification email
      try {
        await sendEmail({
          email: user.email,
          subject: 'Password Changed Successfully',
          template: 'password-changed',
          data: {
            name: user.name,
            changeTime: new Date(),
            ip: req.ip,
            location: geoip.lookup(req.ip)?.city || 'Unknown'
          }
        });
      } catch (emailError) {
        logger.error('Password change notification email failed', emailError);
      }

      // Clear cookies so user needs to login again
      res.clearCookie('token');
      res.clearCookie('accessToken'); 
      res.clearCookie('refreshToken');

      res.json({ 
        success: true, 
        message: 'Password changed successfully. Please login again.' 
      });
      
    } catch (err) {
      logger.error('Change password error', err);
      res.status(500).json({ success: false, message: 'Password change failed' });
    }
  }
);

/* =========================================================
   12. REFRESH TOKEN
   ========================================================= */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    
    if (!refreshToken) {
      return res.status(401).json({ 
        success: false, 
        message: 'No refresh token provided' 
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    // Find user and verify refresh token
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const user = await User.findOne({ 
      _id: decoded.id,
      refreshToken: hashedToken,
      isActive: true
    });

    if (!user || (user.tokenVersion || 0) !== decoded.tokenVersion) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid refresh token' 
      });
    }

    // Generate new access token
    const newAccessToken = jwt.sign(
      { id: user._id, tokenVersion: user.tokenVersion || 0 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
    );

    // Set new access token cookie
    res.cookie('accessToken', newAccessToken, {
      expires: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    res.json({
      success: true,
      accessToken: newAccessToken,
      message: 'Token refreshed successfully'
    });

  } catch (err) {
    logger.error('Token refresh error', err);
    
    // Clear invalid refresh token
    res.clearCookie('refreshToken');
    
    res.status(401).json({ 
      success: false, 
      message: 'Token refresh failed' 
    });
  }
});

/* =========================================================
   13. LOGOUT ALL SESSIONS
   ========================================================= */
router.post('/logout-all', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (user) {
      // Increment token version to invalidate all tokens
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      user.refreshToken = undefined;
      await user.save();
    }

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    logger.info(`All sessions logged out for ${req.user.email}`, { 
      userId: req.user.id, 
      ip: req.ip 
    });

    res.json({
      success: true,
      message: 'Logged out from all devices successfully'
    });

  } catch (err) {
    logger.error('Logout all sessions error', err);
    res.status(500).json({
      success: false,
      message: 'Failed to logout from all sessions'
    });
  }
});

// Export the router
module.exports = router;