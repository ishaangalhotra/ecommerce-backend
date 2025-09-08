const express = require('express');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const { body, validationResult } = require('express-validator');
const router = express.Router();

/**
 * Enhanced login route with rate limit bypass for development/testing
 * This should be removed in production
 */
router.post('/enhanced-login', [
  body('identifier')
    .notEmpty()
    .withMessage('Email or phone number required')
    .custom((value) => {
      // Enhanced phone number validation
      if (validator.isEmail(value)) {
        return true;
      }
      
      // More flexible phone number validation
      const cleanPhone = value.replace(/[\s\-\(\)]/g, '');
      
      // Accept multiple phone formats:
      // +919876543220, 919876543220, 9876543220
      if (/^(\+91|91)?[6789]\d{9}$/.test(cleanPhone)) {
        return true;
      }
      
      throw new Error('Please provide a valid email address or Indian phone number');
    }),
  body('password').notEmpty().withMessage('Password required'),
  body('remember').optional().isBoolean()
], async (req, res) => {
  try {
    console.log('🚀 Enhanced login attempt:', {
      identifier: req.body.identifier,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({ 
        success: false, 
        errors: errors.array(),
        message: 'Validation failed'
      });
    }

    const { identifier, password, remember = false } = req.body;

    // Enhanced phone number normalization
    let searchQuery;
    if (validator.isEmail(identifier)) {
      searchQuery = { email: identifier.toLowerCase() };
      console.log('🔍 Searching by email:', identifier.toLowerCase());
    } else {
      // Normalize phone number for database search
      let normalizedPhone = identifier.replace(/[\s\-\(\)]/g, '');
      
      // Add +91 prefix if missing
      if (/^[6789]\d{9}$/.test(normalizedPhone)) {
        normalizedPhone = '+91' + normalizedPhone;
      } else if (/^91[6789]\d{9}$/.test(normalizedPhone)) {
        normalizedPhone = '+' + normalizedPhone;
      }
      
      // Try multiple phone formats in database
      searchQuery = {
        $or: [
          { phone: identifier },
          { phone: normalizedPhone },
          { phone: normalizedPhone.replace('+91', '91') },
          { phone: normalizedPhone.replace('+91', '') }
        ]
      };
      console.log('🔍 Searching by phone with multiple formats:', normalizedPhone);
    }

    const user = await User.findOne({
      ...searchQuery,
      isActive: true
    }).select('+password +loginAttempts +lockUntil');

    console.log('👤 User found:', {
      found: !!user,
      name: user?.name,
      email: user?.email,
      phone: user?.phone,
      isActive: user?.isActive,
      isVerified: user?.isVerified,
      role: user?.role,
      hasPassword: !!user?.password
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found with this email/phone number',
        debug: {
          searchedIdentifier: identifier,
          normalizedSearch: validator.isEmail(identifier) ? identifier.toLowerCase() : 'phone_normalized'
        }
      });
    }

    // Check password
    const passwordMatch = await user.correctPassword(password, user.password);
    console.log('🔐 Password verification:', { match: passwordMatch });

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Skip account lock check for enhanced route (development only)
    console.log('⚠️  Bypassing account lock check for enhanced login');

    // Check verification status (only for customers)
    if (!user.isVerified && user.role === 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in',
        needsVerification: true
      });
    }

    // Reset any existing login attempts and locks
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const accessToken = jwt.sign(
      { id: user._id, tokenVersion: user.tokenVersion || 0 },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: user._id, tokenVersion: user.tokenVersion || 0 },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: remember ? '30d' : '7d' }
    );

    // Response data (exclude sensitive fields)
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isVerified: user.isVerified,
      walletBalance: user.walletBalance,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    };

    console.log('✅ Enhanced login successful:', {
      userId: user._id,
      name: user.name,
      role: user.role,
      loginMethod: validator.isEmail(identifier) ? 'email' : 'phone'
    });

    res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      user: userData,
      message: 'Enhanced login successful (Rate limits bypassed)',
      loginMethod: validator.isEmail(identifier) ? 'email' : 'phone'
    });

  } catch (error) {
    console.error('❌ Enhanced login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during enhanced login',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Login failed'
    });
  }
});

/**
 * Test phone number validation endpoint
 */
router.post('/test-phone-validation', (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number required'
      });
    }

    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    let normalizedPhone = cleanPhone;
    
    // Add +91 prefix if missing
    if (/^[6789]\d{9}$/.test(cleanPhone)) {
      normalizedPhone = '+91' + cleanPhone;
    } else if (/^91[6789]\d{9}$/.test(cleanPhone)) {
      normalizedPhone = '+' + cleanPhone;
    }

    const isValid = /^(\+91|91)?[6789]\d{9}$/.test(cleanPhone);

    res.json({
      success: true,
      input: phone,
      cleaned: cleanPhone,
      normalized: normalizedPhone,
      isValid,
      formats: {
        original: phone,
        withCountryCode: normalizedPhone,
        withoutCountryCode: normalizedPhone.replace('+91', ''),
        with91: normalizedPhone.replace('+91', '91')
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Phone validation error',
      error: error.message
    });
  }
});

module.exports = router;
