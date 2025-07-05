const express = require('express');
const passport = require('passport');
const router = express.Router();
const { 
  generateTokens, 
  sendTokenResponse,
  hashToken
} = require('../utils/auth');
const User = require('../models/User');
const logger = require('../utils/logger');
const validator = require('validator');
const crypto = require('crypto');

// Google OAuth
router.get('/google', 
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false 
  })
);

router.get('/google/callback', 
  passport.authenticate('google', { 
    failureRedirect: '/login',
    session: false 
  }),
  async (req, res) => {
    try {
      // Update or create user
      const user = await User.findOneAndUpdate(
        { email: req.user.email },
        { 
          googleId: req.user.googleId,
          isVerified: true 
        },
        { new: true, upsert: true }
      );
      
      sendTokenResponse(user, 200, res);
    } catch (err) {
      logger.error('Google OAuth error:', err);
      res.status(500).json({ error: 'Authentication failed' });
    }
  }
);

// Local registration
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }
    
    const user = await User.create({ name, email, password });
    
    // In a real app, you would send verification email here
    
    sendTokenResponse(user, 201, res);
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Local login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.correctPassword(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    sendTokenResponse(user, 200, res);
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }
    
    const decoded = await verifyToken(refreshToken, true);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    const { accessToken } = generateTokens(user._id);
    
    res.status(200).json({
      status: 'success',
      accessToken
    });
  } catch (err) {
    logger.error('Refresh token error:', err);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.status(200).json({ status: 'success' });
});

// Password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });
    
    // In a real app, you would send the resetToken via email
    console.log(`Password reset token: ${resetToken}`);
    
    res.status(200).json({
      status: 'success',
      message: 'Token sent to email'
    });
  } catch (err) {
    logger.error('Forgot password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

router.patch('/reset-password/:token', async (req, res) => {
  try {
    const hashedToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');
    
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Token is invalid or has expired' });
    }
    
    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    
    sendTokenResponse(user, 200, res);
  } catch (err) {
    logger.error('Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;