const express = require('express');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const router = express.Router();

/**
 * TEMPORARY TEST ROUTE - BYPASSES RATE LIMITING
 * This is for debugging the login issues
 * Remove this route in production
 */
router.post('/test-login', async (req, res) => {
  try {
    console.log('🧪 Test login attempt:', {
      identifier: req.body.identifier,
      hasPassword: !!req.body.password,
      body: req.body
    });

    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Identifier and password are required'
      });
    }

    // Find user by email or phone (same logic as main auth route)
    let user;
    if (identifier.includes('@')) {
      user = await User.findOne({ 
        email: identifier.toLowerCase(),
        isActive: true 
      }).select('+password +loginAttempts +lockUntil');
    } else {
      user = await User.findOne({ 
        phone: identifier,
        isActive: true 
      }).select('+password +loginAttempts +lockUntil');
    }

    console.log('🔍 User found:', {
      found: !!user,
      name: user?.name,
      email: user?.email,
      phone: user?.phone,
      isActive: user?.isActive,
      isVerified: user?.isVerified,
      loginAttempts: user?.loginAttempts,
      lockUntil: user?.lockUntil
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check password
    const passwordMatch = await user.correctPassword(password, user.password);
    console.log('🔐 Password check:', { match: passwordMatch });

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Check if account is locked (but bypass for test)
    if (user.lockUntil && user.lockUntil > Date.now()) {
      console.log('⚠️ Account locked until:', new Date(user.lockUntil));
      // For testing, we'll still allow login but warn
    }

    // Check verification status
    if (!user.isVerified && user.role === 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in',
        needsVerification: true
      });
    }

    // Reset login attempts
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
      { expiresIn: '7d' }
    );

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

    console.log('✅ Login successful for:', userData.name);

    res.status(200).json({
      success: true,
      accessToken,
      user: userData,
      message: 'Login successful (TEST ROUTE)'
    });

  } catch (error) {
    console.error('❌ Test login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
