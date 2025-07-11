const nodemailer = require('nodemailer');
const config = require('../config/config'); // Updated to correct path

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.username,
        pass: config.email.password
      },
      requireTLS: config.email.requireTLS
    });
  }

  async sendEmail(to, subject, text, html) {
    try {
      const mailOptions = {
        from: config.email.from,
        to,
        subject,
        text,
        html
      };

      for (let i = 0; i < config.email.retryAttempts; i++) {
        try {
          await this.transporter.sendMail(mailOptions);
          return { status: 'success', message: 'Email sent successfully' };
        } catch (err) {
          if (i === config.email.retryAttempts - 1) {
            throw err;
          }
        }
      }
    } catch (err) {
      throw new Error(`Failed to send email: ${err.message}`);
    }
  }

  async sendVerificationEmail(to, token) {
    const subject = 'Verify Your Email - MyStore';
    const verificationUrl = `${config.clientUrl}/verify-email?token=${token}`;
    const text = `Please verify your email by clicking this link: ${verificationUrl}`;
    const html = `<p>Please verify your email by clicking <a href="${verificationUrl}">here</a>.</p>`;

    return this.sendEmail(to, subject, text, html);
  }

  async sendPasswordResetEmail(to, token) {
    const subject = 'Reset Your Password - MyStore';
    const resetUrl = `${config.clientUrl}/reset-password?token=${token}`;
    const text = `Reset your password by clicking this link: ${resetUrl}`;
    const html = `<p>Reset your password by clicking <a href="${resetUrl}">here</a>.</p>`;

    return this.sendEmail(to, subject, text, html);
  }
}

module.exports = new EmailService();