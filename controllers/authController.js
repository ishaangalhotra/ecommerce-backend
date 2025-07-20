const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');
const { validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { createAuditLog } = require('../services/auditService');
const { generateTokens, verifyToken } = require('../services/tokenService');
const { isPasswordStrong } = require('../utils/validators');

// Constants
const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = '15m'; // Short-lived access token
const REFRESH_EXPIRES_IN = '7d'; // Long-lived refresh token
const EMAIL_VERIFICATION_EXPIRES_IN = '1d';
const PASSWORD_RESET_EXPIRES_IN = '1h';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MINUTES = 15;

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  standardHeaders: true,
  skipSuccessfulRequests: true, // Only count failed requests
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.'
    });
  }
});

/**
 * @desc    Register new user
 * @route   POST /api/auth/register
 * @access  Public
 */
exports.register = async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map(err => ({
          param: err.param,
          message: err.msg
        }))
      });
    }

    const { fullName, email, phone, password, accountType } = req.body;

    // Check password strength
    if (!isPasswordStrong(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters with uppercase, lowercase, number and special character'
      });
    }

    // Check existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const user = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      role: accountType || 'user',
      emailVerified: false,
      loginAttempts: 0,
      accountStatus: 'pending_verification'
    });

    // Generate email verification token
    const emailToken = generateTokens(
      { id: user._id, email: user.email },
      EMAIL_VERIFICATION_EXPIRES_IN
    );

    // Send verification email
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailToken.accessToken}`;
    await sendEmail({
      to: user.email,
      subject: 'Verify your email - QuickLocal',
      template: 'email-verification',
      context: {
        name: user.fullName,
        verifyUrl,
        supportEmail: process.env.SUPPORT_EMAIL
      }
    });

    // Audit log
    await createAuditLog({
      action: 'user_registered',
      userId: user._id,
      metadata: { ip: req.ip, userAgent: req.headers['user-agent'] }
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.'
    });
  } catch (err) {
    logger.error('Registration error', {
      error: err.message,
      stack: err.stack,
      body: req.body
    });
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again later.'
    });
  }
};

/**
 * @desc    Verify user email
 * @route   GET /api/auth/verify-email
 * @access  Public
 */
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    // Verify token
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification link'
      });
    }

    // Find user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (user.emailVerified) {
      return res.status(200).json({
        success: true,
        message: 'Email already verified'
      });
    }

    // Update user
    user.emailVerified = true;
    user.accountStatus = 'active';
    user.emailVerifiedAt = new Date();
    await user.save();

    // Audit log
    await createAuditLog({
      action: 'email_verified',
      userId: user._id
    });

    res.status(200).json({
      success: true,
      message: 'Email verified successfully!'
    });
  } catch (err) {
    logger.error('Email verification error', {
      error: err.message,
      token: req.query.token
    });
    res.status(400).json({
      success: false,
      message: 'Email verification failed. Please request a new verification link.'
    });
  }
};

/**
 * @desc    Authenticate user and get tokens
 * @route   POST /api/auth/login
 * @access  Public
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check account status
    if (user.accountStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Account suspended. Please contact support.'
      });
    }

    // Check if email is verified (if required)
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in.'
      });
    }

    // Check login attempts
    if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      const timeElapsed = (Date.now() - user.lastLoginAttempt) / (1000 * 60);
      if (timeElapsed < LOGIN_WINDOW_MINUTES) {
        return res.status(429).json({
          success: false,
          message: `Too many login attempts. Try again in ${Math.ceil(LOGIN_WINDOW_MINUTES - timeElapsed)} minutes.`
        });
      } else {
        // Reset attempts if window has passed
        user.loginAttempts = 0;
      }
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // Increment failed attempts
      user.loginAttempts += 1;
      user.lastLoginAttempt = Date.now();
      await user.save();

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Reset login attempts on successful login
    user.loginAttempts = 0;
    user.lastLogin = Date.now();
    await user.save();

    // Generate tokens
    const tokens = generateTokens({
      id: user._id,
      email: user.email,
      role: user.role
    });

    // Set secure, HTTP-only cookies
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Audit log
    await createAuditLog({
      action: 'user_login',
      userId: user._id,
      metadata: { ip: req.ip, userAgent: req.headers['user-agent'] }
    });

    // Response with access token (refresh token is HTTP-only cookie)
    res.status(200).json({
      success: true,
      accessToken: tokens.accessToken,
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (err) {
    logger.error('Login error', {
      error: err.message,
      email: req.body.email
    });
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again later.'
    });
  }
};

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh-token
 * @access  Public (with valid refresh token)
 */
exports.refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token provided'
      });
    }

    // Verify refresh token
    const decoded = verifyToken(refreshToken);
    if (!decoded) {
      return res.status(403).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Check if user exists
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate new access token
    const accessToken = generateTokens({
      id: user._id,
      email: user.email,
      role: user.role
    }).accessToken;

    res.status(200).json({
      success: true,
      accessToken,
      expiresIn: JWT_EXPIRES_IN
    });
  } catch (err) {
    logger.error('Refresh token error', { error: err.message });
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
};

/**
 * @desc    Logout user (invalidate token)
 * @route   POST /api/auth/logout
 * @access  Private
 */
exports.logout = async (req, res) => {
  try {
    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    // Optional: Add token to blacklist if using token invalidation

    // Audit log
    await createAuditLog({
      action: 'user_logout',
      userId: req.user.id,
      metadata: { ip: req.ip }
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (err) {
    logger.error('Logout error', {
      error: err.message,
      userId: req.user?.id
    });
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

/**
 * @desc    Forgot password - send reset email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal whether email exists
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, SALT_ROUNDS);

    // Set token expiration (1 hour)
    user.resetToken = resetTokenHash;
    user.resetTokenExpires = Date.now() + 60 * 60 * 1000;
    await user.save();

    // Create JWT for reset link
    const resetJwt = generateTokens(
      { id: user._id, token: resetToken },
      PASSWORD_RESET_EXPIRES_IN
    ).accessToken;

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetJwt}`;
    await sendEmail({
      to: user.email,
      subject: 'Reset your QuickLocal password',
      template: 'password-reset',
      context: {
        name: user.fullName,
        resetUrl,
        supportEmail: process.env.SUPPORT_EMAIL
      }
    });

    // Audit log
    await createAuditLog({
      action: 'password_reset_requested',
      userId: user._id,
      metadata: { ip: req.ip }
    });

    res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent.'
    });
  } catch (err) {
    logger.error('Forgot password error', {
      error: err.message,
      email: req.body.email
    });
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
};

/**
 * @desc    Reset password
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Verify token
    const decoded = verifyToken(token);
    if (!decoded || !decoded.token) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Find user
    const user = await User.findOne({
      _id: decoded.id,
      resetTokenExpires: { $gt: Date.now() }
    });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Verify reset token
    const isTokenValid = await bcrypt.compare(decoded.token, user.resetToken);
    if (!isTokenValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Check password strength
    if (!isPasswordStrong(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters with uppercase, lowercase, number and special character'
      });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    user.password = hashedPassword;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    user.loginAttempts = 0; // Reset login attempts
    await user.save();

    // Invalidate all sessions (if implementing session management)
    // await invalidateUserSessions(user._id);

    // Send confirmation email
    await sendEmail({
      to: user.email,
      subject: 'Your password has been reset',
      template: 'password-reset-confirmation',
      context: {
        name: user.fullName,
        supportEmail: process.env.SUPPORT_EMAIL
      }
    });

    // Audit log
    await createAuditLog({
      action: 'password_reset',
      userId: user._id,
      metadata: { ip: req.ip }
    });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });
  } catch (err) {
    logger.error('Reset password error', { error: err.message });
    res.status(500).json({
      success: false,
      message: 'Password reset failed. Please try again.'
    });
  }
};

/**
 * @desc    Get current authenticated user
 * @route   GET /api/auth/me
 * @access  Private
 */
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -resetToken -resetTokenExpires -loginAttempts');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (err) {
    logger.error('Get user error', {
      error: err.message,
      userId: req.user.id
    });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user data'
    });
  }
};