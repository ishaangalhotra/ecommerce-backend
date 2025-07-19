// Add these additional routes to your existing auth.js file:

// Email verification endpoint
router.post('/verify-email/:token', async (req, res) => {
  try {
    const hashedToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    // Mark as verified
    user.isVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    user.verifiedAt = new Date();
    
    // Give welcome bonus for verified users
    if (user.role === 'customer') {
      user.walletBalance = (user.walletBalance || 0) + 50; // ₹50 welcome bonus
    }
    
    await user.save();

    logger.info(`Email verified for user: ${user.email}`, {
      userId: user._id,
      ip: req.ip
    });

    // Send welcome email
    sendEmail({
      email: user.email,
      subject: 'Welcome to QuickLocal! 🎉',
      template: 'welcome',
      data: {
        name: user.name,
        dashboardUrl: `${process.env.CLIENT_URL}/dashboard`,
        welcomeBonus: user.role === 'customer' ? 50 : null
      }
    }).catch(error => logger.error('Welcome email failed:', error));

    sendTokenResponse(user, 200, res, {
      message: 'Email verified successfully! Welcome to QuickLocal.'
    });

  } catch (error) {
    logger.error(`Email verification error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Email verification failed'
    });
  }
});

// Resend verification email
router.post('/resend-verification',
  authLimiter,
  [body('email').isEmail().withMessage('Valid email required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const user = await User.findOne({ email: req.body.email });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (user.isVerified) {
        return res.status(400).json({
          success: false,
          message: 'Email is already verified'
        });
      }

      // Generate new verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationToken = crypto
        .createHash('sha256')
        .update(verificationToken)
        .digest('hex');
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
      
      await user.save();

      await sendEmail({
        email: user.email,
        subject: 'Verify Your Email - QuickLocal',
        template: 'verify-email',
        data: {
          name: user.name,
          verificationUrl: `${process.env.CLIENT_URL}/verify-email/${verificationToken}`
        }
      });

      res.status(200).json({
        success: true,
        message: 'Verification email sent'
      });

    } catch (error) {
      logger.error(`Resend verification error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Failed to resend verification email'
      });
    }
  }
);

// Password reset endpoint
router.post('/reset-password/:token',
  [
    body('password')
      .isLength({ min: 12, max: 128 })
      .withMessage('Password must be between 12-128 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain uppercase, lowercase, number and special character'),
    body('confirmPassword')
      .custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('Password confirmation does not match');
        }
        return true;
      })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const hashedToken = crypto
        .createHash('sha256')
        .update(req.params.token)
        .digest('hex');

      const user = await User.findOne({
        passwordResetToken: hashedToken,
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

      logger.info(`Password reset completed for: ${user.email}`, {
        userId: user._id,
        ip: req.ip
      });

      // Send confirmation email
      sendEmail({
        email: user.email,
        subject: 'Password Reset Successful',
        template: 'password-reset-success',
        data: {
          name: user.name,
          resetTime: new Date(),
          ip: req.ip,
          location: geoip.lookup(req.ip)?.city || 'Unknown'
        }
      }).catch(error => logger.error('Password reset email failed:', error));

      sendTokenResponse(user, 200, res, {
        message: 'Password reset successful'
      });

    } catch (error) {
      logger.error(`Password reset error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Password reset failed'
      });
    }
  }
);

// Get user profile
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -passwordResetToken -emailVerificationToken')
      .populate('addresses', 'street city state pincode isDefault');

    res.status(200).json({
      success: true,
      user: {
        ...user.toObject(),
        loginHistory: user.loginHistory.slice(-5) // Only last 5 logins
      }
    });
  } catch (error) {
    logger.error(`Get profile error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
});

// Update user profile
router.patch('/update-profile', 
  protect,
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Name must be between 2-50 characters'),
    body('phone')
      .optional()
      .isMobilePhone('any')
      .withMessage('Please provide a valid phone number')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const allowedFields = ['name', 'phone', 'dateOfBirth', 'gender'];
      const updates = {};
      
      Object.keys(req.body).forEach(key => {
        if (allowedFields.includes(key)) {
          updates[key] = req.body[key];
        }
      });

      const user = await User.findByIdAndUpdate(
        req.user.id,
        updates,
        { new: true, runValidators: true }
      ).select('-password');

      logger.info(`Profile updated for user: ${user.email}`, {
        userId: user._id,
        updates: Object.keys(updates)
      });

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user
      });

    } catch (error) {
      logger.error(`Profile update error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Profile update failed'
      });
    }
  }
);

// Delete account
router.delete('/delete-account',
  protect,
  [body('password').notEmpty().withMessage('Password required for account deletion')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const user = await User.findById(req.user.id).select('+password');
      
      // Verify password
      if (!(await user.correctPassword(req.body.password, user.password))) {
        return res.status(400).json({
          success: false,
          message: 'Incorrect password'
        });
      }

      // Soft delete - mark as inactive instead of removing
      user.isActive = false;
      user.deletedAt = new Date();
      user.email = `deleted_${Date.now()}_${user.email}`;
      await user.save();

      logger.info(`Account deleted for user: ${req.user.email}`, {
        userId: user._id,
        ip: req.ip
      });

      // Send farewell email
      sendEmail({
        email: req.user.email,
        subject: 'Account Deleted - We\'ll miss you!',
        template: 'account-deleted',
        data: {
          name: user.name,
          reactivationUrl: `${process.env.CLIENT_URL}/reactivate`
        }
      }).catch(error => logger.error('Deletion email failed:', error));

      res.status(200).json({
        success: true,
        message: 'Account deleted successfully'
      });

    } catch (error) {
      logger.error(`Account deletion error: ${error.message}`);
      res.status(500).json({
        success: false,
        message: 'Account deletion failed'
      });
    }
  }
);
