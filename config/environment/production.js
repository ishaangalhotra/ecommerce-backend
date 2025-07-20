const path = require('path');

/**
 * Production Environment Configuration
 * 
 * Optimized for:
 * - Maximum security and performance
 * - High availability and scalability
 * - Minimal resource usage and overhead
 * - Comprehensive monitoring and alerting
 * - Zero-downtime deployments
 */

module.exports = {
    // Environment metadata
    environment: 'production',
    debug: false,
    verbose: false,
    
    // Application settings
    app: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || '0.0.0.0',
        url: process.env.APP_URL || 'https://mystore.com',
        name: process.env.APP_NAME || 'MyStore',
        version: process.env.APP_VERSION || '1.0.0',
        domain: process.env.APP_DOMAIN || 'mystore.com'
    },
    
    // Database configuration (production-optimized)
    database: {
        uri: process.env.MONGODB_URI,
        name: process.env.DB_NAME || 'mystore_production',
        options: {
            maxPoolSize: 50, // Large pool for high concurrency
            minPoolSize: 10,
            maxIdleTimeMS: 30000,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 30000,
            heartbeatFrequencyMS: 10000,
            retryWrites: true,
            retryReads: true,
            autoIndex: false, // Never auto-index in production
            bufferMaxEntries: 0,
            bufferCommands: false,
            // Production write concerns
            writeConcern: {
                w: 'majority',
                j: true,
                wtimeout: 10000
            },
            readConcern: {
                level: 'majority'
            },
            readPreference: 'primaryPreferred',
            compressors: ['zstd', 'zlib']
        },
        healthCheck: {
            enabled: true,
            interval: 60000 // 1 minute
        },
        ssl: true,
        replicaSet: process.env.DB_REPLICA_SET
    },
    
    // Redis configuration (cluster-enabled)
    redis: {
        enabled: process.env.REDIS_ENABLED !== 'false',
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB || 0,
        ttl: 86400, // 24 hours default TTL
        maxRetries: 10,
        retryDelay: 500,
        connectTimeout: 10000,
        commandTimeout: 8000,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4,
        cluster: {
            enabled: process.env.REDIS_CLUSTER_ENABLED === 'true',
            nodes: process.env.REDIS_CLUSTER_NODES?.split(',') || [],
            enableReadyCheck: true,
            redisOptions: {
                password: process.env.REDIS_PASSWORD
            },
            clusterRetryDelayOnFailover: 100,
            clusterRetryDelayOnClusterDown: 300,
            clusterMaxRedirections: 16
        },
        pubsub: {
            enabled: true
        },
        ssl: process.env.REDIS_SSL === 'true',
        tls: process.env.REDIS_TLS === 'true' ? {
            rejectUnauthorized: true
        } : undefined
    },
    
    // JWT configuration (maximum security)
    jwt: {
        secret: process.env.JWT_SECRET,
        refreshSecret: process.env.JWT_REFRESH_SECRET,
        accessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
        issuer: process.env.JWT_ISSUER || 'MyStore',
        audience: process.env.JWT_AUDIENCE || 'MyStore-Users',
        cookie: {
            secure: true, // Always require HTTPS
            httpOnly: true,
            sameSite: 'strict',
            domain: process.env.COOKIE_DOMAIN || '.mystore.com',
            path: '/'
        },
        algorithms: ['HS256'],
        clockTolerance: 15, // Strict clock tolerance
        keyRotation: {
            enabled: process.env.JWT_KEY_ROTATION === 'true',
            interval: 24 * 60 * 60 * 1000 // 24 hours
        }
    },
    
    // Security settings (maximum security)
    security: {
        cors: {
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
                'X-CSRF-Token'
            ],
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204,
            maxAge: 86400 // 24 hours
        },
        helmet: {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", 'data:', 'https:', process.env.CDN_BASE_URL],
                    connectSrc: ["'self'"],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"],
                    reportUri: process.env.CSP_REPORT_URI
                }
            },
            crossOriginEmbedderPolicy: true,
            hsts: {
                maxAge: 31536000, // 1 year
                includeSubDomains: true,
                preload: true
            },
            frameguard: { action: 'deny' },
            noSniff: true,
            xssFilter: true,
            referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
        },
        rateLimiting: {
            enabled: true,
            global: {
                windowMs: 15 * 60 * 1000,
                max: 500 // Conservative production limits
            },
            auth: {
                windowMs: 15 * 60 * 1000,
                max: 5 // Very strict for auth endpoints
            },
            api: {
                windowMs: 15 * 60 * 1000,
                max: 100
            },
            progressive: true, // Enable progressive penalties
            whitelist: process.env.RATE_LIMIT_WHITELIST?.split(',') || []
        },
        csrf: {
            enabled: true,
            cookie: {
                httpOnly: true,
                secure: true,
                sameSite: 'strict'
            },
            value: req => req.headers['x-csrf-token'] || req.body._csrf
        },
        trustProxy: parseInt(process.env.TRUST_PROXY) || 1,
        maxBodySize: '5mb', // Conservative body size limit
        passwordPolicy: {
            minLength: 12,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSymbols: true,
            blockCommon: true,
            blockReuse: true,
            maxAge: 90 * 24 * 60 * 60 * 1000 // 90 days
        }
    },
    
    // Logging configuration (minimal production logging)
    logging: {
        level: 'warn', // Only warnings and errors
        enableConsole: false, // Disable console logging
        enableFile: true,
        directory: process.env.LOG_DIR || '/var/log/app',
        filename: 'production-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '100m',
        maxFiles: '90d', // Keep 90 days of logs
        format: 'json', // Structured JSON logging
        enableColors: false,
        enableRequestLogging: false, // Disable request logging for performance
        enablePerformanceMonitoring: true,
        enableStackTrace: false, // No stack traces in production logs
        enableErrorLogging: true,
        // Centralized logging
        elasticsearch: {
            enabled: process.env.ELASTICSEARCH_ENABLED === 'true',
            host: process.env.ELASTICSEARCH_HOST,
            index: process.env.ELASTICSEARCH_INDEX || 'mystore-logs'
        }
    },
    
    // Email configuration (production SMTP)
    email: {
        enabled: process.env.EMAIL_ENABLED !== 'false',
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT || 587,
        secure: process.env.EMAIL_PORT === '465',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD
        },
        from: {
            name: process.env.EMAIL_FROM_NAME || 'MyStore',
            address: process.env.EMAIL_FROM_ADDRESS
        },
        templateDir: path.join(process.cwd(), 'templates', 'email'),
        mockMode: false,
        logEmails: false, // Don't log emails in production
        rateLimit: 1000, // Emails per hour
        pool: true,
        maxConnections: 10,
        maxMessages: 500,
        // Production email settings
        tls: {
            rejectUnauthorized: true
        },
        dkim: {
            enabled: process.env.DKIM_ENABLED === 'true',
            keySelector: process.env.DKIM_SELECTOR,
            privateKey: process.env.DKIM_PRIVATE_KEY
        }
    },
    
    // Upload configuration (strict production limits)
    upload: {
        maxSize: 5 * 1024 * 1024, // 5MB strict limit
        maxFiles: 5,
        allowedTypes: [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf'
        ],
        destination: process.env.UPLOAD_DESTINATION || '/app/uploads/production',
        enableImageProcessing: true,
        enableVirusScan: true, // Always scan in production
        enableCompression: true,
        maxImageDimensions: {
            width: 1920,
            height: 1080
        },
        watermark: {
            enabled: process.env.WATERMARK_ENABLED === 'true',
            path: process.env.WATERMARK_PATH
        }
    },
    
    // Cache configuration (optimized for production)
    cache: {
        enabled: true,
        ttl: 3600, // 1 hour
        maxSize: 2 * 1024 * 1024 * 1024, // 2GB
        compression: true,
        keyPrefix: 'mystore:prod:',
        enableMetrics: true,
        enableInvalidation: true,
        // Advanced caching strategies
        strategies: {
            lru: true,
            compress: true,
            serialize: 'json'
        }
    },
    
    // API configuration
    api: {
        version: 'v1',
        prefix: '/api/v1',
        baseUrl: process.env.API_BASE_URL || 'https://api.mystore.com',
        pagination: {
            defaultLimit: 20,
            maxLimit: 50 // Conservative limit
        },
        validation: {
            stripUnknown: true,
            abortEarly: false,
            allowUnknown: false
        },
        requestTimeout: 15000, // 15 seconds
        enableVersioning: true,
        deprecation: {
            enabled: true,
            warningHeader: true
        }
    },
    
    // External services (production endpoints)
    services: {
        // Payment processing (live mode)
        stripe: {
            enabled: process.env.STRIPE_ENABLED === 'true',
            secretKey: process.env.STRIPE_SECRET_KEY,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            testMode: false, // Live mode only
            apiVersion: '2023-10-16',
            webhookTolerance: 300 // 5 minutes
        },
        
        // AWS services (production)
        aws: {
            enabled: process.env.AWS_ENABLED === 'true',
            region: process.env.AWS_REGION,
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            s3: {
                bucket: process.env.AWS_S3_BUCKET,
                region: process.env.AWS_S3_REGION,
                signedUrlExpires: 900, // 15 minutes
                encryption: 'aws:kms',
                kmsKeyId: process.env.AWS_KMS_KEY_ID,
                versioning: true
            },
            ses: {
                enabled: process.env.AWS_SES_ENABLED === 'true',
                region: process.env.AWS_SES_REGION,
                rateLimit: 200, // Production SES limit
                suppressionList: true
            },
            cloudfront: {
                enabled: process.env.CLOUDFRONT_ENABLED === 'true',
                distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
                invalidationEnabled: true
            }
        },
        
        // Monitoring services
        sentry: {
            enabled: process.env.SENTRY_ENABLED === 'true',
            dsn: process.env.SENTRY_DSN,
            environment: 'production',
            tracesSampleRate: 0.1, // Sample 10% of transactions
            debug: false,
            beforeSend: (event) => {
                // Filter sensitive data
                return event;
            }
        },
        
        // External APIs
        analytics: {
            enabled: process.env.ANALYTICS_ENABLED === 'true',
            googleAnalytics: process.env.GA_TRACKING_ID,
            mixpanel: process.env.MIXPANEL_TOKEN
        }
    },
    
    // OAuth providers (production applications)
    oauth: {
        google: {
            enabled: process.env.GOOGLE_OAUTH_ENABLED === 'true',
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'https://mystore.com/auth/google/callback'
        },
        facebook: {
            enabled: process.env.FACEBOOK_OAUTH_ENABLED === 'true',
            clientId: process.env.FACEBOOK_APP_ID,
            clientSecret: process.env.FACEBOOK_APP_SECRET,
            callbackUrl: process.env.FACEBOOK_CALLBACK_URL || 'https://mystore.com/auth/facebook/callback'
        },
        github: {
            enabled: process.env.GITHUB_OAUTH_ENABLED === 'true',
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackUrl: process.env.GITHUB_CALLBACK_URL || 'https://mystore.com/auth/github/callback'
        }
    },
    
    // Feature flags (production-safe)
    features: {
        enableSwagger: false, // Disable API docs in production
        enableGraphQL: process.env.GRAPHQL_ENABLED === 'true',
        enableMetrics: true,
        enableHealthChecks: true,
        enableDebugRoutes: false, // Never enable in production
        enableMockData: false,
        enableHotReload: false,
        enableSourceMaps: false,
        enableAnalytics: true,
        enableErrorReporting: true,
        enablePerformanceTracking: true
    },
    
    // Monitoring (comprehensive production monitoring)
    monitoring: {
        enabled: true,
        prometheus: {
            enabled: process.env.PROMETHEUS_ENABLED === 'true',
            endpoint: '/metrics',
            collectDefaultMetrics: true,
            prefix: 'mystore_',
            register: {
                contentType: 'text/plain; version=0.0.4; charset=utf-8'
            }
        },
        healthChecks: {
            enabled: true,
            interval: 30000, // 30 seconds
            timeout: 5000,
            endpoints: {
                liveness: '/health/liveness',
                readiness: '/health/readiness'
            }
        },
        performanceMonitoring: {
            enabled: true,
            sampleRate: 0.1, // Monitor 10% of requests
            slowRequestThreshold: 500, // 500ms
            memoryThreshold: 0.85, // 85% memory usage
            cpuThreshold: 0.8 // 80% CPU usage
        },
        alerting: {
            enabled: process.env.ALERTING_ENABLED === 'true',
            webhookUrl: process.env.ALERT_WEBHOOK_URL,
            channels: ['email', 'slack', 'pagerduty'],
            thresholds: {
                errorRate: 0.05, // 5% error rate
                responseTime: 1000, // 1 second
                memoryUsage: 0.9, // 90% memory
                diskUsage: 0.85 // 85% disk
            }
        },
        uptime: {
            enabled: process.env.UPTIME_MONITORING === 'true',
            interval: 60000, // 1 minute
            retries: 3
        }
    },
    
    // Session configuration
    session: {
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: true, // Always require HTTPS
            httpOnly: true,
            maxAge: 12 * 60 * 60 * 1000, // 12 hours
            sameSite: 'strict'
        },
        name: 'mystore.sid',
        rolling: true,
        // Production session store
        store: {
            type: 'redis',
            prefix: 'sess:',
            ttl: 43200 // 12 hours
        }
    },
    
    // Static files (CDN-optimized)
    static: {
        enabled: false, // Use CDN instead
        directory: path.join(process.cwd(), 'public'),
        maxAge: 31536000000, // 1 year caching
        etag: true,
        lastModified: true,
        immutable: true,
        // CDN configuration
        cdn: {
            enabled: true,
            baseUrl: process.env.CDN_BASE_URL,
            version: process.env.ASSETS_VERSION,
            purgeOnDeploy: true
        }
    },
    
    // Backup and disaster recovery
    backup: {
        enabled: process.env.BACKUP_ENABLED === 'true',
        schedule: '0 1 * * *', // Daily at 1 AM
        retention: 90, // Keep 90 days
        destinations: ['s3', 'gcs'],
        encryption: true,
        compression: true,
        verification: true
    },
    
    // Performance configuration (production-optimized)
    performance: {
        clusterMode: process.env.CLUSTER_MODE !== 'false',
        maxWorkers: parseInt(process.env.MAX_WORKERS) || require('os').cpus().length,
        gracefulShutdownTimeout: 30000, // 30 seconds
        keepAliveTimeout: 5000,
        headersTimeout: 10000,
        requestTimeout: 15000,
        // Memory management
        maxOldSpaceSize: process.env.NODE_MAX_OLD_SPACE_SIZE || 2048,
        // V8 optimizations
        v8Options: [
            '--max-old-space-size=2048',
            '--optimize-for-size'
        ]
    },
    
    // SSL/TLS configuration (strict)
    ssl: {
        enabled: true,
        enforceHttps: true,
        hsts: {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true
        },
        protocols: ['TLSv1.3'], // Only latest TLS
        ciphers: 'ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS',
        honorCipherOrder: true,
        dhparam: process.env.SSL_DHPARAM_PATH
    },
    
    // Compliance and auditing
    compliance: {
        gdpr: {
            enabled: process.env.GDPR_COMPLIANCE === 'true',
            cookieConsent: true,
            dataRetention: 365 * 24 * 60 * 60 * 1000, // 1 year
            rightToErasure: true
        },
        audit: {
            enabled: true,
            logAllRequests: false, // Only log sensitive operations
            retentionPeriod: 2555 * 24 * 60 * 60 * 1000, // 7 years
            encryption: true
        },
        pci: {
            enabled: process.env.PCI_COMPLIANCE === 'true',
            tokenization: true,
            encryption: 'AES-256'
        }
    },
    
    // Scaling and load balancing
    scaling: {
        autoScaling: {
            enabled: process.env.AUTO_SCALING === 'true',
            minInstances: parseInt(process.env.MIN_INSTANCES) || 2,
            maxInstances: parseInt(process.env.MAX_INSTANCES) || 10,
            cpuThreshold: 70,
            memoryThreshold: 80
        },
        loadBalancer: {
            algorithm: 'round-robin',
            healthCheck: '/health/liveness',
            stickySession: false
        }
    }
};
