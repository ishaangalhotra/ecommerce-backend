/* routes/auth.js */

const express = require('express');
const crypto = require('crypto');
const geoip = require('geoip-lite');
const { body, validationResult } = require('express-validator');

const router = express.Router();

/* Models & utilities */
const User = require('../models/User');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/email');

const { protect, authLimiter } = require('../middleware/authMiddleware');

/* --------------------------------------------------------- */
/* helper: sign-in user and send JWT cookie                  */
/* --------------------------------------------------------- */
const sendTokenResponse = (user, statusCode, res, extra = {}) => {
  const token = user.getSignedJwtToken();

  res
    .status(statusCode)
    .cookie('token', token, {
      expires: new Date(
        Date.now() + Number(process.env.JWT_COOKIE_EXPIRE) * 24 * 60 * 60 * 1000
      ),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    })
    .json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        walletBalance: user.walletBalance
      },
      ...extra
    });
};

/* =========================================================
   1.  REGISTER
   ========================================================= */
router.post(
  '/register',
  authLimiter,
  [
    body('name')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Name must be 2-50 characters')
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Name can only contain letters and spaces'),
    
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email'),
    
    body('password')
      .isLength({ min: 12, max: 128 })
      .withMessage('Password must be 12-128 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
      .withMessage('Password must contain upper, lower, number & special char'),
    
    body('confirmPassword').custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Passwords do not match');
      return true;
    }),
    
    body('role')
      .optional()
      .isIn(['customer', 'seller'])
      .withMessage('Role must be customer or seller'),
    
    body('phone')
      .optional()
      .isMobilePhone('en-IN')
      .withMessage('Please provide a valid Indian phone number')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, email, password, role = 'customer', phone } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          message: 'User with this email already exists' 
        });
      }

      // Create user
      const userData = {
        name: name.trim(),
        email: email.toLowerCase(),
        password,
        role,
        phone
      };

      const user = await User.create(userData);

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
      } catch (emailError) {
        logger.error('Registration email failed', emailError);
        // Don't fail registration if email fails
      }

      logger.info(`New user registered: ${user.email}`, { 
        userId: user._id, 
        role: user.role, 
        ip: req.ip 
      });

      res.status(201).json({
        success: true,
        message: 'Registration successful! Please check your email to verify your account.',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isVerified: user.isVerified
        }
      });

    } catch (err) {
      logger.error('Registration error', err);
      res.status(500).json({ success: false, message: 'Registration failed' });
    }
  }
);

/* =========================================================
   2.  LOGIN
   ========================================================= */
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { email, password } = req.body;

      // Find user and include password for comparison
      const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
      
      if (!user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid email or password' 
        });
      }

      // Check if account is locked
      if (user.isLocked) {
        return res.status(423).json({ 
          success: false, 
          message: 'Account is temporarily locked due to too many failed attempts' 
        });
      }

      // Validate password
      const isPasswordValid = await user.correctPassword(password, user.password);
      
      if (!isPasswordValid) {
        // Increment failed login attempts
        await user.incLoginAttempts();
        
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid email or password' 
        });
      }

      // Check if user is active
      if (!user.isActive) {
        return res.status(403).json({ 
          success: false, 
          message: 'Account has been deactivated. Please contact support.' 
        });
      }

      // Reset login attempts on successful login
      if (user.loginAttempts > 0) {
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();
      }

      // Update login history
      const loginInfo = {
        timestamp: new Date(),
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        location: geoip.lookup(req.ip)?.city || 'Unknown'
      };

      user.loginHistory = user.loginHistory || [];
      user.loginHistory.push(loginInfo);
      
      // Keep only last 10 login records
      if (user.loginHistory.length > 10) {
        user.loginHistory = user.loginHistory.slice(-10);
      }

      user.lastLoginAt = new Date();
      await user.save();

      logger.info(`User logged in: ${user.email}`, { 
        userId: user._id, 
        ip: req.ip 
      });

      sendTokenResponse(user, 200, res, { message: 'Login successful' });

    } catch (err) {
      logger.error('Login error', err);
      res.status(500).json({ success: false, message: 'Login failed' });
    }
  }
);

/* =========================================================
   3.  LOGOUT
   ========================================================= */
router.post('/logout', async (req, res) => {
  try {
    res
      .status(200)
      .cookie('token', 'none', {
        expires: new Date(Date.now() + 10 * 1000), // 10 seconds
        httpOnly: true
      })
      .json({
        success: true,
        message: 'Logged out successfully'
      });
  } catch (err) {
    logger.error('Logout error', err);
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
});

/* =========================================================
   4.  FORGOT-PASSWORD
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
        // Return success even if user doesn't exist (security best practice)
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

      // Send reset email
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
   5.  VERIFY-EMAIL
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

    sendTokenResponse(user, 200, res, { message: 'Email verified successfully!' });
    
  } catch (err) {
    logger.error('Email verification error', err);
    res.status(500).json({ success: false, message: 'Email verification failed' });
  }
});

/* =========================================================
   6.  RESEND-VERIFICATION-EMAIL
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
   7.  RESET-PASSWORD
   ========================================================= */
router.post(
  '/reset-password/:token',
  [
    body('password')
      .isLength({ min: 12, max: 128 })
      .withMessage('Password must be 12-128 characters')
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

      // Update password
      user.password = req.body.password;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      user.passwordChangedAt = new Date();
      user.loginAttempts = 0;
      user.lockUntil = undefined;
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

      sendTokenResponse(user, 200, res, { message: 'Password reset successful' });
      
    } catch (err) {
      logger.error('Password reset error', err);
      res.status(500).json({ success: false, message: 'Password reset failed' });
    }
  }
);

/* =========================================================
   8.  GET /me
   ========================================================= */
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -passwordResetToken -emailVerificationToken')
      .populate('addresses', 'street city state pincode isDefault');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
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
   9.  PATCH /update-profile
   ========================================================= */
router.patch(
  '/update-profile',
  protect,
  [
    body('name').optional().trim().isLength({ min: 2, max: 50 })
      .withMessage('Name must be 2-50 characters'),
    body('phone').optional().isMobilePhone('en-IN')
      .withMessage('Enter a valid phone number')
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
        if (allowed.includes(k)) updates[k] = req.body[k]; 
      });

      const user = await User.findByIdAndUpdate(req.user.id, updates, {
        new: true,
        runValidators: true
      }).select('-password');

      logger.info(`Profile updated for ${user.email}`, { 
        userId: user._id, 
        updates: Object.keys(updates) 
      });

      res.json({ success: true, message: 'Profile updated', user });
      
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

      // Soft delete
      user.isActive = false;
      user.deletedAt = new Date();
      user.email = `deleted_${Date.now()}_${user.email}`;
      await user.save();

      logger.info(`Account deleted for ${req.user.email}`, { 
        userId: user._id, 
        ip: req.ip 
      });

      // Send confirmation email
      try {
        await sendEmail({
          email: req.user.email,
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
  [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword')
      .isLength({ min: 12, max: 128 })
      .withMessage('Password must be 12-128 characters')
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

      // Update password
      user.password = req.body.newPassword;
      user.passwordChangedAt = new Date();
      await user.save();

      logger.info(`Password changed for ${user.email}`, { userId: user._id, ip: req.ip });

      res.json({ success: true, message: 'Password changed successfully' });
      
    } catch (err) {
      logger.error('Change password error', err);
      res.status(500).json({ success: false, message: 'Password change failed' });
    }
  }
);

/* ========================================================= */
module.exports = router;