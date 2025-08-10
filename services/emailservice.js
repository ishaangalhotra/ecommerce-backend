const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.templates = {};
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Create transporter
    this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: false, // true for 465, false for other ports
      auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify connection
      await this.transporter.verify();
      
      // Load email templates
      await this.loadTemplates();
      
      this.isInitialized = true;
      logger.info('✅ Email service initialized successfully');
    } catch (error) {
      logger.error('❌ Email service initialization failed:', error.message);
      throw error;
    }
  }

  async loadTemplates() {
    try {
      const templatesDir = path.join(__dirname, '../templates/emails');
      
      // Create templates directory if it doesn't exist
      try {
        await fs.access(templatesDir);
      } catch (error) {
        await fs.mkdir(templatesDir, { recursive: true });
      }

      // Load default templates
      this.templates = {
        welcome: this.getWelcomeTemplate(),
        orderConfirmation: this.getOrderConfirmationTemplate(),
        orderShipped: this.getOrderShippedTemplate(),
        orderDelivered: this.getOrderDeliveredTemplate(),
        passwordReset: this.getPasswordResetTemplate(),
        emailVerification: this.getEmailVerificationTemplate(),
        returnRequest: this.getReturnRequestTemplate(),
        refundProcessed: this.getRefundProcessedTemplate(),
        accountSuspended: this.getAccountSuspendedTemplate(),
        securityAlert: this.getSecurityAlertTemplate()
      };

      logger.info('📧 Email templates loaded successfully');
    } catch (error) {
      logger.error('❌ Failed to load email templates:', error.message);
    }
  }

  async sendEmail(options) {
    if (!this.isInitialized) {
      throw new Error('Email service not initialized');
    }

    try {
      const {
        to,
        subject,
        template,
        data = {},
        attachments = [],
        cc,
        bcc,
        replyTo
      } = options;

      // Get template content
      let html = '';
      let text = '';

      if (template && this.templates[template]) {
        const templateContent = this.templates[template];
        html = this.replacePlaceholders(templateContent.html, data);
        text = this.replacePlaceholders(templateContent.text, data);
      } else if (options.html) {
        html = this.replacePlaceholders(options.html, data);
        text = options.text || this.htmlToText(html);
      } else {
        throw new Error('Template or HTML content is required');
      }

      // Prepare email
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'QuickLocal <noreply@quicklocal.com>',
        to,
        subject: this.replacePlaceholders(subject, data),
        html,
        text,
        attachments,
        cc,
        bcc,
        replyTo
      };

      // Send email
      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info('📧 Email sent successfully', {
        to,
        subject: mailOptions.subject,
        messageId: result.messageId
      });

      return result;
    } catch (error) {
      logger.error('❌ Failed to send email:', error.message);
      throw error;
    }
  }

  replacePlaceholders(content, data) {
    if (!content) return content;
    
    return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] || match;
    });
  }

  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Email sending methods
  async sendWelcomeEmail(user) {
    return this.sendEmail({
      to: user.email,
      subject: 'Welcome to QuickLocal! 🚀',
      template: 'welcome',
      data: {
        name: user.name,
        email: user.email,
        loginUrl: `${process.env.FRONTEND_URL}/login`
      }
    });
  }

  async sendOrderConfirmation(order, user) {
    return this.sendEmail({
      to: user.email,
      subject: `Order Confirmed - ${order.orderNumber}`,
      template: 'orderConfirmation',
      data: {
        name: user.name,
        orderNumber: order.orderNumber,
        orderDate: new Date(order.createdAt).toLocaleDateString(),
        totalAmount: `$${order.totalAmount.toFixed(2)}`,
        estimatedDelivery: order.estimatedDelivery,
        orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`,
        trackUrl: `${process.env.FRONTEND_URL}/track`
      }
    });
  }

  async sendOrderShipped(order, user) {
    return this.sendEmail({
      to: user.email,
      subject: `Your order is on the way! 📦`,
      template: 'orderShipped',
      data: {
        name: user.name,
        orderNumber: order.orderNumber,
        estimatedDelivery: order.estimatedDelivery,
        trackUrl: `${process.env.FRONTEND_URL}/track`
      }
    });
  }

  async sendOrderDelivered(order, user) {
    return this.sendEmail({
      to: user.email,
      subject: `Your order has been delivered! ✅`,
      template: 'orderDelivered',
      data: {
        name: user.name,
        orderNumber: order.orderNumber,
        deliveryDate: new Date().toLocaleDateString(),
        orderUrl: `${process.env.FRONTEND_URL}/orders/${order._id}`,
        reviewUrl: `${process.env.FRONTEND_URL}/review/${order._id}`
      }
    });
  }

  async sendPasswordReset(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    return this.sendEmail({
      to: user.email,
      subject: 'Reset Your Password - QuickLocal',
      template: 'passwordReset',
      data: {
        name: user.name,
        resetUrl,
        expiryTime: '1 hour'
      }
    });
  }

  async sendEmailVerification(user, verificationToken) {
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    return this.sendEmail({
      to: user.email,
      subject: 'Verify Your Email - QuickLocal',
      template: 'emailVerification',
      data: {
        name: user.name,
        verifyUrl,
        expiryTime: '24 hours'
      }
    });
  }

  async sendReturnRequest(user, returnRequest) {
    return this.sendEmail({
      to: user.email,
      subject: `Return Request Submitted - ${returnRequest.orderNumber}`,
      template: 'returnRequest',
      data: {
        name: user.name,
        orderNumber: returnRequest.orderNumber,
        returnReason: returnRequest.reason,
        returnId: returnRequest._id,
        statusUrl: `${process.env.FRONTEND_URL}/returns/${returnRequest._id}`
      }
    });
  }

  async sendRefundProcessed(user, refund) {
    return this.sendEmail({
      to: user.email,
      subject: `Refund Processed - ${refund.orderNumber}`,
      template: 'refundProcessed',
      data: {
        name: user.name,
        orderNumber: refund.orderNumber,
        refundAmount: `$${refund.amount.toFixed(2)}`,
        refundMethod: refund.method,
        estimatedTime: '5-10 business days'
      }
    });
  }

  async sendSecurityAlert(user, alert) {
    return this.sendEmail({
      to: user.email,
      subject: 'Security Alert - QuickLocal',
      template: 'securityAlert',
      data: {
        name: user.name,
        alertType: alert.type,
        alertTime: new Date().toLocaleString(),
        deviceInfo: alert.deviceInfo,
        location: alert.location,
        actionUrl: `${process.env.FRONTEND_URL}/security`
      }
    });
  }

  // Template methods
  getWelcomeTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Welcome to QuickLocal</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #6366f1;">Welcome to QuickLocal! 🚀</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>Welcome to QuickLocal! We're excited to have you on board. Get ready for ultra-fast local delivery in just 20 minutes.</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>What you can do:</h3>
              <ul>
                <li>Browse local products from nearby sellers</li>
                <li>Order with lightning-fast delivery</li>
                <li>Track your orders in real-time</li>
                <li>Support local businesses</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{loginUrl}}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Start Shopping</a>
            </div>
            
            <p>If you have any questions, feel free to contact our support team.</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Welcome to QuickLocal!
        
        Hi {{name}},
        
        Welcome to QuickLocal! We're excited to have you on board. Get ready for ultra-fast local delivery in just 20 minutes.
        
        What you can do:
        - Browse local products from nearby sellers
        - Order with lightning-fast delivery
        - Track your orders in real-time
        - Support local businesses
        
        Start shopping: {{loginUrl}}
        
        If you have any questions, feel free to contact our support team.
        
        Best regards,
        The QuickLocal Team
      `
    };
  }

  getOrderConfirmationTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Confirmation</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #6366f1;">Order Confirmed! ✅</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>Your order has been confirmed and is being prepared for delivery.</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Order Details:</h3>
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Order Date:</strong> {{orderDate}}</p>
              <p><strong>Total Amount:</strong> {{totalAmount}}</p>
              <p><strong>Estimated Delivery:</strong> {{estimatedDelivery}}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{trackUrl}}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Track Order</a>
            </div>
            
            <p>We'll notify you when your order is on the way!</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Order Confirmed!
        
        Hi {{name}},
        
        Your order has been confirmed and is being prepared for delivery.
        
        Order Details:
        - Order Number: {{orderNumber}}
        - Order Date: {{orderDate}}
        - Total Amount: {{totalAmount}}
        - Estimated Delivery: {{estimatedDelivery}}
        
        Track your order: {{trackUrl}}
        
        We'll notify you when your order is on the way!
        
        Best regards,
        The QuickLocal Team
      `
    };
  }

  getOrderShippedTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Shipped</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #6366f1;">Your order is on the way! 📦</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>Great news! Your order is now on its way to you.</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Delivery Details:</h3>
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Estimated Delivery:</strong> {{estimatedDelivery}}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{trackUrl}}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Track Delivery</a>
            </div>
            
            <p>You can track your delivery in real-time using the link above.</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Your order is on the way!
        
        Hi {{name}},
        
        Great news! Your order is now on its way to you.
        
        Delivery Details:
        - Order Number: {{orderNumber}}
        - Estimated Delivery: {{estimatedDelivery}}
        
        Track your delivery: {{trackUrl}}
        
        You can track your delivery in real-time using the link above.
        
        Best regards,
        The QuickLocal Team
      `
    };
  }

  getOrderDeliveredTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Delivered</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #6366f1;">Your order has been delivered! ✅</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>Your order has been successfully delivered to your doorstep.</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Delivery Details:</h3>
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Delivery Date:</strong> {{deliveryDate}}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{reviewUrl}}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Leave a Review</a>
            </div>
            
            <p>We hope you love your purchase! Please take a moment to leave a review.</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Your order has been delivered!
        
        Hi {{name}},
        
        Your order has been successfully delivered to your doorstep.
        
        Delivery Details:
        - Order Number: {{orderNumber}}
        - Delivery Date: {{deliveryDate}}
        
        Leave a review: {{reviewUrl}}
        
        We hope you love your purchase! Please take a moment to leave a review.
        
        Best regards,
        The QuickLocal Team
      `
    };
  }

  getPasswordResetTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Reset Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #6366f1;">Reset Your Password</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{resetUrl}}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a>
            </div>
            
            <p>This link will expire in {{expiryTime}}. If you didn't request this password reset, you can safely ignore this email.</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Reset Your Password
        
        Hi {{name}},
        
        We received a request to reset your password. Click the link below to create a new password:
        
        {{resetUrl}}
        
        This link will expire in {{expiryTime}}. If you didn't request this password reset, you can safely ignore this email.
        
        Best regards,
        The QuickLocal Team
      `
    };
  }

  getEmailVerificationTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Verify Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #6366f1;">Verify Your Email</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>Please verify your email address by clicking the button below:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{verifyUrl}}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Verify Email</a>
            </div>
            
            <p>This link will expire in {{expiryTime}}.</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Verify Your Email
        
        Hi {{name}},
        
        Please verify your email address by clicking the link below:
        
        {{verifyUrl}}
        
        This link will expire in {{expiryTime}}.
        
        Best regards,
        The QuickLocal Team
      `
    };
  }

  getReturnRequestTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Return Request Submitted</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #6366f1;">Return Request Submitted</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>We've received your return request and will review it within 1-2 business days.</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Return Details:</h3>
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Return Reason:</strong> {{returnReason}}</p>
              <p><strong>Return ID:</strong> {{returnId}}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{statusUrl}}" style="background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Check Status</a>
            </div>
            
            <p>We'll notify you once your return request has been reviewed.</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Return Request Submitted
        
        Hi {{name}},
        
        We've received your return request and will review it within 1-2 business days.
        
        Return Details:
        - Order Number: {{orderNumber}}
        - Return Reason: {{returnReason}}
        - Return ID: {{returnId}}
        
        Check status: {{statusUrl}}
        
        We'll notify you once your return request has been reviewed.
        
        Best regards,
        The QuickLocal Team
      `
    };
  }

  getRefundProcessedTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Refund Processed</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #6366f1;">Refund Processed</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>Your refund has been processed successfully.</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Refund Details:</h3>
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Refund Amount:</strong> {{refundAmount}}</p>
              <p><strong>Refund Method:</strong> {{refundMethod}}</p>
              <p><strong>Estimated Time:</strong> {{estimatedTime}}</p>
            </div>
            
            <p>The refund will appear in your account within the estimated time frame.</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Refund Processed
        
        Hi {{name}},
        
        Your refund has been processed successfully.
        
        Refund Details:
        - Order Number: {{orderNumber}}
        - Refund Amount: {{refundAmount}}
        - Refund Method: {{refundMethod}}
        - Estimated Time: {{estimatedTime}}
        
        The refund will appear in your account within the estimated time frame.
        
        Best regards,
        The QuickLocal Team
      `
    };
  }

  getSecurityAlertTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Security Alert</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #ef4444;">Security Alert</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>We detected unusual activity on your account.</p>
            
            <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Activity Details:</h3>
              <p><strong>Alert Type:</strong> {{alertType}}</p>
              <p><strong>Time:</strong> {{alertTime}}</p>
              <p><strong>Device:</strong> {{deviceInfo}}</p>
              <p><strong>Location:</strong> {{location}}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{actionUrl}}" style="background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Review Account</a>
            </div>
            
            <p>If this wasn't you, please secure your account immediately.</p>
            
            <p>Best regards,<br>The QuickLocal Security Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Security Alert
        
        Hi {{name}},
        
        We detected unusual activity on your account.
        
        Activity Details:
        - Alert Type: {{alertType}}
        - Time: {{alertTime}}
        - Device: {{deviceInfo}}
        - Location: {{location}}
        
        Review account: {{actionUrl}}
        
        If this wasn't you, please secure your account immediately.
        
        Best regards,
        The QuickLocal Security Team
      `
    };
  }

  getAccountSuspendedTemplate() {
    return {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Account Suspended</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #ef4444;">Account Suspended</h1>
            </div>
            
            <p>Hi {{name}},</p>
            
            <p>Your account has been temporarily suspended due to a violation of our terms of service.</p>
            
            <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Reason:</h3>
              <p>{{reason}}</p>
              <p><strong>Duration:</strong> {{duration}}</p>
            </div>
            
            <p>If you believe this is an error, please contact our support team.</p>
            
            <p>Best regards,<br>The QuickLocal Team</p>
          </div>
        </body>
        </html>
      `,
      text: `
        Account Suspended
        
        Hi {{name}},
        
        Your account has been temporarily suspended due to a violation of our terms of service.
        
        Reason: {{reason}}
        Duration: {{duration}}
        
        If you believe this is an error, please contact our support team.
        
        Best regards,
        The QuickLocal Team
      `
    };
  }
}

module.exports = new EmailService();