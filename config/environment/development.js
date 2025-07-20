const path = require('path');

/**
 * Development Environment Configuration
 * 
 * Optimized for:
 * - Developer productivity and debugging
 * - Hot reloading and fast iteration
 * - Detailed logging and error reporting
 * - Relaxed security for development ease
 * - Mock services and test data
 */

module.exports = {
    // Environment metadata
    environment: 'development',
    debug: true,
    verbose: true,
    
    // Application settings
    app: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || 'localhost',
        url: process.env.APP_URL || 'http://localhost:3000',
        name: process.env.APP_NAME || 'MyStore Dev',
        version: process.env.APP_VERSION || '1.0.0-dev'
    },
    
    // Database configuration
    database: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/mystore_dev',
        name: process.env.DB_NAME || 'mystore_dev',
        options: {
            maxPoolSize: 5, // Smaller pool for development
            minPoolSize: 1,
            maxIdleTimeMS: 30000,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            heartbeatFrequencyMS: 10000,
            retryWrites: true,
            retryReads: true,
            autoIndex: true, // Enable auto-indexing in development
            bufferMaxEntries: 0,
            bufferCommands: false
        },
        healthCheck: {
            enabled: true,
            interval: 30000
        }
    },
    
    // Redis configuration
    redis: {
        enabled: process.env.REDIS_ENABLED !== 'false',
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || null,
        db: process.env.REDIS_DB || 0,
        ttl: 3600, // 1 hour default TTL
        maxRetries: 3,
        retryDelay: 100,
        connectTimeout: 10000,
        commandTimeout: 5000,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4,
        cluster: {
            enabled: false // No clustering in development
        },
        pubsub: {
            enabled: true
        }
    },
    
    // JWT configuration
    jwt: {
        secret: process.env.JWT_SECRET || 'dev-secret-key-change-in-production-very-long-secret',
        refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-key-change-in-production',
        accessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '1h', // Longer for development convenience
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
        issuer: process.env.JWT_ISSUER || 'MyStore-Dev',
        audience: process.env.JWT_AUDIENCE || 'MyStore-Dev-Users',
        cookie: {
            secure: false, // Allow non-HTTPS in development
            httpOnly: true,
            sameSite: 'lax', // Relaxed for development
            domain: undefined, // No domain restriction
            path: '/'
        }
    },
    
    // Security settings (relaxed for development)
    security: {
        cors: {
            origin: [
                'http://localhost:3000',
                'http://localhost:3001',
                'http://localhost:8080',
                'http://127.0.0.1:3000',
                'http://0.0.0.0:3000'
            ],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204
        },
        helmet: {
            contentSecurityPolicy: false, // Disabled for easier development
            crossOriginEmbedderPolicy: false,
            hsts: false, // No HTTPS enforcement in development
            frameguard: { action: 'sameorigin' }
        },
        rateLimiting: {
            enabled: false, // Disabled for development convenience
            global: {
                windowMs: 15 * 60 * 1000,
                max: 10000 // Very high limit for development
            },
            auth: {
                windowMs: 15 * 60 * 1000,
                max: 100 // Generous limit for testing
            }
        },
        csrf: {
            enabled: false // Disabled for API testing convenience
        },
        trustProxy: false,
        maxBodySize: '50mb' // Large body size for development/testing
    },
    
    // Logging configuration
    logging: {
        level: 'debug', // Verbose logging
        enableConsole: true,
        enableFile: true,
        directory: path.join(process.cwd(), 'logs'),
        filename: 'development-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '7d',
        format: 'pretty', // Human-readable format
        enableColors: true,
        enableRequestLogging: true,
        enablePerformanceMonitoring: true,
        enableStackTrace: true
    },
    
    // Email configuration (mock/testing)
    email: {
        enabled: process.env.EMAIL_ENABLED === 'true',
        host: process.env.EMAIL_HOST || 'localhost',
        port: process.env.EMAIL_PORT || 1025, // Mailhog default port
        secure: false,
        auth: {
            user: process.env.EMAIL_USER || 'dev@example.com',
            pass: process.env.EMAIL_PASSWORD || 'devpassword'
        },
        from: {
            name: process.env.EMAIL_FROM_NAME || 'MyStore Development',
            address: process.env.EMAIL_FROM_ADDRESS || 'noreply@dev.mystore.com'
        },
        templateDir: path.join(process.cwd(), 'templates', 'email'),
        mockMode: true, // Enable mock mode for development
        logEmails: true // Log all emails to console
    },
    
    // Upload configuration
    upload: {
        maxSize: 50 * 1024 * 1024, // 50MB for development
        maxFiles: 20,
        allowedTypes: [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'text/csv', 'application/json'
        ],
        destination: path.join(process.cwd(), 'uploads', 'dev'),
        enableImageProcessing: true,
        enableVirusScan: false, // Disabled in development
        enableCompression: true
    },
    
    // Cache configuration
    cache: {
        enabled: true,
        ttl: 300, // 5 minutes for development
        maxSize: 100 * 1024 * 1024, // 100MB
        compression: false, // Disabled for faster development
        keyPrefix: 'mystore:dev:',
        enableMetrics: true
    },
    
    // API configuration
    api: {
        version: 'v1',
        prefix: '/api/v1',
        baseUrl: process.env.API_BASE_URL || 'http://localhost:3000/api/v1',
        pagination: {
            defaultLimit: 20,
            maxLimit: 100
        },
        validation: {
            stripUnknown: true,
            abortEarly: false,
            allowUnknown: true // More permissive in development
        }
    },
    
    // External services (mock/test configurations)
    services: {
        // Payment processing (test mode)
        stripe: {
            enabled: process.env.STRIPE_ENABLED === 'true',
            secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_...',
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            testMode: true
        },
        
        // AWS services (localstack or mock)
        aws: {
            enabled: process.env.AWS_ENABLED === 'true',
            region: process.env.AWS_REGION || 'us-east-1',
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
            s3: {
                bucket: process.env.AWS_S3_BUCKET || 'mystore-dev-bucket',
                endpoint: process.env.AWS_S3_ENDPOINT || 'http://localhost:4566', // LocalStack
                forcePathStyle: true
            },
            ses: {
                enabled: false // Use SMTP in development
            }
        }
    },
    
    // OAuth providers (development/testing)
    oauth: {
        google: {
            enabled: process.env.GOOGLE_OAUTH_ENABLED === 'true',
            clientId: process.env.GOOGLE_CLIENT_ID || 'dev-google-client-id',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dev-google-client-secret',
            callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
        },
        facebook: {
            enabled: process.env.FACEBOOK_OAUTH_ENABLED === 'true',
            clientId: process.env.FACEBOOK_APP_ID || 'dev-facebook-app-id',
            clientSecret: process.env.FACEBOOK_APP_SECRET || 'dev-facebook-app-secret',
            callbackUrl: process.env.FACEBOOK_CALLBACK_URL || 'http://localhost:3000/auth/facebook/callback'
        },
        github: {
            enabled: process.env.GITHUB_OAUTH_ENABLED === 'true',
            clientId: process.env.GITHUB_CLIENT_ID || 'dev-github-client-id',
            clientSecret: process.env.GITHUB_CLIENT_SECRET || 'dev-github-client-secret',
            callbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3000/auth/github/callback'
        }
    },
    
    // Feature flags
    features: {
        enableSwagger: true, // API documentation
        enableGraphQL: process.env.GRAPHQL_ENABLED === 'true',
        enableMetrics: true,
        enableHealthChecks: true,
        enableDebugRoutes: true, // Special debug endpoints
        enableMockData: true, // Generate mock data
        enableHotReload: true,
        enableSourceMaps: true
    },
    
    // Development tools
    development: {
        enableCors: true,
        enableMorgan: true, // HTTP request logger
        enablePrettyPrint: true,
        enableStackTrace: true,
        enableVerboseErrors: true,
        enableAutoRestart: true,
        enableLiveReload: false,
        
        // Mock configurations
        mocks: {
            enabled: process.env.ENABLE_MOCKS === 'true',
            delay: parseInt(process.env.MOCK_DELAY) || 0, // Add artificial delay
            errorRate: parseFloat(process.env.MOCK_ERROR_RATE) || 0 // Simulate errors
        },
        
        // Database seeding
        seeding: {
            enabled: process.env.ENABLE_SEEDING === 'true',
            resetOnStart: process.env.RESET_DB_ON_START === 'true',
            seedUsers: parseInt(process.env.SEED_USERS) || 10,
            seedProducts: parseInt(process.env.SEED_PRODUCTS) || 50
        }
    },
    
    // Monitoring (lightweight for development)
    monitoring: {
        enabled: true,
        prometheus: {
            enabled: false // Usually not needed in development
        },
        healthChecks: {
            enabled: true,
            interval: 60000, // 1 minute
            timeout: 5000
        },
        performanceMonitoring: {
            enabled: true,
            sampleRate: 1.0 // Monitor all requests in development
        }
    },
    
    // Session configuration
    session: {
        secret: process.env.SESSION_SECRET || 'dev-session-secret-change-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, // Allow non-HTTPS
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        },
        name: 'mystore.dev.sid'
    },
    
    // Static files
    static: {
        enabled: true,
        directory: path.join(process.cwd(), 'public'),
        maxAge: 0, // No caching in development
        etag: false,
        lastModified: false
    }
};
