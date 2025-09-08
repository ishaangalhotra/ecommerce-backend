// sms-gateway-system.js - SMS Gateway Integration System
// Comprehensive SMS service with multiple providers and OTP management

const crypto = require('crypto');

class SMSGatewaySystem {
  constructor() {
    this.enabled = process.env.SMS_ENABLED === 'true';
    this.provider = process.env.SMS_PROVIDER || 'twilio'; // twilio, aws, textlocal, msg91
    this.client = null;
    this.otpStorage = new Map(); // In production, use Redis
    this.otpExpiry = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10; // minutes
    this.maxOtpAttempts = parseInt(process.env.MAX_OTP_ATTEMPTS) || 3;
    
    // Rate limiting
    this.rateLimits = new Map(); // Track SMS sending rates
    this.maxSmsPerHour = parseInt(process.env.MAX_SMS_PER_HOUR) || 10;
    
    this.initializeProvider();
  }

  async initializeProvider() {
    if (!this.enabled) {
      console.log('📱 SMS service disabled');
      return;
    }

    try {
      switch (this.provider.toLowerCase()) {
        case 'twilio':
          await this.initializeTwilio();
          break;
        case 'aws':
          await this.initializeAWSSNS();
          break;
        case 'textlocal':
          await this.initializeTextlocal();
          break;
        case 'msg91':
          await this.initializeMsg91();
          break;
        case 'mock':
          await this.initializeMock();
          break;
        default:
          console.warn(`⚠️ Unknown SMS provider: ${this.provider}`);
          this.enabled = false;
      }
    } catch (error) {
      console.error(`❌ Failed to initialize SMS provider ${this.provider}:`, error);
      this.enabled = false;
    }
  }

  async initializeTwilio() {
    try {
      const twilio = require('twilio');
      
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      
      if (!accountSid || !authToken) {
        throw new Error('Twilio credentials missing');
      }
      
      this.client = twilio(accountSid, authToken);
      this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
      
      // Test connection
      await this.client.api.accounts(accountSid).fetch();
      console.log('✅ Twilio SMS service initialized');
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.warn('⚠️ Twilio package not found. Install with: npm install twilio');
      }
      throw error;
    }
  }

  async initializeAWSSNS() {
    try {
      const AWS = require('aws-sdk');
      
      AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1'
      });
      
      this.client = new AWS.SNS();
      console.log('✅ AWS SNS SMS service initialized');
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.warn('⚠️ AWS SDK not found. Install with: npm install aws-sdk');
      }
      throw error;
    }
  }

  async initializeTextlocal() {
    try {
      // Textlocal is a popular SMS provider in India
      const axios = require('axios');
      this.client = axios;
      this.apiKey = process.env.TEXTLOCAL_API_KEY;
      this.sender = process.env.TEXTLOCAL_SENDER || 'TXTLCL';
      
      if (!this.apiKey) {
        throw new Error('Textlocal API key missing');
      }
      
      console.log('✅ Textlocal SMS service initialized');
    } catch (error) {
      throw error;
    }
  }

  async initializeMsg91() {
    try {
      // MSG91 is another popular Indian SMS provider
      const axios = require('axios');
      this.client = axios;
      this.authKey = process.env.MSG91_AUTH_KEY;
      this.senderId = process.env.MSG91_SENDER_ID || 'MSG91';
      
      if (!this.authKey) {
        throw new Error('MSG91 auth key missing');
      }
      
      console.log('✅ MSG91 SMS service initialized');
    } catch (error) {
      throw error;
    }
  }

  async initializeMock() {
    // Mock SMS service for development/testing
    this.client = {
      send: async (message, number) => {
        console.log(`📱 MOCK SMS to ${number}: ${message}`);
        return { success: true, messageId: `mock_${Date.now()}` };
      }
    };
    console.log('✅ Mock SMS service initialized');
  }

  // Generate secure OTP
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    
    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, digits.length);
      otp += digits[randomIndex];
    }
    
    return otp;
  }

  // Store OTP with expiry and attempt tracking
  storeOTP(phoneNumber, otp, purpose = 'verification') {
    const key = `${phoneNumber}_${purpose}`;
    const expiryTime = Date.now() + (this.otpExpiry * 60 * 1000);
    
    this.otpStorage.set(key, {
      otp,
      expiryTime,
      attempts: 0,
      createdAt: Date.now(),
      purpose
    });
    
    // Auto-cleanup expired OTPs
    setTimeout(() => {
      this.otpStorage.delete(key);
    }, this.otpExpiry * 60 * 1000 + 5000); // 5 seconds grace period
  }

  // Verify OTP
  verifyOTP(phoneNumber, otp, purpose = 'verification') {
    const key = `${phoneNumber}_${purpose}`;
    const otpData = this.otpStorage.get(key);
    
    if (!otpData) {
      return {
        success: false,
        error: 'OTP not found or expired',
        code: 'OTP_NOT_FOUND'
      };
    }
    
    if (Date.now() > otpData.expiryTime) {
      this.otpStorage.delete(key);
      return {
        success: false,
        error: 'OTP has expired',
        code: 'OTP_EXPIRED'
      };
    }
    
    if (otpData.attempts >= this.maxOtpAttempts) {
      this.otpStorage.delete(key);
      return {
        success: false,
        error: 'Maximum OTP attempts exceeded',
        code: 'MAX_ATTEMPTS_EXCEEDED'
      };
    }
    
    otpData.attempts++;
    
    if (otpData.otp !== otp) {
      return {
        success: false,
        error: 'Invalid OTP',
        code: 'INVALID_OTP',
        attemptsLeft: this.maxOtpAttempts - otpData.attempts
      };
    }
    
    // OTP is valid, remove it
    this.otpStorage.delete(key);
    return {
      success: true,
      message: 'OTP verified successfully'
    };
  }

  // Rate limiting check
  checkRateLimit(phoneNumber) {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    if (!this.rateLimits.has(phoneNumber)) {
      this.rateLimits.set(phoneNumber, []);
    }
    
    const attempts = this.rateLimits.get(phoneNumber);
    
    // Remove old attempts
    const recentAttempts = attempts.filter(time => time > hourAgo);
    this.rateLimits.set(phoneNumber, recentAttempts);
    
    if (recentAttempts.length >= this.maxSmsPerHour) {
      return {
        allowed: false,
        resetTime: new Date(recentAttempts[0] + (60 * 60 * 1000)),
        attemptsUsed: recentAttempts.length,
        maxAttempts: this.maxSmsPerHour
      };
    }
    
    return {
      allowed: true,
      attemptsUsed: recentAttempts.length,
      maxAttempts: this.maxSmsPerHour
    };
  }

  // Format phone number
  formatPhoneNumber(phoneNumber, countryCode = '+91') {
    // Remove all non-digits
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // If it starts with country code without +, add +
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      return '+' + cleaned;
    }
    
    // If it's a 10-digit Indian number, add +91
    if (cleaned.length === 10) {
      return countryCode + cleaned;
    }
    
    // If it already has country code
    if (phoneNumber.startsWith('+')) {
      return phoneNumber;
    }
    
    return phoneNumber; // Return as-is if we can't determine format
  }

  // Send SMS using the configured provider
  async sendSMS(phoneNumber, message, options = {}) {
    if (!this.enabled) {
      console.log('📱 SMS service disabled, skipping SMS send');
      return { success: false, error: 'SMS service disabled' };
    }

    try {
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // Check rate limiting
      const rateLimitCheck = this.checkRateLimit(formattedNumber);
      if (!rateLimitCheck.allowed) {
        return {
          success: false,
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          resetTime: rateLimitCheck.resetTime
        };
      }

      let result;
      
      switch (this.provider.toLowerCase()) {
        case 'twilio':
          result = await this.sendTwilioSMS(formattedNumber, message, options);
          break;
        case 'aws':
          result = await this.sendAWSSMS(formattedNumber, message, options);
          break;
        case 'textlocal':
          result = await this.sendTextlocalSMS(formattedNumber, message, options);
          break;
        case 'msg91':
          result = await this.sendMsg91SMS(formattedNumber, message, options);
          break;
        case 'mock':
          result = await this.client.send(message, formattedNumber);
          break;
        default:
          throw new Error(`Unsupported SMS provider: ${this.provider}`);
      }

      if (result.success) {
        // Record successful send for rate limiting
        const attempts = this.rateLimits.get(formattedNumber) || [];
        attempts.push(Date.now());
        this.rateLimits.set(formattedNumber, attempts);
      }

      return result;
    } catch (error) {
      console.error('❌ SMS send failed:', error);
      return {
        success: false,
        error: error.message,
        code: 'SMS_SEND_FAILED'
      };
    }
  }

  async sendTwilioSMS(phoneNumber, message, options = {}) {
    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: phoneNumber,
        ...options
      });

      return {
        success: true,
        messageId: result.sid,
        status: result.status,
        provider: 'twilio'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        provider: 'twilio'
      };
    }
  }

  async sendAWSSMS(phoneNumber, message, options = {}) {
    try {
      const params = {
        Message: message,
        PhoneNumber: phoneNumber,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: options.smsType || 'Transactional'
          }
        }
      };

      const result = await this.client.publish(params).promise();

      return {
        success: true,
        messageId: result.MessageId,
        provider: 'aws'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        provider: 'aws'
      };
    }
  }

  async sendTextlocalSMS(phoneNumber, message, options = {}) {
    try {
      const response = await this.client.post('https://api.textlocal.in/send/', {
        apikey: this.apiKey,
        numbers: phoneNumber.replace('+91', ''), // Remove +91 for Indian numbers
        message: message,
        sender: options.sender || this.sender
      });

      if (response.data.status === 'success') {
        return {
          success: true,
          messageId: response.data.message_id,
          provider: 'textlocal'
        };
      } else {
        return {
          success: false,
          error: response.data.errors[0].message,
          code: response.data.errors[0].code,
          provider: 'textlocal'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: 'textlocal'
      };
    }
  }

  async sendMsg91SMS(phoneNumber, message, options = {}) {
    try {
      const response = await this.client.post(`https://api.msg91.com/api/sendhttp.php`, null, {
        params: {
          authkey: this.authKey,
          mobiles: phoneNumber.replace('+91', ''),
          message: message,
          sender: options.senderId || this.senderId,
          route: options.route || '4'
        }
      });

      if (response.data.type === 'success') {
        return {
          success: true,
          messageId: response.data.message,
          provider: 'msg91'
        };
      } else {
        return {
          success: false,
          error: response.data.message,
          provider: 'msg91'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        provider: 'msg91'
      };
    }
  }

  // Send OTP SMS
  async sendOTP(phoneNumber, purpose = 'verification', template = null) {
    const otp = this.generateOTP();
    const formattedNumber = this.formatPhoneNumber(phoneNumber);
    
    // Store OTP
    this.storeOTP(formattedNumber, otp, purpose);
    
    // Create message
    let message;
    if (template) {
      message = template.replace('{otp}', otp);
    } else {
      const purposeText = purpose === 'verification' ? 'verify your account' : 
                         purpose === 'login' ? 'log in to your account' :
                         purpose === 'reset' ? 'reset your password' : 'authenticate';
      
      message = `Your QuickLocal OTP to ${purposeText} is: ${otp}. This OTP will expire in ${this.otpExpiry} minutes. Do not share this OTP with anyone.`;
    }
    
    const smsResult = await this.sendSMS(formattedNumber, message);
    
    return {
      ...smsResult,
      otpSent: smsResult.success,
      expiryMinutes: this.otpExpiry,
      purpose
    };
  }

  // Send order confirmation SMS
  async sendOrderConfirmation(phoneNumber, orderDetails) {
    const message = `Hi ${orderDetails.customerName}, your QuickLocal order #${orderDetails.orderId} for ₹${orderDetails.amount} has been confirmed! Expected delivery: ${orderDetails.expectedDelivery}. Track: ${orderDetails.trackingUrl}`;
    
    return await this.sendSMS(phoneNumber, message, { smsType: 'Transactional' });
  }

  // Send order status update SMS
  async sendOrderStatusUpdate(phoneNumber, orderDetails) {
    const statusMessages = {
      'processing': 'Your order is being prepared',
      'shipped': 'Your order has been shipped',
      'out_for_delivery': 'Your order is out for delivery',
      'delivered': 'Your order has been delivered',
      'cancelled': 'Your order has been cancelled'
    };
    
    const statusText = statusMessages[orderDetails.status] || 'Order status updated';
    const message = `QuickLocal Update: ${statusText} for order #${orderDetails.orderId}. ${orderDetails.additionalInfo || ''} Track: ${orderDetails.trackingUrl}`;
    
    return await this.sendSMS(phoneNumber, message, { smsType: 'Transactional' });
  }

  // Send delivery notification
  async sendDeliveryNotification(phoneNumber, deliveryDetails) {
    const message = `🚚 Your QuickLocal order #${deliveryDetails.orderId} is being delivered by ${deliveryDetails.deliveryPartner}. ETA: ${deliveryDetails.eta}. Contact: ${deliveryDetails.partnerPhone}`;
    
    return await this.sendSMS(phoneNumber, message, { smsType: 'Transactional' });
  }

  // Send promotional SMS (with opt-out)
  async sendPromotionalSMS(phoneNumber, message, campaignId = null) {
    const promotionalMessage = `${message}\n\nReply STOP to opt-out. QuickLocal`;
    
    return await this.sendSMS(phoneNumber, promotionalMessage, { 
      smsType: 'Promotional',
      campaignId 
    });
  }

  // Get SMS statistics
  getStatistics() {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    const dayAgo = now - (24 * 60 * 60 * 1000);
    
    let otpCount = 0;
    let recentOtps = 0;
    
    for (const [key, otpData] of this.otpStorage.entries()) {
      otpCount++;
      if (otpData.createdAt > hourAgo) {
        recentOtps++;
      }
    }
    
    let totalSmsToday = 0;
    let totalSmsThisHour = 0;
    
    for (const [phone, attempts] of this.rateLimits.entries()) {
      const todayAttempts = attempts.filter(time => time > dayAgo);
      const hourAttempts = attempts.filter(time => time > hourAgo);
      
      totalSmsToday += todayAttempts.length;
      totalSmsThisHour += hourAttempts.length;
    }
    
    return {
      provider: this.provider,
      enabled: this.enabled,
      activeOtps: otpCount,
      recentOtps,
      smsToday: totalSmsToday,
      smsThisHour: totalSmsThisHour,
      rateLimitConfig: {
        maxPerHour: this.maxSmsPerHour,
        otpExpiry: this.otpExpiry,
        maxOtpAttempts: this.maxOtpAttempts
      }
    };
  }

  // Health check
  async healthCheck() {
    const stats = this.getStatistics();
    
    return {
      status: this.enabled ? 'healthy' : 'disabled',
      provider: this.provider,
      ...stats,
      lastCheck: new Date().toISOString()
    };
  }

  // Cleanup expired data
  cleanup() {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    // Clean up expired OTPs
    for (const [key, otpData] of this.otpStorage.entries()) {
      if (now > otpData.expiryTime) {
        this.otpStorage.delete(key);
      }
    }
    
    // Clean up old rate limit data
    for (const [phone, attempts] of this.rateLimits.entries()) {
      const recentAttempts = attempts.filter(time => time > hourAgo);
      if (recentAttempts.length === 0) {
        this.rateLimits.delete(phone);
      } else {
        this.rateLimits.set(phone, recentAttempts);
      }
    }
  }
}

// Express middleware for SMS operations
const createSMSMiddleware = (smsSystem) => {
  return {
    // Send OTP middleware
    sendOTP: async (req, res, next) => {
      try {
        const { phoneNumber, purpose = 'verification', template } = req.body;
        
        if (!phoneNumber) {
          return res.status(400).json({
            success: false,
            error: 'Phone number is required'
          });
        }

        const result = await smsSystem.sendOTP(phoneNumber, purpose, template);
        
        res.json({
          success: result.success,
          message: result.success ? 'OTP sent successfully' : result.error,
          expiryMinutes: result.expiryMinutes,
          purpose: result.purpose,
          ...(result.success ? {} : { error: result.error, code: result.code })
        });
      } catch (error) {
        console.error('❌ Send OTP middleware error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to send OTP',
          message: error.message
        });
      }
    },

    // Verify OTP middleware
    verifyOTP: async (req, res, next) => {
      try {
        const { phoneNumber, otp, purpose = 'verification' } = req.body;
        
        if (!phoneNumber || !otp) {
          return res.status(400).json({
            success: false,
            error: 'Phone number and OTP are required'
          });
        }

        const result = smsSystem.verifyOTP(phoneNumber, otp, purpose);
        
        if (result.success) {
          req.verifiedPhone = phoneNumber;
          req.otpPurpose = purpose;
          next();
        } else {
          res.status(400).json({
            success: false,
            error: result.error,
            code: result.code,
            attemptsLeft: result.attemptsLeft
          });
        }
      } catch (error) {
        console.error('❌ Verify OTP middleware error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to verify OTP',
          message: error.message
        });
      }
    },

    // General SMS send middleware
    sendSMS: async (req, res, next) => {
      try {
        const { phoneNumber, message, options = {} } = req.body;
        
        if (!phoneNumber || !message) {
          return res.status(400).json({
            success: false,
            error: 'Phone number and message are required'
          });
        }

        const result = await smsSystem.sendSMS(phoneNumber, message, options);
        
        res.json({
          success: result.success,
          message: result.success ? 'SMS sent successfully' : result.error,
          messageId: result.messageId,
          provider: result.provider,
          ...(result.success ? {} : { error: result.error, code: result.code })
        });
      } catch (error) {
        console.error('❌ Send SMS middleware error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to send SMS',
          message: error.message
        });
      }
    }
  };
};

// Routes factory
const createSMSRoutes = (smsSystem) => {
  const router = require('express').Router();
  const middleware = createSMSMiddleware(smsSystem);

  // Send OTP
  router.post('/sms/send-otp', middleware.sendOTP);
  
  // Verify OTP (can be used as middleware)
  router.post('/sms/verify-otp', middleware.verifyOTP, (req, res) => {
    res.json({
      success: true,
      message: 'OTP verified successfully',
      verifiedPhone: req.verifiedPhone
    });
  });
  
  // Send general SMS
  router.post('/sms/send', middleware.sendSMS);
  
  // SMS statistics (admin only)
  router.get('/sms/stats', (req, res) => {
    try {
      const stats = smsSystem.getStatistics();
      res.json({
        success: true,
        statistics: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get statistics',
        message: error.message
      });
    }
  });

  // SMS health check
  router.get('/sms/health', async (req, res) => {
    try {
      const health = await smsSystem.healthCheck();
      res.json({
        success: true,
        health
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Health check failed',
        message: error.message
      });
    }
  });

  return { router, middleware };
};

// Auto-cleanup service
setInterval(() => {
  try {
    if (global.smsGatewaySystem) {
      global.smsGatewaySystem.cleanup();
    }
  } catch (error) {
    console.error('❌ SMS cleanup failed:', error);
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Initialize and export
const smsGatewaySystem = new SMSGatewaySystem();

module.exports = {
  SMSGatewaySystem,
  smsGatewaySystem,
  createSMSMiddleware,
  createSMSRoutes
};
