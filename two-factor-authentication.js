// two-factor-authentication.js - Enhanced 2FA System
// Comprehensive 2FA with SMS, email, authenticator app, and backup codes

const crypto = require('crypto');
const mongoose = require('mongoose');

class TwoFactorAuthenticationSystem {
  constructor() {
    this.enabled = process.env.TWO_FACTOR_ENABLED !== 'false';
    this.smsSystem = null; // Will be injected
    this.emailSystem = null; // Will be injected
    
    // Configuration
    this.totpWindow = parseInt(process.env.TOTP_WINDOW) || 1; // 30-second windows
    this.backupCodesCount = parseInt(process.env.BACKUP_CODES_COUNT) || 10;
    this.sessionDuration = parseInt(process.env.TWO_FACTOR_SESSION_DURATION) || 30; // minutes
    
    // Storage for temporary 2FA sessions
    this.pendingSessions = new Map();
    
    this.initialize();
  }

  initialize() {
    if (!this.enabled) {
      console.log('🔐 Two-Factor Authentication disabled');
      return;
    }
    
    try {
      this.createTwoFactorSchema();
      console.log('✅ Two-Factor Authentication system initialized');
    } catch (error) {
      console.error('❌ Failed to initialize 2FA system:', error);
      this.enabled = false;
    }
  }

  // Create MongoDB schema for 2FA data
  createTwoFactorSchema() {
    const twoFactorSchema = new mongoose.Schema({
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
      },
      isEnabled: {
        type: Boolean,
        default: false
      },
      methods: [{
        type: {
          type: String,
          enum: ['sms', 'email', 'totp', 'backup'],
          required: true
        },
        isEnabled: {
          type: Boolean,
          default: true
        },
        data: mongoose.Schema.Types.Mixed, // Store method-specific data
        createdAt: {
          type: Date,
          default: Date.now
        },
        lastUsed: Date
      }],
      backupCodes: [{
        code: String,
        used: {
          type: Boolean,
          default: false
        },
        usedAt: Date
      }],
      trustedDevices: [{
        deviceId: String,
        deviceName: String,
        userAgent: String,
        ipAddress: String,
        createdAt: {
          type: Date,
          default: Date.now
        },
        expiresAt: {
          type: Date,
          default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        }
      }],
      settings: {
        requireForLogin: {
          type: Boolean,
          default: true
        },
        requireForSensitiveActions: {
          type: Boolean,
          default: true
        },
        trustNewDevices: {
          type: Boolean,
          default: false
        }
      }
    }, {
      timestamps: true
    });

    // Index for performance
    twoFactorSchema.index({ userId: 1 });
    twoFactorSchema.index({ 'trustedDevices.deviceId': 1 });
    twoFactorSchema.index({ 'trustedDevices.expiresAt': 1 }, { expireAfterSeconds: 0 });

    // Check if model already exists to avoid re-compilation
    try {
      this.TwoFactorModel = mongoose.model('TwoFactor');
    } catch (error) {
      this.TwoFactorModel = mongoose.model('TwoFactor', twoFactorSchema);
    }
  }

  // Inject dependencies
  setSMSSystem(smsSystem) {
    this.smsSystem = smsSystem;
  }

  setEmailSystem(emailSystem) {
    this.emailSystem = emailSystem;
  }

  // Generate secure random backup codes
  generateBackupCodes(count = this.backupCodesCount) {
    const codes = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric code
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push({
        code: code.match(/.{1,4}/g).join('-'), // Format as XXXX-XXXX
        used: false
      });
    }
    return codes;
  }

  // Generate TOTP secret
  generateTOTPSecret() {
    // Base32 encoded secret (32 characters)
    const secret = crypto.randomBytes(20).toString('base64').replace(/[^A-Z2-7]/g, '').substring(0, 32);
    return secret;
  }

  // Generate TOTP token
  generateTOTPToken(secret, timeStep = 30, window = 0) {
    try {
      const speakeasy = require('speakeasy');
      return speakeasy.totp({
        secret: secret,
        encoding: 'base32',
        time: Date.now() / 1000 + (window * timeStep),
        step: timeStep
      });
    } catch (error) {
      console.warn('⚠️ Speakeasy not found. Install with: npm install speakeasy');
      return null;
    }
  }

  // Verify TOTP token
  verifyTOTPToken(token, secret, window = this.totpWindow) {
    try {
      const speakeasy = require('speakeasy');
      return speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: token,
        window: window,
        time: Date.now() / 1000
      });
    } catch (error) {
      console.warn('⚠️ Speakeasy not found. Install with: npm install speakeasy');
      return false;
    }
  }

  // Generate QR code URL for TOTP setup
  generateTOTPQRCode(secret, userEmail, issuer = 'QuickLocal') {
    const otpAuthUrl = `otpauth://totp/${issuer}:${userEmail}?secret=${secret}&issuer=${issuer}`;
    return {
      secret,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpAuthUrl)}`,
      manualEntryKey: secret,
      otpAuthUrl
    };
  }

  // Initialize 2FA for a user
  async initialize2FA(userId) {
    try {
      let twoFactor = await this.TwoFactorModel.findOne({ userId });
      
      if (!twoFactor) {
        twoFactor = new this.TwoFactorModel({
          userId,
          isEnabled: false,
          methods: [],
          backupCodes: this.generateBackupCodes()
        });
        await twoFactor.save();
      }
      
      return twoFactor;
    } catch (error) {
      console.error('❌ Failed to initialize 2FA:', error);
      throw error;
    }
  }

  // Enable 2FA method
  async enableMethod(userId, methodType, methodData = {}) {
    try {
      const twoFactor = await this.initialize2FA(userId);
      
      // Remove existing method of same type
      twoFactor.methods = twoFactor.methods.filter(m => m.type !== methodType);
      
      // Add new method
      const method = {
        type: methodType,
        isEnabled: true,
        data: methodData,
        createdAt: new Date()
      };
      
      twoFactor.methods.push(method);
      
      // Enable 2FA if this is the first method
      if (!twoFactor.isEnabled) {
        twoFactor.isEnabled = true;
      }
      
      await twoFactor.save();
      
      return {
        success: true,
        method: methodType,
        backupCodes: methodType === 'totp' ? twoFactor.backupCodes.map(c => c.code) : undefined
      };
    } catch (error) {
      console.error('❌ Failed to enable 2FA method:', error);
      return { success: false, error: error.message };
    }
  }

  // Disable 2FA method
  async disableMethod(userId, methodType) {
    try {
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      if (!twoFactor) {
        return { success: false, error: '2FA not initialized' };
      }
      
      // Remove method
      twoFactor.methods = twoFactor.methods.filter(m => m.type !== methodType);
      
      // Disable 2FA if no methods left
      if (twoFactor.methods.length === 0) {
        twoFactor.isEnabled = false;
      }
      
      await twoFactor.save();
      
      return { success: true, method: methodType };
    } catch (error) {
      console.error('❌ Failed to disable 2FA method:', error);
      return { success: false, error: error.message };
    }
  }

  // Setup TOTP (Authenticator app)
  async setupTOTP(userId, userEmail) {
    try {
      const secret = this.generateTOTPSecret();
      const qrCodeData = this.generateTOTPQRCode(secret, userEmail);
      
      // Store temporarily (user needs to verify before enabling)
      const sessionId = crypto.randomUUID();
      this.pendingSessions.set(sessionId, {
        userId,
        methodType: 'totp',
        methodData: { secret },
        expiresAt: Date.now() + (10 * 60 * 1000) // 10 minutes
      });
      
      return {
        success: true,
        sessionId,
        ...qrCodeData,
        message: 'Scan the QR code with your authenticator app and verify with a token'
      };
    } catch (error) {
      console.error('❌ Failed to setup TOTP:', error);
      return { success: false, error: error.message };
    }
  }

  // Verify TOTP setup
  async verifyTOTPSetup(sessionId, token) {
    try {
      const session = this.pendingSessions.get(sessionId);
      if (!session || Date.now() > session.expiresAt) {
        return { success: false, error: 'Session expired or invalid' };
      }
      
      const { userId, methodData } = session;
      const isValid = this.verifyTOTPToken(token, methodData.secret);
      
      if (isValid) {
        const result = await this.enableMethod(userId, 'totp', methodData);
        this.pendingSessions.delete(sessionId);
        return result;
      } else {
        return { success: false, error: 'Invalid token' };
      }
    } catch (error) {
      console.error('❌ Failed to verify TOTP setup:', error);
      return { success: false, error: error.message };
    }
  }

  // Setup SMS 2FA
  async setupSMS(userId, phoneNumber) {
    if (!this.smsSystem) {
      return { success: false, error: 'SMS service not available' };
    }

    try {
      // Send verification SMS
      const result = await this.smsSystem.sendOTP(phoneNumber, 'setup_2fa');
      
      if (result.success) {
        return {
          success: true,
          message: 'SMS sent to your phone number. Verify with OTP to enable 2FA.',
          phoneNumber: phoneNumber.replace(/(\+\d{2})(\d{3})(\d{3})(\d{4})/, '$1 XXX XXX $4')
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Failed to setup SMS 2FA:', error);
      return { success: false, error: error.message };
    }
  }

  // Verify SMS setup
  async verifySMSSetup(userId, phoneNumber, otp) {
    if (!this.smsSystem) {
      return { success: false, error: 'SMS service not available' };
    }

    try {
      const otpResult = this.smsSystem.verifyOTP(phoneNumber, otp, 'setup_2fa');
      
      if (otpResult.success) {
        return await this.enableMethod(userId, 'sms', { phoneNumber });
      } else {
        return { success: false, error: otpResult.error };
      }
    } catch (error) {
      console.error('❌ Failed to verify SMS setup:', error);
      return { success: false, error: error.message };
    }
  }

  // Setup Email 2FA
  async setupEmail(userId, email) {
    if (!this.emailSystem) {
      return { success: false, error: 'Email service not available' };
    }

    try {
      // Generate and send email verification
      const code = crypto.randomInt(100000, 999999).toString();
      
      // Store code temporarily
      const sessionId = crypto.randomUUID();
      this.pendingSessions.set(sessionId, {
        userId,
        methodType: 'email',
        methodData: { email },
        verificationCode: code,
        expiresAt: Date.now() + (10 * 60 * 1000) // 10 minutes
      });
      
      // Send email (implement based on your email system)
      const emailSent = await this.sendVerificationEmail(email, code);
      
      if (emailSent) {
        return {
          success: true,
          sessionId,
          message: 'Verification email sent. Check your inbox and verify with the code.',
          email: email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
        };
      } else {
        return { success: false, error: 'Failed to send verification email' };
      }
    } catch (error) {
      console.error('❌ Failed to setup email 2FA:', error);
      return { success: false, error: error.message };
    }
  }

  // Verify Email setup
  async verifyEmailSetup(sessionId, code) {
    try {
      const session = this.pendingSessions.get(sessionId);
      if (!session || Date.now() > session.expiresAt) {
        return { success: false, error: 'Session expired or invalid' };
      }
      
      const { userId, methodData, verificationCode } = session;
      
      if (code === verificationCode) {
        const result = await this.enableMethod(userId, 'email', methodData);
        this.pendingSessions.delete(sessionId);
        return result;
      } else {
        return { success: false, error: 'Invalid verification code' };
      }
    } catch (error) {
      console.error('❌ Failed to verify email setup:', error);
      return { success: false, error: error.message };
    }
  }

  // Send verification email (placeholder - implement based on your email system)
  async sendVerificationEmail(email, code) {
    try {
      if (this.emailSystem && this.emailSystem.sendTwoFactorEmail) {
        return await this.emailSystem.sendTwoFactorEmail(email, code);
      } else {
        console.log(`📧 2FA Email to ${email}: Your verification code is: ${code}`);
        return true; // Mock success
      }
    } catch (error) {
      console.error('❌ Failed to send 2FA email:', error);
      return false;
    }
  }

  // Check if user has 2FA enabled
  async is2FAEnabled(userId) {
    try {
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      return twoFactor && twoFactor.isEnabled && twoFactor.methods.some(m => m.isEnabled);
    } catch (error) {
      return false;
    }
  }

  // Get available 2FA methods for user
  async getAvailableMethods(userId) {
    try {
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      if (!twoFactor || !twoFactor.isEnabled) {
        return [];
      }
      
      return twoFactor.methods
        .filter(m => m.isEnabled)
        .map(m => ({
          type: m.type,
          maskedData: this.maskSensitiveData(m.type, m.data),
          lastUsed: m.lastUsed
        }));
    } catch (error) {
      console.error('❌ Failed to get available methods:', error);
      return [];
    }
  }

  // Mask sensitive data for display
  maskSensitiveData(type, data) {
    switch (type) {
      case 'sms':
        return data.phoneNumber ? data.phoneNumber.replace(/(\+\d{2})(\d{3})(\d{3})(\d{4})/, '$1 XXX XXX $4') : 'SMS';
      case 'email':
        return data.email ? data.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'Email';
      case 'totp':
        return 'Authenticator App';
      case 'backup':
        return 'Backup Codes';
      default:
        return 'Unknown';
    }
  }

  // Initiate 2FA challenge
  async initiate2FAChallenge(userId, deviceInfo = {}) {
    try {
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      if (!twoFactor || !twoFactor.isEnabled) {
        return { success: false, error: '2FA not enabled' };
      }

      // Check if device is trusted
      const isTrustedDevice = this.checkTrustedDevice(twoFactor, deviceInfo);
      if (isTrustedDevice) {
        return { success: true, trusted: true, message: 'Trusted device - 2FA bypassed' };
      }

      const availableMethods = twoFactor.methods.filter(m => m.isEnabled);
      if (availableMethods.length === 0) {
        return { success: false, error: 'No 2FA methods available' };
      }

      // Create challenge session
      const challengeId = crypto.randomUUID();
      this.pendingSessions.set(challengeId, {
        userId,
        type: '2fa_challenge',
        deviceInfo,
        methods: availableMethods.map(m => ({ type: m.type, data: m.data })),
        expiresAt: Date.now() + (this.sessionDuration * 60 * 1000)
      });

      // Send challenges for applicable methods
      const challenges = [];
      
      for (const method of availableMethods) {
        if (method.type === 'sms' && this.smsSystem) {
          await this.smsSystem.sendOTP(method.data.phoneNumber, 'login_2fa');
          challenges.push({
            type: 'sms',
            display: this.maskSensitiveData('sms', method.data)
          });
        } else if (method.type === 'email' && this.emailSystem) {
          const code = crypto.randomInt(100000, 999999).toString();
          this.pendingSessions.get(challengeId).emailCode = code;
          await this.sendVerificationEmail(method.data.email, code);
          challenges.push({
            type: 'email',
            display: this.maskSensitiveData('email', method.data)
          });
        } else if (method.type === 'totp') {
          challenges.push({
            type: 'totp',
            display: this.maskSensitiveData('totp', method.data)
          });
        }
      }

      // Always include backup codes as option
      const unusedBackupCodes = twoFactor.backupCodes.filter(c => !c.used);
      if (unusedBackupCodes.length > 0) {
        challenges.push({
          type: 'backup',
          display: `${unusedBackupCodes.length} backup codes available`
        });
      }

      return {
        success: true,
        challengeId,
        methods: challenges,
        expiresIn: this.sessionDuration * 60 // seconds
      };
    } catch (error) {
      console.error('❌ Failed to initiate 2FA challenge:', error);
      return { success: false, error: error.message };
    }
  }

  // Verify 2FA challenge
  async verify2FAChallenge(challengeId, method, code) {
    try {
      const session = this.pendingSessions.get(challengeId);
      if (!session || Date.now() > session.expiresAt) {
        return { success: false, error: 'Challenge expired or invalid' };
      }

      const { userId } = session;
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      
      let verified = false;
      
      switch (method) {
        case 'sms':
          if (this.smsSystem) {
            const methodData = session.methods.find(m => m.type === 'sms');
            if (methodData) {
              const result = this.smsSystem.verifyOTP(methodData.data.phoneNumber, code, 'login_2fa');
              verified = result.success;
            }
          }
          break;
          
        case 'email':
          verified = code === session.emailCode;
          break;
          
        case 'totp':
          const totpMethod = session.methods.find(m => m.type === 'totp');
          if (totpMethod) {
            verified = this.verifyTOTPToken(code, totpMethod.data.secret);
          }
          break;
          
        case 'backup':
          const backupCode = twoFactor.backupCodes.find(c => c.code === code && !c.used);
          if (backupCode) {
            backupCode.used = true;
            backupCode.usedAt = new Date();
            await twoFactor.save();
            verified = true;
          }
          break;
      }

      if (verified) {
        // Update last used timestamp
        const methodToUpdate = twoFactor.methods.find(m => m.type === method);
        if (methodToUpdate) {
          methodToUpdate.lastUsed = new Date();
          await twoFactor.save();
        }

        // Clean up session
        this.pendingSessions.delete(challengeId);
        
        return {
          success: true,
          method,
          message: '2FA verification successful',
          deviceTrustToken: this.generateDeviceTrustToken(userId, session.deviceInfo)
        };
      } else {
        return { success: false, error: 'Invalid verification code' };
      }
    } catch (error) {
      console.error('❌ Failed to verify 2FA challenge:', error);
      return { success: false, error: error.message };
    }
  }

  // Check if device is trusted
  checkTrustedDevice(twoFactor, deviceInfo) {
    if (!deviceInfo.deviceId || !twoFactor.settings.trustNewDevices) {
      return false;
    }

    return twoFactor.trustedDevices.some(device => 
      device.deviceId === deviceInfo.deviceId && 
      device.expiresAt > new Date()
    );
  }

  // Generate device trust token
  generateDeviceTrustToken(userId, deviceInfo) {
    if (!deviceInfo.deviceId) {
      return null;
    }

    const payload = {
      userId,
      deviceId: deviceInfo.deviceId,
      timestamp: Date.now()
    };

    return crypto
      .createHmac('sha256', process.env.JWT_SECRET || 'fallback_secret')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  // Add trusted device
  async addTrustedDevice(userId, deviceInfo, trustToken) {
    try {
      if (!this.verifyDeviceTrustToken(userId, deviceInfo, trustToken)) {
        return { success: false, error: 'Invalid trust token' };
      }

      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      if (!twoFactor) {
        return { success: false, error: '2FA not initialized' };
      }

      // Remove existing device with same ID
      twoFactor.trustedDevices = twoFactor.trustedDevices.filter(
        d => d.deviceId !== deviceInfo.deviceId
      );

      // Add new trusted device
      twoFactor.trustedDevices.push({
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName || 'Unknown Device',
        userAgent: deviceInfo.userAgent,
        ipAddress: deviceInfo.ipAddress,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      });

      await twoFactor.save();

      return { success: true, message: 'Device added to trusted list' };
    } catch (error) {
      console.error('❌ Failed to add trusted device:', error);
      return { success: false, error: error.message };
    }
  }

  // Verify device trust token
  verifyDeviceTrustToken(userId, deviceInfo, token) {
    const payload = {
      userId,
      deviceId: deviceInfo.deviceId,
      timestamp: Date.now()
    };

    // Allow some time drift (5 minutes)
    const maxAge = 5 * 60 * 1000;
    const minTimestamp = Date.now() - maxAge;

    for (let ts = Date.now(); ts >= minTimestamp; ts -= 30000) { // Check every 30 seconds
      const testPayload = { ...payload, timestamp: ts };
      const expectedToken = crypto
        .createHmac('sha256', process.env.JWT_SECRET || 'fallback_secret')
        .update(JSON.stringify(testPayload))
        .digest('hex');
      
      if (expectedToken === token) {
        return true;
      }
    }

    return false;
  }

  // Get user's 2FA status and settings
  async get2FAStatus(userId) {
    try {
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      if (!twoFactor) {
        return {
          enabled: false,
          methods: [],
          backupCodes: 0,
          trustedDevices: 0,
          settings: {}
        };
      }

      const unusedBackupCodes = twoFactor.backupCodes.filter(c => !c.used).length;
      const activeTrustedDevices = twoFactor.trustedDevices.filter(d => d.expiresAt > new Date()).length;

      return {
        enabled: twoFactor.isEnabled,
        methods: twoFactor.methods
          .filter(m => m.isEnabled)
          .map(m => ({
            type: m.type,
            display: this.maskSensitiveData(m.type, m.data),
            lastUsed: m.lastUsed,
            createdAt: m.createdAt
          })),
        backupCodes: unusedBackupCodes,
        trustedDevices: activeTrustedDevices,
        settings: twoFactor.settings
      };
    } catch (error) {
      console.error('❌ Failed to get 2FA status:', error);
      return { enabled: false, methods: [], backupCodes: 0, trustedDevices: 0, settings: {} };
    }
  }

  // Regenerate backup codes
  async regenerateBackupCodes(userId) {
    try {
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      if (!twoFactor) {
        return { success: false, error: '2FA not initialized' };
      }

      twoFactor.backupCodes = this.generateBackupCodes();
      await twoFactor.save();

      return {
        success: true,
        backupCodes: twoFactor.backupCodes.map(c => c.code),
        message: 'New backup codes generated. Store them safely!'
      };
    } catch (error) {
      console.error('❌ Failed to regenerate backup codes:', error);
      return { success: false, error: error.message };
    }
  }

  // Remove trusted device
  async removeTrustedDevice(userId, deviceId) {
    try {
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      if (!twoFactor) {
        return { success: false, error: '2FA not initialized' };
      }

      const initialCount = twoFactor.trustedDevices.length;
      twoFactor.trustedDevices = twoFactor.trustedDevices.filter(d => d.deviceId !== deviceId);
      
      if (twoFactor.trustedDevices.length === initialCount) {
        return { success: false, error: 'Device not found' };
      }

      await twoFactor.save();
      return { success: true, message: 'Trusted device removed' };
    } catch (error) {
      console.error('❌ Failed to remove trusted device:', error);
      return { success: false, error: error.message };
    }
  }

  // Update 2FA settings
  async update2FASettings(userId, settings) {
    try {
      const twoFactor = await this.TwoFactorModel.findOne({ userId });
      if (!twoFactor) {
        return { success: false, error: '2FA not initialized' };
      }

      twoFactor.settings = { ...twoFactor.settings, ...settings };
      await twoFactor.save();

      return { success: true, settings: twoFactor.settings };
    } catch (error) {
      console.error('❌ Failed to update 2FA settings:', error);
      return { success: false, error: error.message };
    }
  }

  // Cleanup expired sessions and trusted devices
  cleanup() {
    // Clean expired pending sessions
    for (const [sessionId, session] of this.pendingSessions.entries()) {
      if (Date.now() > session.expiresAt) {
        this.pendingSessions.delete(sessionId);
      }
    }

    // Cleanup expired trusted devices (handled by MongoDB TTL)
  }

  // Health check
  async healthCheck() {
    return {
      status: this.enabled ? 'healthy' : 'disabled',
      pendingSessions: this.pendingSessions.size,
      dependencies: {
        sms: !!this.smsSystem,
        email: !!this.emailSystem,
        database: mongoose.connection.readyState === 1
      },
      lastCheck: new Date().toISOString()
    };
  }
}

// Express middleware factory
const create2FAMiddleware = (twoFactorSystem) => {
  return {
    // Require 2FA for sensitive actions
    require2FA: (options = {}) => {
      return async (req, res, next) => {
        try {
          const userId = req.user?.id;
          if (!userId) {
            return res.status(401).json({
              success: false,
              error: 'Authentication required'
            });
          }

          const is2FAEnabled = await twoFactorSystem.is2FAEnabled(userId);
          if (!is2FAEnabled) {
            // If 2FA is not enabled, proceed (or require setup based on options)
            if (options.requireSetup) {
              return res.status(403).json({
                success: false,
                error: '2FA setup required',
                requireSetup: true
              });
            }
            return next();
          }

          // Check if 2FA was already verified in this session
          if (req.session?.twoFactorVerified && req.session.twoFactorUserId === userId) {
            const verifiedAt = req.session.twoFactorVerifiedAt;
            const maxAge = (options.maxAge || 30) * 60 * 1000; // 30 minutes default
            
            if (Date.now() - verifiedAt < maxAge) {
              return next();
            }
          }

          // 2FA verification required
          const deviceInfo = {
            deviceId: req.headers['x-device-id'],
            deviceName: req.headers['x-device-name'],
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip
          };

          const challenge = await twoFactorSystem.initiate2FAChallenge(userId, deviceInfo);
          
          if (challenge.trusted) {
            // Trusted device - mark as verified and proceed
            req.session.twoFactorVerified = true;
            req.session.twoFactorUserId = userId;
            req.session.twoFactorVerifiedAt = Date.now();
            return next();
          }

          return res.status(403).json({
            success: false,
            error: '2FA verification required',
            require2FA: true,
            ...challenge
          });
        } catch (error) {
          console.error('❌ 2FA middleware error:', error);
          res.status(500).json({
            success: false,
            error: 'Failed to check 2FA status'
          });
        }
      };
    },

    // Verify 2FA and proceed
    verify2FA: async (req, res, next) => {
      try {
        const { challengeId, method, code, trustDevice } = req.body;
        
        if (!challengeId || !method || !code) {
          return res.status(400).json({
            success: false,
            error: 'Challenge ID, method, and code are required'
          });
        }

        const result = await twoFactorSystem.verify2FAChallenge(challengeId, method, code);
        
        if (result.success) {
          // Mark session as 2FA verified
          req.session.twoFactorVerified = true;
          req.session.twoFactorUserId = req.user?.id;
          req.session.twoFactorVerifiedAt = Date.now();
          
          // Handle device trust
          if (trustDevice && result.deviceTrustToken) {
            req.deviceTrustToken = result.deviceTrustToken;
          }
          
          req.twoFactorResult = result;
          next();
        } else {
          res.status(400).json({
            success: false,
            error: result.error
          });
        }
      } catch (error) {
        console.error('❌ 2FA verification middleware error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to verify 2FA'
        });
      }
    }
  };
};

// Routes factory
const create2FARoutes = (twoFactorSystem) => {
  const router = require('express').Router();
  const middleware = create2FAMiddleware(twoFactorSystem);

  // Get 2FA status
  router.get('/2fa/status', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const status = await twoFactorSystem.get2FAStatus(userId);
      res.json({ success: true, status });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Setup TOTP
  router.post('/2fa/setup/totp', async (req, res) => {
    try {
      const userId = req.user?.id;
      const userEmail = req.user?.email;
      
      if (!userId || !userEmail) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const result = await twoFactorSystem.setupTOTP(userId, userEmail);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Verify TOTP setup
  router.post('/2fa/setup/totp/verify', async (req, res) => {
    try {
      const { sessionId, token } = req.body;
      const result = await twoFactorSystem.verifyTOTPSetup(sessionId, token);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Setup SMS
  router.post('/2fa/setup/sms', async (req, res) => {
    try {
      const userId = req.user?.id;
      const { phoneNumber } = req.body;
      
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const result = await twoFactorSystem.setupSMS(userId, phoneNumber);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Verify SMS setup
  router.post('/2fa/setup/sms/verify', async (req, res) => {
    try {
      const userId = req.user?.id;
      const { phoneNumber, otp } = req.body;
      
      const result = await twoFactorSystem.verifySMSSetup(userId, phoneNumber, otp);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Initiate 2FA challenge
  router.post('/2fa/challenge', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const deviceInfo = {
        deviceId: req.headers['x-device-id'],
        deviceName: req.headers['x-device-name'],
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip
      };

      const result = await twoFactorSystem.initiate2FAChallenge(userId, deviceInfo);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Verify 2FA challenge
  router.post('/2fa/verify', middleware.verify2FA, async (req, res) => {
    try {
      const result = req.twoFactorResult;
      
      // Handle device trust if requested
      if (req.body.trustDevice && result.deviceTrustToken) {
        const userId = req.user?.id;
        const deviceInfo = {
          deviceId: req.headers['x-device-id'],
          deviceName: req.headers['x-device-name'],
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip
        };
        
        await twoFactorSystem.addTrustedDevice(userId, deviceInfo, result.deviceTrustToken);
      }
      
      res.json({
        success: true,
        message: '2FA verification successful',
        method: result.method
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Disable 2FA method
  router.delete('/2fa/methods/:method', async (req, res) => {
    try {
      const userId = req.user?.id;
      const { method } = req.params;
      
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const result = await twoFactorSystem.disableMethod(userId, method);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Regenerate backup codes
  router.post('/2fa/backup-codes/regenerate', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const result = await twoFactorSystem.regenerateBackupCodes(userId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update 2FA settings
  router.patch('/2fa/settings', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const result = await twoFactorSystem.update2FASettings(userId, req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Health check
  router.get('/2fa/health', async (req, res) => {
    try {
      const health = await twoFactorSystem.healthCheck();
      res.json({ success: true, health });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return { router, middleware };
};

// Auto-cleanup service
setInterval(() => {
  try {
    if (global.twoFactorSystem) {
      global.twoFactorSystem.cleanup();
    }
  } catch (error) {
    console.error('❌ 2FA cleanup failed:', error);
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Initialize and export
const twoFactorSystem = new TwoFactorAuthenticationSystem();

module.exports = {
  TwoFactorAuthenticationSystem,
  twoFactorSystem,
  create2FAMiddleware,
  create2FARoutes
};
