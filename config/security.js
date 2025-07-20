const crypto = require('crypto');

/**
 * Enterprise-Grade Security Configuration
 * 
 * Features:
 * 1. Comprehensive CORS and CSP policies
 * 2. Advanced authentication and authorization
 * 3. Input validation and sanitization
 * 4. Rate limiting and DDoS protection
 * 5. Security headers and HTTP hardening
 * 6. Encryption and data protection
 * 7. Audit logging and compliance
 * 8. Threat detection and response
 */

module.exports = {
    // CORS (Cross-Origin Resource Sharing) Configuration
    cors: {
        // Production CORS settings
        production: {
            origin: process.env.CORS_ORIGINS?.split(',') || [
                'https://mystore.com',
                'https://www.mystore.com',
                'https://admin.mystore.com',
                'https://app.mystore.com'
            ],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            allowedHeaders: [
                'Content-Type',
                'Authorization',
                'X-Requested-With',
                'X-Request-ID',
                'X-CSRF-Token',
                'X-API-Key',
                'Accept',
                'Origin'
            ],
            exposedHeaders: [
                'X-Request-ID',
                'X-Response-Time',
                'X-RateLimit-Limit',
                'X-RateLimit-Remaining',
                'X-RateLimit-Reset'
            ],
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204,
            maxAge: 86400 // 24 hours
        },
        
        // Development CORS settings
        development: {
            origin: [
                'http://localhost:3000',
                'http://localhost:3001',
                'http://localhost:8080',
                'http://127.0.0.1:3000',
                'http://0.0.0.0:3000'
            ],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: '*',
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204
        },
        
        // Test CORS settings
        test: {
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: '*',
            credentials: true
        }
    },
    
    // Content Security Policy (CSP)
    csp: {
        enabled: process.env.CSP_ENABLED !== 'false',
        reportOnly: process.env.CSP_REPORT_ONLY === 'true',
        
        // CSP directives
        directives: {
            defaultSrc: ["'self'"],
            
            // Script sources
            scriptSrc: [
                "'self'",
                "'unsafe-inline'", // Only if absolutely necessary
                'https://js.stripe.com',
                'https://checkout.stripe.com',
                'https://www.google-analytics.com',
                'https://www.googletagmanager.com'
            ],
            
            // Style sources
            styleSrc: [
                "'self'",
                "'unsafe-inline'", // Often needed for CSS frameworks
                'https://fonts.googleapis.com',
                'https://cdnjs.cloudflare.com'
            ],
            
            // Image sources
            imgSrc: [
                "'self'",
                'data:',
                'https:',
                'blob:',
                process.env.CDN_BASE_URL,
                'https://www.google-analytics.com'
            ].filter(Boolean),
            
            // Font sources
            fontSrc: [
                "'self'",
                'https://fonts.gstatic.com',
                'https://cdnjs.cloudflare.com'
            ],
            
            // Connect sources (AJAX, WebSocket, etc.)
            connectSrc: [
                "'self'",
                'https://api.stripe.com',
                'https://www.google-analytics.com',
                process.env.API_BASE_URL,
                process.env.WS_BASE_URL
            ].filter(Boolean),
            
            // Frame sources
            frameSrc: [
                "'none'"
            ],
            
            // Object sources
            objectSrc: ["'none'"],
            
            // Media sources
            mediaSrc: ["'self'"],
            
            // Worker sources
            workerSrc: ["'self'", 'blob:'],
            
            // Manifest sources
            manifestSrc: ["'self'"],
            
            // Base URI
            baseUri: ["'self'"],
            
            // Form action
            formAction: ["'self'"],
            
            // Frame ancestors
            frameAncestors: ["'none'"],
            
            // Upgrade insecure requests
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
        },
        
        // CSP reporting
        reportUri: process.env.CSP_REPORT_URI,
        reportTo: process.env.CSP_REPORT_TO
    },
    
    // HTTP Security Headers
    headers: {
        // Helmet configuration
        helmet: {
            // Content Security Policy
            contentSecurityPolicy: {
                useDefaults: false,
                directives: {
                    // Will be populated from CSP config above
                }
            },
            
            // Cross-Origin-Embedder-Policy
            crossOriginEmbedderPolicy: {
                policy: process.env.NODE_ENV === 'production' ? 'require-corp' : false
            },
            
            // Cross-Origin-Opener-Policy
            crossOriginOpenerPolicy: {
                policy: 'same-origin'
            },
            
            // Cross-Origin-Resource-Policy
            crossOriginResourcePolicy: {
                policy: 'cross-origin'
            },
            
            // HTTP Strict Transport Security
            hsts: {
                maxAge: 31536000, // 1 year
                includeSubDomains: true,
                preload: process.env.NODE_ENV === 'production'
            },
            
            // X-DNS-Prefetch-Control
            dnsPrefetchControl: {
                allow: false
            },
            
            // X-Frame-Options
            frameguard: {
                action: 'deny'
            },
            
            // X-Permitted-Cross-Domain-Policies
            permittedCrossDomainPolicies: {
                permittedPolicies: 'none'
            },
            
            // Referrer-Policy
            referrerPolicy: {
                policy: ['strict-origin-when-cross-origin']
            },
            
            // X-Content-Type-Options
            noSniff: true,
            
            // X-XSS-Protection
            xssFilter: true
        },
        
        // Custom security headers
        custom: {
            'X-API-Version': process.env.API_VERSION || 'v1',
            'X-Powered-By': false, // Remove X-Powered-By header
            'Server': false, // Remove Server header
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': [
                'camera=()',
                'microphone=()',
                'geolocation=(self)',
                'payment=(self)',
                'usb=()',
                'magnetometer=()',
                'accelerometer=()',
                'gyroscope=()'
            ].join(', ')
        }
    },
    
    // Authentication Security
    authentication: {
        // Password policies
        password: {
            minLength: process.env.PASSWORD_MIN_LENGTH || 12,
            maxLength: process.env.PASSWORD_MAX_LENGTH || 128,
            requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
            requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false',
            requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS !== 'false',
            requireSymbols: process.env.PASSWORD_REQUIRE_SYMBOLS !== 'false',
            blockCommon: process.env.PASSWORD_BLOCK_COMMON !== 'false',
            blockReuse: process.env.PASSWORD_BLOCK_REUSE !== 'false',
            blockSimilar: process.env.PASSWORD_BLOCK_SIMILAR !== 'false',
            historySize: process.env.PASSWORD_HISTORY_SIZE || 5,
            maxAge: process.env.PASSWORD_MAX_AGE || 90 * 24 * 60 * 60 * 1000, // 90 days
            
            // Common passwords list
            commonPasswords: [
                'password', '123456', 'qwerty', 'letmein', 'welcome',
                'admin', 'password1', '12345678', '123456789', '123123',
                'password123', 'admin123', 'root', 'user', 'guest'
            ]
        },
        
        // Multi-Factor Authentication
        mfa: {
            enabled: process.env.MFA_ENABLED === 'true',
            required: process.env.MFA_REQUIRED === 'true',
            methods: ['totp', 'sms', 'email'],
            backupCodes: {
                enabled: true,
                count: 10,
                length: 8
            },
            totp: {
                issuer: process.env.APP_NAME || 'MyStore',
                window: 1,
                step: 30
            }
        },
        
        // Session security
        session: {
            maxConcurrent: process.env.MAX_CONCURRENT_SESSIONS || 5,
            idleTimeout: process.env.SESSION_IDLE_TIMEOUT || 30 * 60 * 1000, // 30 minutes
            absoluteTimeout: process.env.SESSION_ABSOLUTE_TIMEOUT || 24 * 60 * 60 * 1000, // 24 hours
            regenerateOnAuth: true,
            secureTransport: process.env.NODE_ENV === 'production',
            
            // Device tracking
            deviceTracking: {
                enabled: process.env.DEVICE_TRACKING === 'true',
                maxDevices: 10,
                requireApproval: true
            }
        },
        
        // Account lockout
        lockout: {
            enabled: process.env.ACCOUNT_LOCKOUT_ENABLED !== 'false',
            maxAttempts: process.env.MAX_LOGIN_ATTEMPTS || 5,
            lockoutDuration: process.env.LOCKOUT_DURATION || 30 * 60 * 1000, // 30 minutes
            progressiveLockout: true,
            notifyUser: true,
            notifyAdmin: true
        }
    },
    
    // Rate Limiting and DDoS Protection
    rateLimiting: {
        // Global rate limiting
        global: {
            enabled: process.env.GLOBAL_RATE_LIMIT_ENABLED !== 'false',
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: process.env.GLOBAL_RATE_LIMIT || 1000,
            message: 'Too many requests, please try again later',
            standardHeaders: true,
            legacyHeaders: false,
            skipSuccessfulRequests: false,
            skipFailedRequests: false
        },
        
        // Authentication rate limiting
        auth: {
            enabled: true,
            windowMs: 15 * 60 * 1000,
            max: process.env.AUTH_RATE_LIMIT || 5,
            skipSuccessfulRequests: true,
            blockDuration: 60 * 60 * 1000 // 1 hour
        },
        
        // API rate limiting
        api: {
            enabled: true,
            windowMs: 15 * 60 * 1000,
            max: process.env.API_RATE_LIMIT || 100,
            keyGenerator: (req) => {
                return req.user?.id || req.ip;
            }
        },
        
        // Upload rate limiting
        upload: {
            enabled: true,
            windowMs: 60 * 60 * 1000, // 1 hour
            max: process.env.UPLOAD_RATE_LIMIT || 20,
            fileSize: process.env.MAX_FILE_SIZE || 10 * 1024 * 1024 // 10MB
        },
        
        // Progressive penalties
        progressive: {
            enabled: process.env.PROGRESSIVE_RATE_LIMIT === 'true',
            penaltyMultiplier: 2,
            maxPenaltyLevel: 5,
            penaltyDecay: 24 * 60 * 60 * 1000 // 24 hours
        },
        
        // Whitelist and blacklist
        whitelist: process.env.RATE_LIMIT_WHITELIST?.split(',') || [],
        blacklist: process.env.RATE_LIMIT_BLACKLIST?.split(',') || []
    },
    
    // Input Validation and Sanitization
    validation: {
        // General validation rules
        rules: {
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            phone: /^\+?[\d\s\-\(\)]+$/,
            alphanumeric: /^[a-zA-Z0-9]+$/,
            noScript: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            noHtml: /<[^>]*>/g,
            sqlInjection: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i
        },
        
        // Sanitization settings
        sanitization: {
            stripHtml: true,
            trimWhitespace: true,
            normalizeEmail: true,
            escapeHtml: true,
            removeNullBytes: true
        },
        
        // File upload validation
        fileUpload: {
            allowedTypes: [
                'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                'application/pdf', 'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain', 'text/csv'
            ],
            maxSize: process.env.MAX_FILE_SIZE || 10 * 1024 * 1024, // 10MB
            maxFiles: process.env.MAX_FILES_PER_REQUEST || 10,
            scanForVirus: process.env.VIRUS_SCANNING_ENABLED === 'true',
            
            // Dangerous file extensions
            blockedExtensions: [
                '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs',
                '.js', '.jar', '.app', '.deb', '.pkg', '.dmg', '.zip'
            ]
        }
    },
    
    // Encryption and Data Protection
    encryption: {
        // Default encryption settings
        algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
        keyLength: 32,
        ivLength: 16,
        tagLength: 16,
        
        // Key management
        keys: {
            primary: process.env.ENCRYPTION_KEY,
            rotation: {
                enabled: process.env.KEY_ROTATION_ENABLED === 'true',
                interval: process.env.KEY_ROTATION_INTERVAL || 30 * 24 * 60 * 60 * 1000, // 30 days
                history: 5 // Keep 5 previous keys for decryption
            }
        },
        
        // Field-level encryption
        fields: {
            // Sensitive fields that should be encrypted
            sensitive: [
                'ssn', 'creditCard', 'bankAccount', 'passport',
                'driverLicense', 'personalId', 'phoneNumber'
            ],
            // Hash-only fields (passwords, etc.)
            hashed: ['password', 'pin', 'securityAnswer'],
            // Tokenized fields (payment info, etc.)
            tokenized: ['paymentMethod', 'billingInfo']
        },
        
        // Hashing settings
        hashing: {
            algorithm: 'sha256',
            saltRounds: process.env.BCRYPT_ROUNDS || 12,
            pepper: process.env.HASH_PEPPER
        }
    },
    
    // CSRF Protection
    csrf: {
        enabled: process.env.CSRF_ENABLED !== 'false',
        
        // Cookie settings
        cookie: {
            name: process.env.CSRF_COOKIE_NAME || '_csrf',
            httpOnly: false, // Must be false for CSRF token access
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        },
        
        // Token settings
        token: {
            length: 32,
            secret: process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex'),
            
            // Custom token extraction
            value: (req) => {
                return req.headers['x-csrf-token'] || 
                       req.headers['x-xsrf-token'] ||
                       req.body._csrf ||
                       req.query._csrf;
            }
        },
        
        // Skip CSRF for certain routes
        skip: [
            '/api/webhooks',
            '/api/health',
            '/api/metrics'
        ]
    },
    
    // API Security
    api: {
        // API key management
        keys: {
            enabled: process.env.API_KEYS_ENABLED === 'true',
            header: 'X-API-Key',
            length: 64,
            prefix: 'sk_',
            rateLimit: {
                windowMs: 60 * 60 * 1000, // 1 hour
                max: 1000
            }
        },
        
        // Request signing
        signing: {
            enabled: process.env.REQUEST_SIGNING_ENABLED === 'true',
            algorithm: 'sha256',
            header: 'X-Signature',
            tolerance: 300 // 5 minutes
        },
        
        // IP whitelisting
        ipWhitelist: {
            enabled: process.env.IP_WHITELIST_ENABLED === 'true',
            ips: process.env.WHITELISTED_IPS?.split(',') || [],
            subnets: process.env.WHITELISTED_SUBNETS?.split(',') || []
        }
    },
    
    // Audit and Compliance
    audit: {
        enabled: process.env.AUDIT_LOGGING_ENABLED !== 'false',
        
        // Events to audit
        events: [
            'user.login',
            'user.logout',
            'user.password_change',
            'user.account_locked',
            'admin.privilege_escalation',
            'data.access',
            'data.modification',
            'data.deletion',
            'payment.processed',
            'security.violation'
        ],
        
        // Audit log settings
        log: {
            format: 'json',
            destination: process.env.AUDIT_LOG_DESTINATION || 'file',
            retention: process.env.AUDIT_RETENTION || 2555, // 7 years in days
            encryption: true,
            signing: true
        },
        
        // GDPR compliance
        gdpr: {
            enabled: process.env.GDPR_COMPLIANCE === 'true',
            dataRetention: 365 * 24 * 60 * 60 * 1000, // 1 year
            rightToErasure: true,
            dataPortability: true,
            consentTracking: true
        },
        
        // PCI compliance
        pci: {
            enabled: process.env.PCI_COMPLIANCE === 'true',
            level: process.env.PCI_LEVEL || 'Level 1',
            tokenization: true,
            encryption: 'AES-256'
        }
    },
    
    // Threat Detection and Response
    security: {
        // Intrusion detection
        ids: {
            enabled: process.env.IDS_ENABLED === 'true',
            threshold: {
                requestFrequency: 100, // Requests per minute
                errorRate: 0.1, // 10% error rate
                suspiciousPatterns: 5 // Pattern matches per hour
            },
            
            // Suspicious patterns
            patterns: [
                /(\.|%2e)(\.|%2e)(%2f|%5c|\/|\\)/i, // Directory traversal
                /(union|select|insert|delete|update|drop|create|alter|exec)/i, // SQL injection
                /<script[^>]*>.*?<\/script>/gi, // XSS
                /javascript:/i, // JavaScript injection
                /vbscript:/i, // VBScript injection
                /(cmd|exec|eval|system|shell_exec)/i // Command injection
            ]
        },
        
        // Automated responses
        responses: {
            block: {
                enabled: true,
                duration: 60 * 60 * 1000, // 1 hour
                threshold: 5 // violations before blocking
            },
            
            alert: {
                enabled: true,
                channels: ['email', 'slack', 'webhook'],
                severity: ['medium', 'high', 'critical']
            },
            
            captcha: {
                enabled: process.env.CAPTCHA_ENABLED === 'true',
                provider: process.env.CAPTCHA_PROVIDER || 'recaptcha',
                threshold: 3 // Failed attempts before captcha
            }
        },
        
        // Security monitoring
        monitoring: {
            enabled: true,
            metrics: [
                'failed_logins',
                'blocked_requests',
                'suspicious_activity',
                'security_violations',
                'ddos_attempts'
            ],
            alerts: {
                failedLoginSpike: 10, // 10 failed logins in 5 minutes
                ddosDetection: 1000, // 1000 requests in 1 minute
                dataBreachAttempt: 1 // Any attempt
            }
        }
    },
    
    // Environment-specific overrides
    environments: {
        development: {
            csrf: { enabled: false },
            rateLimiting: { global: { max: 10000 } },
            headers: { 
                helmet: { 
                    contentSecurityPolicy: false,
                    hsts: false 
                } 
            }
        },
        
        test: {
            csrf: { enabled: false },
            rateLimiting: { enabled: false },
            encryption: { keys: { rotation: { enabled: false } } },
            audit: { enabled: false }
        },
        
        production: {
            csrf: { enabled: true },
            rateLimiting: { enabled: true },
            headers: { helmet: { hsts: { preload: true } } },
            audit: { enabled: true },
            security: { ids: { enabled: true } }
        }
    }
};
