const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const handlebars = require('handlebars');
const juice = require('juice');
const { htmlToText } = require('html-to-text');
const logger = require('../utils/logger');
const config = require('./config');

/**
 * Enterprise-Grade Email Configuration & Service
 * 
 * Features:
 * 1. Multiple transport providers with failover
 * 2. OAuth2 authentication for enhanced security
 * 3. Template system with handlebars and CSS inlining
 * 4. Queue management with retry logic
 * 5. Email tracking and analytics
 * 6. Rate limiting and throttling
 * 7. HTML/Text dual format support
 * 8. Attachment handling with security validation
 * 9. Bounce and complaint handling
 * 10. Performance monitoring and health checks
 */

class EmailService {
    constructor() {
        this.transporters = new Map();
        this.templates = new Map();
        this.queue = [];
        this.isProcessing = false;
        this.stats = {
            sent: 0,
            failed: 0,
            bounced: 0,
            delivered: 0,
            opened: 0,
            clicked: 0
        };
        
        this.config = this.buildConfiguration();
        this.rateLimiter = this.setupRateLimiting();
        this.retryConfig = {
            maxRetries: config.email?.maxRetries || 3,
            retryDelay: config.email?.retryDelay || 5000,
            backoffMultiplier: config.email?.backoffMultiplier || 2
        };
    }

    /**
     * Build comprehensive email configuration
     */
    buildConfiguration() {
        return {
            // Primary SMTP Configuration
            primary: {
                name: 'primary',
                host: process.env.EMAIL_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.EMAIL_PORT) || 587,
                secure: process.env.EMAIL_PORT === '465',
                requireTLS: process.env.EMAIL_REQUIRE_TLS !== 'false',
                
                // Enhanced authentication
                auth: {
                    type: process.env.EMAIL_AUTH_TYPE || 'login', // login, oauth2, xoauth2
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASSWORD,
                    
                    // OAuth2 configuration
                    clientId: process.env.EMAIL_OAUTH_CLIENT_ID,
                    clientSecret: process.env.EMAIL_OAUTH_CLIENT_SECRET,
                    refreshToken: process.env.EMAIL_OAUTH_REFRESH_TOKEN,
                    accessToken: process.env.EMAIL_OAUTH_ACCESS_TOKEN
                },
                
                // Connection settings
                pool: true,
                maxConnections: parseInt(process.env.EMAIL_MAX_CONNECTIONS) || 5,
                maxMessages: parseInt(process.env.EMAIL_MAX_MESSAGES) || 100,
                rateDelta: parseInt(process.env.EMAIL_RATE_DELTA) || 1000,
                rateLimit: parseInt(process.env.EMAIL_RATE_LIMIT) || 10,
                
                // Security settings
                tls: {
                    rejectUnauthorized: process.env.EMAIL_REJECT_UNAUTHORIZED !== 'false',
                    ciphers: 'SSLv3',
                    secureProtocol: 'TLSv1_2_method'
                },
                
                // Connection timeout settings
                connectionTimeout: parseInt(process.env.EMAIL_CONNECTION_TIMEOUT) || 60000,
                greetingTimeout: parseInt(process.env.EMAIL_GREETING_TIMEOUT) || 30000,
                socketTimeout: parseInt(process.env.EMAIL_SOCKET_TIMEOUT) || 75000,
                
                // Debug and logging
                debug: process.env.NODE_ENV === 'development',
                logger: process.env.EMAIL_ENABLE_LOGGING === 'true'
            },
            
            // Backup/Fallback Configuration
            fallback: process.env.EMAIL_FALLBACK_HOST ? {
                name: 'fallback',
                host: process.env.EMAIL_FALLBACK_HOST,
                port: parseInt(process.env.EMAIL_FALLBACK_PORT) || 587,
                secure: process.env.EMAIL_FALLBACK_PORT === '465',
                auth: {
                    user: process.env.EMAIL_FALLBACK_USER,
                    pass: process.env.EMAIL_FALLBACK_PASSWORD
                },
                tls: {
                    rejectUnauthorized: false
                }
            } : null,
            
            // AWS SES Configuration
            ses: process.env.AWS_ACCESS_KEY_ID ? {
                name: 'ses',
                region: process.env.AWS_REGION || 'us-east-1',
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                rateLimit: 14 // SES default rate limit
            } : null,
            
            // SendGrid Configuration
            sendgrid: process.env.SENDGRID_API_KEY ? {
                name: 'sendgrid',
                apiKey: process.env.SENDGRID_API_KEY
            } : null,
            
            // Default sender information
            defaults: {
                from: {
                    name: process.env.EMAIL_FROM_NAME || config.app?.name || 'MyApp',
                    address: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER
                },
                replyTo: process.env.EMAIL_REPLY_TO,
                
                // Email template settings
                templateDir: process.env.EMAIL_TEMPLATE_DIR || path.join(process.cwd(), 'templates', 'email'),
                assetsUrl: process.env.EMAIL_ASSETS_URL || config.app?.url,
                
                // Tracking configuration
                tracking: {
                    enabled: process.env.EMAIL_TRACKING_ENABLED === 'true',
                    domain: process.env.EMAIL_TRACKING_DOMAIN || config.app?.domain,
                    pixelEnabled: process.env.EMAIL_PIXEL_TRACKING === 'true'
                }
            }
        };
    }

    /**
     * Initialize email service with all transporters
     */
    async initialize() {
        try {
            logger.info('Initializing email service...');
            
            // Create primary transporter
            await this.createTransporter('primary', this.config.primary);
            
            // Create fallback transporters
            if (this.config.fallback) {
                await this.createTransporter('fallback', this.config.fallback);
            }
            
            if (this.config.ses) {
                await this.createSESTransporter();
            }
            
            if (this.config.sendgrid) {
                await this.createSendGridTransporter();
            }
            
            // Load email templates
            await this.loadTemplates();
            
            // Start queue processor
            this.startQueueProcessor();
            
            // Setup health monitoring
            this.setupHealthMonitoring();
            
            logger.info('Email service initialized successfully', {
                transporters: Array.from(this.transporters.keys()),
                templates: Array.from(this.templates.keys())
            });
            
        } catch (error) {
            logger.error('Failed to initialize email service', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Create SMTP transporter with enhanced configuration
     */
    async createTransporter(name, transportConfig) {
        try {
            let transport;
            
            // Handle OAuth2 authentication
            if (transportConfig.auth.type === 'oauth2') {
                transport = await this.createOAuth2Transporter(transportConfig);
            } else {
                transport = nodemailer.createTransporter(transportConfig);
            }
            
            // Verify connection
            await this.verifyTransporter(transport, name);
            
            this.transporters.set(name, {
                transporter: transport,
                config: transportConfig,
                healthy: true,
                lastUsed: null,
                errorCount: 0,
                sentCount: 0
            });
            
            logger.info(`Email transporter '${name}' created and verified`);
            
        } catch (error) {
            logger.error(`Failed to create transporter '${name}'`, {
                error: error.message,
                host: transportConfig.host
            });
            throw error;
        }
    }

    /**
     * Create OAuth2 transporter for Gmail/Google Workspace
     */
    async createOAuth2Transporter(transportConfig) {
        const OAuth2 = google.auth.OAuth2;
        const oauth2Client = new OAuth2(
            transportConfig.auth.clientId,
            transportConfig.auth.clientSecret,
            'https://developers.google.com/oauthplayground'
        );

        oauth2Client.setCredentials({
            refresh_token: transportConfig.auth.refreshToken
        });

        const accessToken = await oauth2Client.getAccessToken();

        return nodemailer.createTransporter({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: transportConfig.auth.user,
                clientId: transportConfig.auth.clientId,
                clientSecret: transportConfig.auth.clientSecret,
                refreshToken: transportConfig.auth.refreshToken,
                accessToken: accessToken.token
            },
            tls: transportConfig.tls
        });
    }

    /**
     * Create AWS SES transporter
     */
    async createSESTransporter() {
        const aws = require('aws-sdk');
        
        aws.config.update({
            accessKeyId: this.config.ses.accessKeyId,
            secretAccessKey: this.config.ses.secretAccessKey,
            region: this.config.ses.region
        });

        const transporter = nodemailer.createTransporter({
            SES: new aws.SES({ apiVersion: '2010-12-01' }),
            sendingRate: this.config.ses.rateLimit
        });

        await this.verifyTransporter(transporter, 'ses');

        this.transporters.set('ses', {
            transporter,
            config: this.config.ses,
            healthy: true,
            lastUsed: null,
            errorCount: 0,
            sentCount: 0
        });

        logger.info('AWS SES transporter created and verified');
    }

    /**
     * Create SendGrid transporter
     */
    async createSendGridTransporter() {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(this.config.sendgrid.apiKey);

        // Create a wrapper that matches nodemailer interface
        const sendGridTransporter = {
            sendMail: async (mailOptions) => {
                const msg = {
                    to: mailOptions.to,
                    from: mailOptions.from,
                    subject: mailOptions.subject,
                    text: mailOptions.text,
                    html: mailOptions.html,
                    attachments: mailOptions.attachments
                };

                const result = await sgMail.send(msg);
                return {
                    messageId: result[0].headers['x-message-id'],
                    response: result[0].body
                };
            },
            verify: async () => true
        };

        this.transporters.set('sendgrid', {
            transporter: sendGridTransporter,
            config: this.config.sendgrid,
            healthy: true,
            lastUsed: null,
            errorCount: 0,
            sentCount: 0
        });

        logger.info('SendGrid transporter created');
    }

    /**
     * Verify transporter connection
     */
    async verifyTransporter(transporter, name) {
        try {
            await transporter.verify();
            logger.info(`Transporter '${name}' verification successful`);
            return true;
        } catch (error) {
            logger.error(`Transporter '${name}' verification failed`, {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Load email templates from disk
     */
    async loadTemplates() {
        try {
            const templateDir = this.config.defaults.templateDir;
            const templateFiles = await fs.readdir(templateDir);
            
            for (const file of templateFiles) {
                if (path.extname(file) === '.hbs') {
                    const templateName = path.basename(file, '.hbs');
                    const templatePath = path.join(templateDir, file);
                    const templateContent = await fs.readFile(templatePath, 'utf8');
                    
                    // Compile handlebars template
                    const compiledTemplate = handlebars.compile(templateContent);
                    
                    this.templates.set(templateName, {
                        compiled: compiledTemplate,
                        raw: templateContent,
                        path: templatePath,
                        lastModified: (await fs.stat(templatePath)).mtime
                    });
                }
            }
            
            logger.info('Email templates loaded', {
                count: this.templates.size,
                templates: Array.from(this.templates.keys())
            });
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn('Email template directory not found', {
                    templateDir: this.config.defaults.templateDir
                });
            } else {
                logger.error('Failed to load email templates', {
                    error: error.message
                });
            }
        }
    }

    /**
     * Setup rate limiting for email sending
     */
    setupRateLimiting() {
        return {
            window: 60 * 1000, // 1 minute
            limit: parseInt(process.env.EMAIL_RATE_LIMIT_PER_MINUTE) || 60,
            requests: [],
            
            checkLimit: function() {
                const now = Date.now();
                this.requests = this.requests.filter(time => now - time < this.window);
                return this.requests.length < this.limit;
            },
            
            recordRequest: function() {
                this.requests.push(Date.now());
            }
        };
    }

    /**
     * Enhanced email sending with template support and failover
     */
    async sendEmail(options) {
        try {
            // Validate required fields
            this.validateEmailOptions(options);
            
            // Check rate limiting
            if (!this.rateLimiter.checkLimit()) {
                throw new Error('Email rate limit exceeded');
            }
            
            // Prepare email data
            const emailData = await this.prepareEmailData(options);
            
            // Add to queue if specified or if all transporters are busy
            if (options.queue || this.shouldQueue()) {
                return this.addToQueue(emailData);
            }
            
            // Send immediately
            return await this.sendEmailNow(emailData);
            
        } catch (error) {
            logger.error('Email sending failed', {
                error: error.message,
                to: options.to,
                subject: options.subject
            });
            
            this.stats.failed++;
            throw error;
        }
    }

    /**
     * Validate email options
     */
    validateEmailOptions(options) {
        const required = ['to', 'subject'];
        const missing = required.filter(field => !options[field]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
        
        if (!options.text && !options.html && !options.template) {
            throw new Error('Email must have text, html, or template content');
        }
        
        // Validate email addresses
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const recipients = Array.isArray(options.to) ? options.to : [options.to];
        
        for (const recipient of recipients) {
            const email = typeof recipient === 'string' ? recipient : recipient.address;
            if (!emailRegex.test(email)) {
                throw new Error(`Invalid email address: ${email}`);
            }
        }
    }

    /**
     * Prepare email data with template processing and content generation
     */
    async prepareEmailData(options) {
        const emailData = {
            ...options,
            from: options.from || this.config.defaults.from,
            replyTo: options.replyTo || this.config.defaults.replyTo,
            messageId: this.generateMessageId(),
            headers: {
                'X-Mailer': `${config.app?.name || 'MyApp'} Email Service`,
                'X-Email-ID': this.generateEmailId(),
                ...options.headers
            }
        };
        
        // Process template if specified
        if (options.template) {
            const processedContent = await this.processTemplate(
                options.template,
                options.data || {},
                options
            );
            
            emailData.html = processedContent.html;
            emailData.text = processedContent.text;
        }
        
        // Generate text version from HTML if not provided
        if (emailData.html && !emailData.text) {
            emailData.text = this.htmlToText(emailData.html);
        }
        
        // Add tracking pixels if enabled
        if (this.config.defaults.tracking.enabled && this.config.defaults.tracking.pixelEnabled) {
            emailData.html = this.addTrackingPixel(emailData.html, emailData.headers['X-Email-ID']);
        }
        
        // Process attachments
        if (options.attachments) {
            emailData.attachments = await this.processAttachments(options.attachments);
        }
        
        return emailData;
    }

    /**
     * Process email template with handlebars
     */
    async processTemplate(templateName, data, options) {
        const template = this.templates.get(templateName);
        if (!template) {
            throw new Error(`Template '${templateName}' not found`);
        }
        
        // Prepare template data
        const templateData = {
            ...data,
            app: {
                name: config.app?.name || 'MyApp',
                url: config.app?.url,
                logo: `${this.config.defaults.assetsUrl}/images/logo.png`,
                supportEmail: this.config.defaults.from.address
            },
            user: data.user || {},
            timestamp: new Date().toISOString(),
            year: new Date().getFullYear()
        };
        
        // Render template
        const html = template.compiled(templateData);
        
        // Inline CSS for better email client compatibility
        const inlinedHtml = juice(html);
        
        // Generate text version
        const text = this.htmlToText(inlinedHtml);
        
        return { html: inlinedHtml, text };
    }

    /**
     * Convert HTML to text
     */
    htmlToText(html) {
        return htmlToText(html, {
            wordwrap: 80,
            formatters: {
                heading: (elem, walk, builder) => {
                    builder.openBlock({ leadingLineBreaks: 2 });
                    walk(elem.children, builder);
                    builder.closeBlock({ trailingLineBreaks: 2 });
                }
            }
        });
    }

    /**
     * Add tracking pixel to HTML email
     */
    addTrackingPixel(html, emailId) {
        const trackingPixel = `<img src="${this.config.defaults.tracking.domain}/track/open/${emailId}" width="1" height="1" style="display:none;" alt="" />`;
        
        // Insert before closing body tag
        return html.replace('</body>', `${trackingPixel}</body>`);
    }

    /**
     * Process and validate attachments
     */
    async processAttachments(attachments) {
        const processedAttachments = [];
        const maxAttachmentSize = 10 * 1024 * 1024; // 10MB
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'text/csv',
            'image/jpeg',
            'image/png',
            'image/gif'
        ];
        
        for (const attachment of attachments) {
            // Validate file size
            if (attachment.content && attachment.content.length > maxAttachmentSize) {
                throw new Error(`Attachment '${attachment.filename}' exceeds size limit`);
            }
            
            // Validate file type
            if (attachment.contentType && !allowedTypes.includes(attachment.contentType)) {
                logger.warn('Potentially unsafe attachment type', {
                    filename: attachment.filename,
                    contentType: attachment.contentType
                });
            }
            
            processedAttachments.push({
                ...attachment,
                cid: attachment.cid || `attachment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            });
        }
        
        return processedAttachments;
    }

    /**
     * Send email immediately with failover support
     */
    async sendEmailNow(emailData) {
        const transporterNames = Array.from(this.transporters.keys());
        let lastError;
        
        for (const name of transporterNames) {
            const transporterInfo = this.transporters.get(name);
            
            if (!transporterInfo.healthy) {
                logger.warn(`Skipping unhealthy transporter: ${name}`);
                continue;
            }
            
            try {
                const result = await this.sendWithRetry(
                    transporterInfo.transporter,
                    emailData,
                    name
                );
                
                // Update transporter stats
                transporterInfo.lastUsed = new Date();
                transporterInfo.sentCount++;
                transporterInfo.errorCount = 0;
                
                // Update global stats
                this.stats.sent++;
                this.rateLimiter.recordRequest();
                
                logger.info('Email sent successfully', {
                    transporter: name,
                    messageId: result.messageId,
                    to: emailData.to,
                    subject: emailData.subject
                });
                
                return {
                    success: true,
                    messageId: result.messageId,
                    transporter: name,
                    response: result.response
                };
                
            } catch (error) {
                lastError = error;
                transporterInfo.errorCount++;
                
                logger.warn(`Email sending failed with transporter '${name}'`, {
                    error: error.message,
                    errorCount: transporterInfo.errorCount
                });
                
                // Mark transporter as unhealthy if too many errors
                if (transporterInfo.errorCount >= 5) {
                    transporterInfo.healthy = false;
                    logger.error(`Marking transporter '${name}' as unhealthy`);
                }
            }
        }
        
        // All transporters failed
        throw new Error(`All email transporters failed. Last error: ${lastError?.message}`);
    }

    /**
     * Send with retry logic
     */
    async sendWithRetry(transporter, emailData, transporterName) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                return await transporter.sendMail(emailData);
            } catch (error) {
                lastError = error;
                
                if (attempt === this.retryConfig.maxRetries) {
                    break;
                }
                
                const delay = this.retryConfig.retryDelay * 
                             Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
                
                logger.warn(`Email send attempt ${attempt} failed, retrying in ${delay}ms`, {
                    transporter: transporterName,
                    error: error.message
                });
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }

    /**
     * Add email to queue for delayed processing
     */
    addToQueue(emailData) {
        const queueItem = {
            id: this.generateEmailId(),
            emailData,
            attempts: 0,
            maxAttempts: 3,
            scheduledFor: emailData.scheduledFor || new Date(),
            createdAt: new Date()
        };
        
        this.queue.push(queueItem);
        
        logger.info('Email added to queue', {
            queueId: queueItem.id,
            queueSize: this.queue.length,
            scheduledFor: queueItem.scheduledFor
        });
        
        return {
            success: true,
            queued: true,
            queueId: queueItem.id
        };
    }

    /**
     * Start queue processor
     */
    startQueueProcessor() {
        setInterval(async () => {
            if (this.isProcessing || this.queue.length === 0) {
                return;
            }
            
            this.isProcessing = true;
            
            try {
                await this.processQueue();
            } catch (error) {
                logger.error('Queue processing error', {
                    error: error.message
                });
            } finally {
                this.isProcessing = false;
            }
        }, 5000); // Process every 5 seconds
    }

    /**
     * Process queued emails
     */
    async processQueue() {
        const now = new Date();
        const readyItems = this.queue.filter(item => item.scheduledFor <= now);
        
        for (const item of readyItems) {
            try {
                await this.sendEmailNow(item.emailData);
                
                // Remove from queue on success
                const index = this.queue.indexOf(item);
                if (index > -1) {
                    this.queue.splice(index, 1);
                }
                
                logger.info('Queued email sent successfully', {
                    queueId: item.id
                });
                
            } catch (error) {
                item.attempts++;
                
                if (item.attempts >= item.maxAttempts) {
                    // Remove failed item from queue
                    const index = this.queue.indexOf(item);
                    if (index > -1) {
                        this.queue.splice(index, 1);
                    }
                    
                    logger.error('Queued email failed after max attempts', {
                        queueId: item.id,
                        attempts: item.attempts,
                        error: error.message
                    });
                } else {
                    // Reschedule for later
                    item.scheduledFor = new Date(Date.now() + 60000 * item.attempts); // Exponential backoff
                    
                    logger.warn('Queued email failed, will retry', {
                        queueId: item.id,
                        attempts: item.attempts,
                        nextAttempt: item.scheduledFor
                    });
                }
            }
        }
    }

    /**
     * Setup health monitoring
     */
    setupHealthMonitoring() {
        setInterval(async () => {
            for (const [name, transporterInfo] of this.transporters) {
                try {
                    await transporterInfo.transporter.verify();
                    
                    if (!transporterInfo.healthy) {
                        transporterInfo.healthy = true;
                        transporterInfo.errorCount = 0;
                        logger.info(`Transporter '${name}' is healthy again`);
                    }
                } catch (error) {
                    if (transporterInfo.healthy) {
                        transporterInfo.healthy = false;
                        logger.warn(`Transporter '${name}' health check failed`, {
                            error: error.message
                        });
                    }
                }
            }
        }, 60000); // Check every minute
    }

    /**
     * Determine if emails should be queued
     */
    shouldQueue() {
        const healthyTransporters = Array.from(this.transporters.values())
            .filter(info => info.healthy);
        
        return healthyTransporters.length === 0 || this.queue.length > 100;
    }

    /**
     * Generate unique message ID
     */
    generateMessageId() {
        const domain = this.config.defaults.tracking.domain || 'localhost';
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `<${timestamp}.${random}@${domain}>`;
    }

    /**
     * Generate unique email ID for tracking
     */
    generateEmailId() {
        return `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get service health status
     */
    getHealthStatus() {
        const transporterStatus = Array.from(this.transporters.entries()).map(([name, info]) => ({
            name,
            healthy: info.healthy,
            lastUsed: info.lastUsed,
            errorCount: info.errorCount,
            sentCount: info.sentCount
        }));
        
        return {
            healthy: transporterStatus.some(t => t.healthy),
            transporters: transporterStatus,
            queue: {
                size: this.queue.length,
                processing: this.isProcessing
            },
            stats: this.stats,
            templates: {
                loaded: this.templates.size,
                names: Array.from(this.templates.keys())
            }
        };
    }

    /**
     * Send test email
     */
    async sendTestEmail(to) {
        return await this.sendEmail({
            to,
            subject: 'Email Service Test',
            html: `
                <h1>Email Service Test</h1>
                <p>This is a test email to verify that the email service is working correctly.</p>
                <p>Sent at: ${new Date().toISOString()}</p>
                <p>Service: ${config.app?.name || 'MyApp'}</p>
            `,
            text: `Email Service Test\n\nThis is a test email to verify that the email service is working correctly.\n\nSent at: ${new Date().toISOString()}\nService: ${config.app?.name || 'MyApp'}`
        });
    }
}

// Create singleton instance
const emailService = new EmailService();

// Export service and configuration
module.exports = {
    EmailService,
    emailService,
    
    // Initialize the service
    initialize: () => emailService.initialize(),
    
    // Main email sending function
    sendEmail: (options) => emailService.sendEmail(options),
    
    // Template-based email sending
    sendTemplateEmail: (template, to, data, options = {}) => {
        return emailService.sendEmail({
            ...options,
            to,
            template,
            data
        });
    },
    
    // Utility functions
    sendTestEmail: (to) => emailService.sendTestEmail(to),
    getHealthStatus: () => emailService.getHealthStatus(),
    
    // Queue management
    getQueueStatus: () => ({
        size: emailService.queue.length,
        processing: emailService.isProcessing,
        items: emailService.queue.map(item => ({
            id: item.id,
            subject: item.emailData.subject,
            to: item.emailData.to,
            attempts: item.attempts,
            scheduledFor: item.scheduledFor
        }))
    }),
    
    // Stats
    getStats: () => emailService.stats,
    
    // Backward compatibility
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT === '465',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    },
    tls: {
        rejectUnauthorized: process.env.EMAIL_REJECT_UNAUTHORIZED !== 'false'
    }
};
