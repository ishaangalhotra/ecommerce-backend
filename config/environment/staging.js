const path = require('path');

/**
 * Staging Environment Configuration
 * 
 * Optimized for:
 * - Production-like testing and validation
 * - Client demos and UAT (User Acceptance Testing)
 * - Performance testing with production data volumes
 * - Security testing with production-like constraints
 * - Integration testing with external services
 */

module.exports = {
    // Environment metadata
    environment: 'staging',
    debug: false,
    verbose: false,
    
    // Application settings
    app: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || '0.0.0.0',
        url: process.env.APP_URL || 'https://staging.mystore.com',
        name: process.env.APP_NAME || 'MyStore Staging',
        version: process.env.APP_VERSION || '1.0.0-staging',
        domain: process.env.APP_DOMAIN || 'staging.mystore.com'
    },
    
    // Database configuration (production-like settings)
    database: {
        uri: process.env.MONGODB_URI || 'mongodb://staging-mongo:27017/mystore_staging',
        name: process.env.DB_NAME || 'mystore_staging',
        options: {
            maxPoolSize: 15, // Production-like pool size
            minPoolSize: 3,
            maxIdleTimeMS: 30000,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 30000,
            heartbeatFrequencyMS: 10000,
            retryWrites: true,
            retryReads: true,
            autoIndex: false, // Disable auto-indexing like production
            bufferMaxEntries: 0,
            bufferCommands: false,
            // Production-like write concerns
            writeConcern: {
                w: 'majority',
                j: true,
                wtimeout: 10000
            },
            readConcern: {
                level: 'local'
            }
        },
        healthCheck: {
            enabled: true,
            interval: 30000
        },
        ssl: process.env.DB_SSL === 'true',
        replicaSet: process.env.DB_REPLICA_SET || undefined
    },
    
    // Redis configuration (cluster-ready)
    redis: {
        enabled: process.env.REDIS_ENABLED !== 'false',
        host: process.env.REDIS_HOST || 'staging-redis',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB || 0,
        ttl: 86400, // 24 hours default TTL
        maxRetries: 5,
        retryDelay: 200,
        connectTimeout: 10000,
        commandTimeout: 5000,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4,
        cluster: {
            enabled: process.env.REDIS_CLUSTER_ENABLED === 'true',
            nodes: process.env.REDIS_CLUSTER_NODES?.split(',') || []
        },
        pubsub: {
            enabled: true
        },
        ssl: process.env.REDIS_SSL === 'true'
    },
    
    // JWT configuration (production-like security)
    jwt: {
        secret: process.env.JWT_SECRET,
        refreshSecret: process.env.JWT_REFRESH_SECRET,
        accessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
        issuer: process.env.JWT_ISSUER || 'MyStore-Staging',
        audience: process.env.JWT_AUDIENCE || 'MyStore-Staging-Users',
        cookie: {
            secure: true, // Enforce HTTPS
            httpOnly: true,
            sameSite: 'strict',
            domain: process.env.COOKIE_DOMAIN || '.staging.mystore.com',
            path: '/'
        },
        algorithms: ['HS256'],
        clockTolerance: 30
    },
    
    // Security settings (production-like)
    security: {
        cors: {
            origin: [
                'https://staging.mystore.com',
                'https://admin-staging.mystore.com',
                'https://app-staging.mystore.com'
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
                    imgSrc: ["'self'", 'data:', 'https:'],
                    connectSrc: ["'self'"],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"]
                }
            },
            crossOriginEmbedderPolicy: false,
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: false // Not yet ready for production preload
            },
            frameguard: { action: 'deny' }
        },
        rateLimiting: {
            enabled: true,
            global: {
                windowMs: 15 * 60 * 1000,
                max: 1000 // Production-like limits
            },
            auth: {
                windowMs: 15 * 60 * 1000,
                max: 10 // Slightly more lenient than production for testing
            },
            api: {
                windowMs: 15 * 60 * 1000,
                max: 200
            }
        },
        csrf: {
            enabled: true,
            cookie: {
                httpOnly: true,
                secure: true,
                sameSite: 'strict'
            }
        },
        trustProxy: 1, // Trust first proxy (load balancer)
        maxBodySize: '10mb'
    },
    
    // Logging configuration (balanced verbosity)
    logging: {
        level: 'info', // Less verbose than development
        enableConsole: true,
        enableFile: true,
        directory: path.join(process.cwd(), 'logs'),
        filename: 'staging-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '50m',
        maxFiles: '30d',
        format: 'json', // Structured logging
        enableColors: false,
        enableRequestLogging: true,
        enablePerformanceMonitoring: true,
        enableStackTrace: true, // Keep stack traces for debugging
        enableErrorLogging: true
    },
    
    // Email configuration (real SMTP but test accounts)
    email: {
        enabled: process.env.EMAIL_ENABLED !== 'false',
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: process.env.EMAIL_PORT === '465',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD
        },
        from: {
            name: process.env.EMAIL_FROM_NAME || 'MyStore Staging',
            address: process.env.EMAIL_FROM_ADDRESS || 'noreply@staging.mystore.com'
        },
        templateDir: path.join(process.cwd(), 'templates', 'email'),
        mockMode: false, // Use real email service
        logEmails: true, // Log emails for testing verification
        rateLimit: 100, // Emails per hour
        pool: true,
        maxConnections: 5,
        maxMessages: 100
    },
    
    // Upload configuration (production-like limits)
    upload: {
        maxSize: 10 * 1024 * 1024, // 10MB
        maxFiles: 10,
        allowedTypes: [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'text/csv'
        ],
        destination: process.env.UPLOAD_DESTINATION || '/app/uploads/staging',
        enableImageProcessing: true,
        enableVirusScan: process.env.ENABLE_VIRUS_SCAN === 'true',
        enableCompression: true,
        maxImageDimensions: {
            width: 2048,
            height: 2048
        }
    },
    
    // Cache configuration (optimized for testing)
    cache: {
        enabled: true,
        ttl: 1800, // 30 minutes
        maxSize: 500 * 1024 * 1024, // 500MB
        compression: true,
        keyPrefix: 'mystore:staging:',
        enableMetrics: true,
        enableInvalidation: true
    },
    
    // API configuration
    api: {
        version: 'v1',
        prefix: '/api/v1',
        baseUrl: process.env.API_BASE_URL || 'https://staging.mystore.com/api/v1',
        pagination: {
            defaultLimit: 20,
            maxLimit: 100
        },
        validation: {
            stripUnknown: true,
            abortEarly: false,
            allowUnknown: false // Strict validation like production
        },
        requestTimeout: 30000, // 30 seconds
        enableVersioning: true
    },
    
    // External services (test/sandbox configurations)
    services: {
        // Payment processing (test mode)
        stripe: {
            enabled: process.env.STRIPE_ENABLED === 'true',
            secretKey: process.env.STRIPE_SECRET_KEY,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            testMode: true,
            apiVersion: '2023-10-16'
        },
        
        // AWS services (staging environment)
        aws: {
            enabled: process.env.AWS_ENABLED === 'true',
            region: process.env.AWS_REGION || 'us-east-1',
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            s3: {
                bucket: process.env.AWS_S3_BUCKET || 'mystore-staging-bucket',
                region: process.env.AWS_S3_REGION || 'us-east-1',
                signedUrlExpires: 3600,
                encryption: 'AES256'
            },
            ses: {
                enabled: process.env.AWS_SES_ENABLED === 'true',
                region: process.env.AWS_SES_REGION || 'us-east-1',
                rateLimit: 14
            },
            cloudfront: {
                enabled: process.env.CLOUDFRONT_ENABLED === 'true',
                distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID
            }
        },
        
        // Monitoring services
        sentry: {
            enabled: process.env.SENTRY_ENABLED === 'true',
            dsn: process.env.SENTRY_DSN,
            environment: 'staging',
            tracesSampleRate: 0.5,
            debug: false
        }
    },
    
    // OAuth providers (staging applications)
    oauth: {
        google: {
            enabled: process.env.GOOGLE_OAUTH_ENABLED === 'true',
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'https://staging.mystore.com/auth/google/callback'
        },
        facebook: {
            enabled: process.env.FACEBOOK_OAUTH_ENABLED === 'true',
            clientId: process.env.FACEBOOK_APP_ID,
            clientSecret: process.env.FACEBOOK_APP_SECRET,
            callbackUrl: process.env.FACEBOOK_CALLBACK_URL || 'https://staging.mystore.com/auth/facebook/callback'
        },
        github: {
            enabled: process.env.GITHUB_OAUTH_ENABLED === 'true',
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackUrl: process.env.GITHUB_CALLBACK_URL || 'https://staging.mystore.com/auth/github/callback'
        }
    },
    
    // Feature flags
    features: {
        enableSwagger: true, // Keep API docs for staging
        enableGraphQL: process.env.GRAPHQL_ENABLED === 'true',
        enableMetrics: true,
        enableHealthChecks: true,
        enableDebugRoutes: false, // Disable debug routes
        enableMockData: false, // Use real data
        enableHotReload: false,
        enableSourceMaps: false, // Disable for performance
        enableAnalytics: true,
        enableErrorReporting: true
    },
    
    // Testing and QA tools
    testing: {
        enableTestRoutes: process.env.ENABLE_TEST_ROUTES === 'true',
        enableDataReset: process.env.ENABLE_DATA_RESET === 'true',
        enablePerformanceTesting: true,
        enableLoadTesting: true,
        
        // Test data management
        testData: {
            enabled: process.env.ENABLE_TEST_DATA === 'true',
            autoGenerate: false,
            preserveOnReset: true
        }
    },
    
    // Monitoring (production-like)
    monitoring: {
        enabled: true,
        prometheus: {
            enabled: process.env.PROMETHEUS_ENABLED === 'true',
            endpoint: '/metrics',
            collectDefaultMetrics: true,
            prefix: 'mystore_staging_'
        },
        healthChecks: {
            enabled: true,
            interval: 30000, // 30 seconds
            timeout: 10000,
            endpoints: {
                liveness: '/health/liveness',
                readiness: '/health/readiness',
                detailed: '/health/detailed'
            }
        },
        performanceMonitoring: {
            enabled: true,
            sampleRate: 0.8, // Monitor 80% of requests
            slowRequestThreshold: 1000, // 1 second
            memoryThreshold: 0.8 // 80% memory usage
        },
        alerting: {
            enabled: process.env.ALERTING_ENABLED === 'true',
            webhookUrl: process.env.ALERT_WEBHOOK_URL,
            channels: ['email', 'slack']
        }
    },
    
    // Session configuration
    session: {
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: true, // Require HTTPS
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            sameSite: 'strict'
        },
        name: 'mystore.staging.sid',
        rolling: true
    },
    
    // Static files (CDN-ready)
    static: {
        enabled: process.env.SERVE_STATIC !== 'false',
        directory: path.join(process.cwd(), 'public'),
        maxAge: 3600000, // 1 hour caching
        etag: true,
        lastModified: true,
        immutable: false,
        // CDN configuration
        cdn: {
            enabled: process.env.CDN_ENABLED === 'true',
            baseUrl: process.env.CDN_BASE_URL || 'https://cdn-staging.mystore.com'
        }
    },
    
    // Backup and disaster recovery
    backup: {
        enabled: process.env.BACKUP_ENABLED === 'true',
        schedule: '0 2 * * *', // Daily at 2 AM
        retention: 30, // Keep 30 days
        destinations: ['s3'],
        encryption: true
    },
    
    // Performance configuration
    performance: {
        clusterMode: process.env.CLUSTER_MODE === 'true',
        maxWorkers: parseInt(process.env.MAX_WORKERS) || 2,
        gracefulShutdownTimeout: 10000,
        keepAliveTimeout: 5000,
        headersTimeout: 60000,
        requestTimeout: 30000
    },
    
    // SSL/TLS configuration
    ssl: {
        enabled: true,
        enforceHttps: true,
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true
        },
        protocols: ['TLSv1.2', 'TLSv1.3'],
        ciphers: 'ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS',
        honorCipherOrder: true
    }
};
