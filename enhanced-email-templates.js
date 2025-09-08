const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Enhanced Email Template System
class EmailTemplateService {
  
  constructor() {
    this.transporter = this.createTransporter();
    this.templates = this.loadTemplates();
  }

  createTransporter() {
    return nodemailer.createTransporter({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  loadTemplates() {
    return {
      // User Registration & Authentication
      welcome: {
        subject: "Welcome to QuickLocal Marketplace! 🎉",
        template: this.getWelcomeTemplate()
      },
      
      emailVerification: {
        subject: "Verify Your Email Address",
        template: this.getEmailVerificationTemplate()
      },

      passwordReset: {
        subject: "Reset Your Password - QuickLocal",
        template: this.getPasswordResetTemplate()
      },

      // Order Management
      orderConfirmation: {
        subject: "Order Confirmed! #{{orderNumber}}",
        template: this.getOrderConfirmationTemplate()
      },

      orderShipped: {
        subject: "Your Order is on the Way! #{{orderNumber}}",
        template: this.getOrderShippedTemplate()
      },

      orderDelivered: {
        subject: "Order Delivered Successfully! #{{orderNumber}}",
        template: this.getOrderDeliveredTemplate()
      },

      orderCancelled: {
        subject: "Order Cancellation Confirmation #{{orderNumber}}",
        template: this.getOrderCancelledTemplate()
      },

      // Seller Communications
      sellerWelcome: {
        subject: "Welcome to QuickLocal Seller Platform!",
        template: this.getSellerWelcomeTemplate()
      },

      productApproved: {
        subject: "Product Approved: {{productName}}",
        template: this.getProductApprovedTemplate()
      },

      productRejected: {
        subject: "Product Review Required: {{productName}}",
        template: this.getProductRejectedTemplate()
      },

      lowStock: {
        subject: "Low Stock Alert: {{productName}}",
        template: this.getLowStockTemplate()
      },

      // Customer Service
      supportTicket: {
        subject: "Support Ticket Created #{{ticketNumber}}",
        template: this.getSupportTicketTemplate()
      },

      refundProcessed: {
        subject: "Refund Processed - #{{orderNumber}}",
        template: this.getRefundProcessedTemplate()
      },

      // Marketing & Promotions
      newsletter: {
        subject: "{{subject}}",
        template: this.getNewsletterTemplate()
      },

      promotional: {
        subject: "🎊 Special Offer: {{offerTitle}}",
        template: this.getPromotionalTemplate()
      },

      // Administrative
      dailyReport: {
        subject: "Daily Sales Report - {{date}}",
        template: this.getDailyReportTemplate()
      }
    };
  }

  // Base template wrapper
  getBaseTemplate() {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>{{subject}}</title>
          <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                  line-height: 1.6;
                  background-color: #f4f6f9;
                  margin: 0;
                  padding: 20px;
              }
              .email-container {
                  max-width: 600px;
                  margin: 0 auto;
                  background: #ffffff;
                  border-radius: 12px;
                  overflow: hidden;
                  box-shadow: 0 8px 32px rgba(0,0,0,0.08);
              }
              .header {
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  padding: 40px 30px;
                  text-align: center;
              }
              .header h1 {
                  font-size: 28px;
                  font-weight: 600;
                  margin-bottom: 8px;
              }
              .header p {
                  font-size: 16px;
                  opacity: 0.9;
              }
              .content {
                  padding: 40px 30px;
              }
              .content h2 {
                  color: #2d3748;
                  font-size: 22px;
                  margin-bottom: 20px;
              }
              .content p {
                  color: #4a5568;
                  font-size: 16px;
                  margin-bottom: 16px;
              }
              .button {
                  display: inline-block;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  padding: 16px 32px;
                  text-decoration: none;
                  border-radius: 8px;
                  font-weight: 600;
                  font-size: 16px;
                  margin: 20px 0;
                  transition: all 0.3s ease;
                  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
              }
              .button:hover {
                  transform: translateY(-2px);
                  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
              }
              .order-summary {
                  background: #f7fafc;
                  border: 1px solid #e2e8f0;
                  border-radius: 8px;
                  padding: 24px;
                  margin: 24px 0;
              }
              .order-item {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 12px 0;
                  border-bottom: 1px solid #e2e8f0;
              }
              .order-item:last-child { border-bottom: none; }
              .order-total {
                  font-weight: 700;
                  font-size: 18px;
                  color: #2d3748;
                  border-top: 2px solid #e2e8f0;
                  padding-top: 16px;
                  margin-top: 16px;
              }
              .info-box {
                  background: #ebf8ff;
                  border: 1px solid #90cdf4;
                  border-radius: 8px;
                  padding: 20px;
                  margin: 20px 0;
              }
              .warning-box {
                  background: #fef5e7;
                  border: 1px solid #f6ad55;
                  border-radius: 8px;
                  padding: 20px;
                  margin: 20px 0;
              }
              .success-box {
                  background: #f0fff4;
                  border: 1px solid #68d391;
                  border-radius: 8px;
                  padding: 20px;
                  margin: 20px 0;
              }
              .footer {
                  background: #2d3748;
                  color: #a0aec0;
                  padding: 30px;
                  text-align: center;
                  font-size: 14px;
              }
              .footer a {
                  color: #667eea;
                  text-decoration: none;
              }
              .social-links {
                  margin: 20px 0;
              }
              .social-links a {
                  display: inline-block;
                  margin: 0 10px;
                  color: #667eea;
                  text-decoration: none;
              }
              @media (max-width: 600px) {
                  body { padding: 10px; }
                  .email-container { border-radius: 0; }
                  .header, .content, .footer { padding: 20px; }
                  .button { display: block; text-align: center; }
              }
          </style>
      </head>
      <body>
          <div class="email-container">
              {{content}}
              <div class="footer">
                  <div class="social-links">
                      <a href="${process.env.FRONTEND_URL}">Website</a>
                      <a href="${process.env.FRONTEND_URL}/support">Support</a>
                      <a href="${process.env.FRONTEND_URL}/contact">Contact</a>
                  </div>
                  <p>&copy; ${new Date().getFullYear()} QuickLocal Marketplace. All rights reserved.</p>
                  <p>
                      <a href="${process.env.FRONTEND_URL}/unsubscribe?email={{email}}">Unsubscribe</a> |
                      <a href="${process.env.FRONTEND_URL}/privacy">Privacy Policy</a>
                  </p>
              </div>
          </div>
      </body>
      </html>
    `;
  }

  // Welcome Email Template
  getWelcomeTemplate() {
    return `
      <div class="header">
          <h1>🎉 Welcome to QuickLocal!</h1>
          <p>Your marketplace journey begins here</p>
      </div>
      <div class="content">
          <h2>Hi {{name}},</h2>
          <p>Welcome to QuickLocal Marketplace! We're thrilled to have you join our community of shoppers and sellers.</p>
          
          <div class="info-box">
              <h3>🛍️ What you can do now:</h3>
              <ul>
                  <li>Discover thousands of products from local sellers</li>
                  <li>Create your wishlist and get notified about deals</li>
                  <li>Track your orders in real-time</li>
                  <li>Join our seller program and start your own business</li>
              </ul>
          </div>

          <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}?welcome=true" class="button">
                  🚀 Start Shopping
              </a>
          </div>

          <p>If you have any questions, our support team is here to help 24/7.</p>
          
          <p>Happy shopping!</p>
          <p><strong>The QuickLocal Team</strong></p>
      </div>
    `;
  }

  // Email Verification Template
  getEmailVerificationTemplate() {
    return `
      <div class="header">
          <h1>📧 Verify Your Email</h1>
          <p>One quick step to complete your registration</p>
      </div>
      <div class="content">
          <h2>Hi {{name}},</h2>
          <p>Thanks for signing up! Please verify your email address to activate your account.</p>
          
          <div style="text-align: center;">
              <a href="{{verificationUrl}}" class="button">
                  ✅ Verify Email Address
              </a>
          </div>

          <div class="info-box">
              <p><strong>This link expires in 24 hours.</strong></p>
              <p>If you didn't create this account, please ignore this email.</p>
          </div>

          <p>Once verified, you'll have full access to all QuickLocal features.</p>
      </div>
    `;
  }

  // Password Reset Template
  getPasswordResetTemplate() {
    return `
      <div class="header">
          <h1>🔐 Reset Your Password</h1>
          <p>Secure password reset request</p>
      </div>
      <div class="content">
          <h2>Hi {{name}},</h2>
          <p>We received a request to reset your password. If you made this request, click the button below:</p>
          
          <div style="text-align: center;">
              <a href="{{resetUrl}}" class="button">
                  🔓 Reset Password
              </a>
          </div>

          <div class="warning-box">
              <p><strong>This link expires in 1 hour for security.</strong></p>
              <p>If you didn't request this, please ignore this email. Your password remains unchanged.</p>
          </div>

          <p>For account security, never share this link with anyone.</p>
      </div>
    `;
  }

  // Order Confirmation Template
  getOrderConfirmationTemplate() {
    return `
      <div class="header">
          <h1>🎉 Order Confirmed!</h1>
          <p>Thank you for your purchase</p>
      </div>
      <div class="content">
          <h2>Hi {{customerName}},</h2>
          <p>Your order has been confirmed and is being prepared for shipment.</p>
          
          <div class="order-summary">
              <h3>Order #{{orderNumber}}</h3>
              <p><strong>Order Date:</strong> {{orderDate}}</p>
              <p><strong>Estimated Delivery:</strong> {{estimatedDelivery}}</p>
              
              {{#each items}}
              <div class="order-item">
                  <div>
                      <strong>{{name}}</strong><br>
                      <small>Quantity: {{quantity}}</small>
                  </div>
                  <div>${{price}}</div>
              </div>
              {{/each}}
              
              <div class="order-total">
                  <div class="order-item">
                      <div>Total</div>
                      <div>${{total}}</div>
                  </div>
              </div>
          </div>

          <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/orders/{{orderNumber}}" class="button">
                  📦 Track Your Order
              </a>
          </div>

          <div class="info-box">
              <p><strong>What happens next?</strong></p>
              <ul>
                  <li>We'll send you shipping updates via email</li>
                  <li>You can track your package anytime</li>
                  <li>Questions? Contact our support team</li>
              </ul>
          </div>
      </div>
    `;
  }

  // Order Shipped Template
  getOrderShippedTemplate() {
    return `
      <div class="header">
          <h1>📦 Your Order is Shipped!</h1>
          <p>Package is on its way</p>
      </div>
      <div class="content">
          <h2>Great news, {{customerName}}!</h2>
          <p>Your order #{{orderNumber}} has been shipped and is on its way to you.</p>
          
          <div class="success-box">
              <h3>📋 Shipping Details</h3>
              <p><strong>Tracking Number:</strong> {{trackingNumber}}</p>
              <p><strong>Carrier:</strong> {{carrier}}</p>
              <p><strong>Estimated Delivery:</strong> {{estimatedDelivery}}</p>
              <p><strong>Shipping Address:</strong><br>{{shippingAddress}}</p>
          </div>

          <div style="text-align: center;">
              <a href="{{trackingUrl}}" class="button">
                  🚚 Track Package
              </a>
          </div>

          <p>You'll receive another email when your package is delivered.</p>
      </div>
    `;
  }

  // Order Delivered Template
  getOrderDeliveredTemplate() {
    return `
      <div class="header">
          <h1>🎊 Order Delivered!</h1>
          <p>Your package has arrived</p>
      </div>
      <div class="content">
          <h2>Fantastic, {{customerName}}!</h2>
          <p>Your order #{{orderNumber}} has been successfully delivered.</p>
          
          <div class="success-box">
              <p><strong>Delivered on:</strong> {{deliveryDate}}</p>
              <p><strong>Delivered to:</strong> {{deliveryLocation}}</p>
          </div>

          <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/orders/{{orderNumber}}/review" class="button">
                  ⭐ Leave a Review
              </a>
          </div>

          <p>We hope you love your purchase! If you have any issues, please don't hesitate to contact us.</p>
          
          <div class="info-box">
              <p><strong>Need help?</strong></p>
              <p>Return or exchange within 30 days | Questions? Contact support</p>
          </div>
      </div>
    `;
  }

  // Low Stock Alert Template  
  getLowStockTemplate() {
    return `
      <div class="header">
          <h1>⚠️ Low Stock Alert</h1>
          <p>Product inventory needs attention</p>
      </div>
      <div class="content">
          <h2>Hi {{sellerName}},</h2>
          <p>Your product <strong>{{productName}}</strong> is running low on stock.</p>
          
          <div class="warning-box">
              <h3>📊 Current Status</h3>
              <p><strong>Current Stock:</strong> {{currentStock}} units</p>
              <p><strong>Recommended Action:</strong> Restock soon to avoid stockouts</p>
          </div>

          <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/seller/products/{{productId}}/edit" class="button">
                  📦 Update Stock
              </a>
          </div>

          <p>Maintaining adequate stock levels helps ensure consistent sales and customer satisfaction.</p>
      </div>
    `;
  }

  // Newsletter Template
  getNewsletterTemplate() {
    return `
      <div class="header">
          <h1>{{title}}</h1>
          <p>{{subtitle}}</p>
      </div>
      <div class="content">
          {{content}}
          
          <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}" class="button">
                  🛍️ Shop Now
              </a>
          </div>
      </div>
    `;
  }

  // Send email with template
  async sendEmail(templateType, recipientEmail, data = {}) {
    try {
      const template = this.templates[templateType];
      if (!template) {
        throw new Error(`Template '${templateType}' not found`);
      }

      // Merge data with template
      const subject = this.replaceVariables(template.subject, data);
      const content = this.replaceVariables(template.template, data);
      const fullHtml = this.replaceVariables(this.getBaseTemplate(), {
        ...data,
        subject,
        content,
        email: recipientEmail
      });

      const mailOptions = {
        from: `"QuickLocal Marketplace" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: recipientEmail,
        subject: subject,
        html: fullHtml
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', templateType, 'to:', recipientEmail);
      return result;

    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  // Replace template variables
  replaceVariables(template, data) {
    return template.replace(/{{(\w+)}}/g, (match, key) => {
      return data[key] || match;
    });
  }

  // Send bulk emails
  async sendBulkEmails(templateType, recipients, commonData = {}) {
    const results = [];
    
    for (const recipient of recipients) {
      try {
        const data = { ...commonData, ...recipient };
        const result = await this.sendEmail(templateType, recipient.email, data);
        results.push({ email: recipient.email, success: true, result });
      } catch (error) {
        results.push({ email: recipient.email, success: false, error: error.message });
      }
    }

    return results;
  }

  // Email verification helper
  async sendVerificationEmail(email, name, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
    
    return this.sendEmail('emailVerification', email, {
      name,
      verificationUrl
    });
  }

  // Password reset helper
  async sendPasswordResetEmail(email, name, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    return this.sendEmail('passwordReset', email, {
      name,
      resetUrl
    });
  }

  // Order confirmation helper
  async sendOrderConfirmation(order) {
    return this.sendEmail('orderConfirmation', order.customerEmail, {
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      orderDate: new Date(order.createdAt).toLocaleDateString(),
      estimatedDelivery: order.estimatedDelivery,
      items: order.items,
      total: order.total.toFixed(2)
    });
  }

  // Welcome email helper
  async sendWelcomeEmail(email, name) {
    return this.sendEmail('welcome', email, { name });
  }
}

// Export the service
module.exports = EmailTemplateService;

// Routes for email management (admin)
const emailRoutes = (router) => {
  const emailService = new EmailTemplateService();

  // Send test email
  router.post('/admin/email/test', async (req, res) => {
    try {
      const { templateType, email, data } = req.body;
      
      await emailService.sendEmail(templateType, email, data);
      
      res.json({
        success: true,
        message: 'Test email sent successfully'
      });

    } catch (error) {
      console.error('Test email error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send test email',
        error: error.message
      });
    }
  });

  // Send bulk newsletter
  router.post('/admin/email/newsletter', async (req, res) => {
    try {
      const { subject, content, recipients } = req.body;
      
      const results = await emailService.sendBulkEmails('newsletter', recipients, {
        title: subject,
        subtitle: 'Latest news and updates',
        content: content
      });
      
      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;

      res.json({
        success: true,
        message: `Newsletter sent to ${successful} recipients`,
        failed,
        results
      });

    } catch (error) {
      console.error('Newsletter error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send newsletter'
      });
    }
  });

  return router;
};

module.exports = { EmailTemplateService, emailRoutes };
