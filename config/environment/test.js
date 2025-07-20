const path = require('path');

/**
 * Test Environment Configuration
 * 
 * Optimized for:
 * - Automated testing (unit, integration, e2e)
 * - Fast test execution and isolation
 * - Mock services and test data
 * - Deterministic behavior and reproducibility
 * - CI/CD pipeline compatibility
 */

module.exports = {
    // Environment metadata
    environment: 'test',
    debug: false,
    verbose: false,
    
    // Application settings
    app: {
        port: process.env.TEST_PORT || 0, // Random available port
        host: process.env.TEST_HOST || 'localhost',
        url: process.env.TEST_APP_URL || 'http://localhost:3000',
        name: process.env.APP_NAME || 'MyStore Test',
        version: process.env.APP_VERSION || '1.0.0-test'
    },
    
    // Database configuration (in-memory or test database)
    database: {
        uri: process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/mystore_test',
        name: process.env.TEST_DB_NAME || 'mystore_test',
        options: {
            maxPoolSize: 2, // Minimal pool for tests
            minPoolSize: 1,
            maxIdleTimeMS: 10000,
            serverSelectionTimeoutMS: 2000,
            socketTimeoutMS: 15000,
            connectTimeoutMS: 5000,
            heartbeatFrequencyMS: 30000,
            retryWrites: false, // Disable for faster tests
            retryReads: false,
            autoIndex: true, // Enable for test data setup
            bufferMaxEntries: 0,
            bufferCommands: false
        },
        healthCheck: {
            enabled: false // Disable health checks in tests
        },
        // Test-specific settings
        dropDatabase: process.env.DROP_TEST_DB !== 'false', // Drop DB before/after tests
        inMemory: process.env.USE_MEMORY_DB === 'true' // Use MongoDB Memory Server
    },
    
    // Redis configuration (mock or test instance)
    redis: {
        enabled: process.env.TEST_REDIS_ENABLED === 'true',
        host: process.env.TEST_REDIS_HOST || 'localhost',
        port: process.env.TEST_REDIS_PORT || 6380, // Different port for tests
        password: process.env.TEST_REDIS_PASSWORD || null,
        db: process.env.TEST_REDIS_DB || 15, // Use highest DB number for tests
        ttl: 60, // Short TTL for tests
        maxRetries: 1,
        retryDelay: 50,
        connectTimeout: 2000,
        commandTimeout: 1000,
        lazyConnect: true,
        keepAlive: 10000,
        family: 4,
        cluster: {
            enabled: false // No clustering in tests
        },
        pubsub: {
            enabled: false // Disable pub/sub in tests
        },
        // Test-specific settings
        flushOnStart: true, // Flush Redis before tests
        mockMode: process.env.MOCK_REDIS === 'true' // Use mock Redis
    },
    
    // JWT configuration (test-optimized)
    jwt: {
        secret: process.env.TEST_JWT_SECRET || 'test-jwt-secret-not-for-production-use-only',
        refreshSecret: process.env.TEST_JWT_REFRESH_SECRET || 'test-refresh-secret-not-for-production',
        accessExpiresIn: process.env.TEST_JWT_ACCESS_EXPIRES || '1h', // Longer for test stability
        refreshExpiresIn: process.env.TEST_JWT_REFRESH_EXPIRES || '24h',
        issuer: process.env.TEST_JWT_ISSUER || 'MyStore-Test',
        audience: process.env.TEST_JWT_AUDIENCE || 'MyStore-Test-Users',
        cookie: {
            secure: false, // Allow HTTP in tests
            httpOnly: true,
            sameSite: 'lax',
            domain: undefined,
            path: '/'
        },
        algorithms: ['HS256'],
        clockTolerance: 60 // Generous tolerance for tests
    },
    
    // Security settings (relaxed for testing)
    security: {
        cors: {
            origin: '*', // Allow all origins in tests
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204
        },
        helmet: {
            contentSecurityPolicy: false, // Disabled for testing
            crossOriginEmbedderPolicy: false,
            hsts: false,
            frameguard: false
        },
        rateLimiting: {
            enabled: false, // Disabled for tests
            global: {
                windowMs: 15 * 60 * 1000,
                max: 999999 // Effectively unlimited
            }
        },
        csrf: {
            enabled: false // Disabled for API testing
        },
        trustProxy: false,
        maxBodySize: '100mb' // Large body size for test data
    },
    
    // Logging configuration (minimal for tests)
    logging: {
        level: 'error', // Only log errors during tests
        enableConsole: process.env.TEST_LOGS === 'true', // Usually disabled
        enableFile: false, // No file logging in tests
        enableRequestLogging: false,
        enablePerformanceMonitoring: false,
        enableStackTrace: true, // Helpful for debugging failed tests
        enableColors: false,
        // Test-specific logging
        testResults: {
            enabled: true,
            format: 'json',
            destination: path.join(process.cwd(), 'test-results')
        }
    },
    
    // Email configuration (mocked)
    email: {
        enabled: false, // Disabled by default in tests
        mockMode: true, // Always use mock mode
        host: 'localhost',
        port: 1025,
        secure: false,
        auth: {
            user: 'test@example.com',
            pass: 'testpassword'
        },
        from: {
            name: 'MyStore Test',
            address: 'noreply@test.mystore.com'
        },
        templateDir: path.join(process.cwd(), 'templates', 'email'),
        logEmails: process.env.LOG_TEST_EMAILS === 'true',
        // Test-specific settings
        capture: true, // Capture emails for verification
        storage: path.join(process.cwd(), 'test-emails'),
        autoCleanup: true
    },
    
    // Upload configuration (test environment)
    upload: {
        maxSize: 100 * 1024 * 1024, // 100MB for large test files
        maxFiles: 50,
        allowedTypes: [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'application/msword',
            'text/plain', 'text/csv', 'application/json',
            'application/zip' // Allow more types for testing
        ],
        destination: path.join(process.cwd(), 'test-uploads'),
        enableImageProcessing: false, // Disable for faster tests
        enableVirusScan: false, // Disabled in tests
        enableCompression: false,
        // Test-specific settings
        cleanup: true, // Clean up uploaded files after tests
        mockStorage: process.env.MOCK_STORAGE === 'true'
    },
    
    // Cache configuration (test-optimized)
    cache: {
        enabled: process.env.TEST_CACHE_ENABLED === 'true',
        ttl: 60, // Short TTL for tests
        maxSize: 10 * 1024 * 1024, // 10MB
        compression: false,
        keyPrefix: 'mystore:test:',
        enableMetrics: false,
        // Test-specific settings
        mockMode: process.env.MOCK_CACHE === 'true',
        clearOnStart: true,
        clearOnEnd: true
    },
    
    // API configuration
    api: {
        version: 'v1',
        prefix: '/api/v1',
        baseUrl: process.env.TEST_API_BASE_URL || 'http://localhost:3000/api/v1',
        pagination: {
            defaultLimit: 10, // Smaller for faster tests
            maxLimit: 50
        },
        validation: {
            stripUnknown: true,
            abortEarly: true, // Fail fast in tests
            allowUnknown: true // More permissive for test data
        },
        requestTimeout: 5000, // 5 seconds for tests
        enableVersioning: false // Simplified for tests
    },
    
    // External services (all mocked)
    services: {
        // Payment processing (test/mock mode)
        stripe: {
            enabled: false, // Disabled by default
            secretKey: 'sk_test_mock_key_for_testing_only',
            publishableKey: 'pk_test_mock_key_for_testing_only',
            webhookSecret: 'whsec_test_mock_secret',
            testMode: true,
            mockMode: true, // Use mock Stripe
            apiVersion: '2023-10-16'
        },
        
        // AWS services (mocked)
        aws: {
            enabled: false,
            region: 'us-east-1',
            accessKeyId: 'test-access-key',
            secretAccessKey: 'test-secret-key',
            s3: {
                bucket: 'test-bucket',
                endpoint: 'http://localhost:4566', // LocalStack
                forcePathStyle: true,
                mockMode: true
            },
            ses: {
                enabled: false,
                mockMode: true
            }
        },
        
        // Monitoring services (disabled)
        sentry: {
            enabled: false,
            dsn: 'test-dsn',
            environment: 'test',
            debug: false
        }
    },
    
    // OAuth providers (mocked)
    oauth: {
        google: {
            enabled: false,
            clientId: 'test-google-client-id',
            clientSecret: 'test-google-client-secret',
            callbackUrl: 'http://localhost:3000/auth/google/callback',
            mockMode: true
        },
        facebook: {
            enabled: false,
            clientId: 'test-facebook-app-id',
            clientSecret: 'test-facebook-app-secret',
            callbackUrl: 'http://localhost:3000/auth/facebook/callback',
            mockMode: true
        },
        github: {
            enabled: false,
            clientId: 'test-github-client-id',
            clientSecret: 'test-github-client-secret',
            callbackUrl: 'http://localhost:3000/auth/github/callback',
            mockMode: true
        }
    },
    
    // Feature flags (test-specific)
    features: {
        enableSwagger: false, // Disabled for faster tests
        enableGraphQL: false,
        enableMetrics: false,
        enableHealthChecks: false,
        enableDebugRoutes: true, // Helpful for test debugging
        enableMockData: true,
        enableHotReload: false,
        enableSourceMaps: true, // Helpful for debugging
        enableAnalytics: false,
        enableErrorReporting: false
    },
    
    // Testing configuration
    testing: {
        // Test framework settings
        framework: process.env.TEST_FRAMEWORK || 'jest',
        timeout: parseInt(process.env.TEST_TIMEOUT) || 30000, // 30 seconds
        retries: parseInt(process.env.TEST_RETRIES) || 0,
        parallel: process.env.TEST_PARALLEL !== 'false',
        maxWorkers: process.env.TEST_MAX_WORKERS || '50%',
        
        // Test data management
        fixtures: {
            enabled: true,
            directory: path.join(process.cwd(), 'test', 'fixtures'),
            autoLoad: true,
            format: 'json'
        },
        
        // Database seeding for tests
        seeding: {
            enabled: process.env.ENABLE_TEST_SEEDING === 'true',
            resetBetweenTests: true,
            seedUsers: 5,
            seedProducts: 10,
            seedOrders: 3
        },
        
        // Mock configurations
        mocks: {
            enabled: true,
            directory: path.join(process.cwd(), 'test', 'mocks'),
            autoSetup: true,
            
            // HTTP mocks
            http: {
                enabled: process.env.MOCK_HTTP === 'true',
                port: 3001,
                recordMode: false
            },
            
            // External service mocks
            services: {
                stripe: true,
                aws: true,
                email: true,
                oauth: true
            }
        },
        
        // Test coverage
        coverage: {
            enabled: process.env.ENABLE_COVERAGE !== 'false',
            threshold: {
                global: {
                    branches: 80,
                    functions: 80,
                    lines: 80,
                    statements: 80
                }
            },
            reporters: ['text', 'lcov', 'html'],
            directory: path.join(process.cwd(), 'coverage')
        },
        
        // Performance testing
        performance: {
            enabled: process.env.ENABLE_PERFORMANCE_TESTS === 'true',
            maxResponseTime: 1000, // 1 second
            maxMemoryUsage: 100 * 1024 * 1024 // 100MB
        }
    },
    
    // Monitoring (minimal for tests)
    monitoring: {
        enabled: false,
        prometheus: {
            enabled: false
        },
        healthChecks: {
            enabled: false
        },
        performanceMonitoring: {
            enabled: false
        },
        alerting: {
            enabled: false
        }
    },
    
    // Session configuration
    session: {
        secret: 'test-session-secret-not-for-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 60 * 60 * 1000 // 1 hour
        },
        name: 'mystore.test.sid',
        // Use memory store for tests
        store: 'memory'
    },
    
    // Static files (disabled)
    static: {
        enabled: false,
        directory: path.join(process.cwd(), 'public'),
        maxAge: 0,
        etag: false,
        lastModified: false
    },
    
    // Test utilities
    utilities: {
        // Helper functions for tests
        database: {
            cleanup: async () => {
                // Cleanup function for database
            },
            seed: async (data) => {
                // Seeding function
            },
            reset: async () => {
                // Reset function
            }
        },
        
        // Test data generators
        generators: {
            user: () => ({
                name: 'Test User',
                email: `test${Date.now()}@example.com`,
                password: 'TestPassword123!'
            }),
            product: () => ({
                name: 'Test Product',
                price: Math.floor(Math.random() * 100) + 1,
                description: 'Test product description'
            })
        },
        
        // Test assertions
        assertions: {
            validateEmailSent: (emailData) => {
                // Custom email validation
            },
            validateApiResponse: (response, schema) => {
                // API response validation
            }
        }
    },
    
    // CI/CD specific settings
    ci: {
        enabled: process.env.CI === 'true',
        provider: process.env.CI_PROVIDER || 'github-actions',
        timeout: parseInt(process.env.CI_TIMEOUT) || 600000, // 10 minutes
        retries: parseInt(process.env.CI_RETRIES) || 2,
        
        // Artifact storage
        artifacts: {
            enabled: true,
            directory: path.join(process.cwd(), 'test-artifacts'),
            include: ['coverage', 'test-results', 'screenshots', 'logs']
        }
    },
    
    // Environment cleanup
    cleanup: {
        onStart: {
            clearCache: true,
            dropDatabase: process.env.DROP_TEST_DB !== 'false',
            clearUploads: true,
            clearLogs: true
        },
        onEnd: {
            clearCache: true,
            clearUploads: true,
            preserveLogs: process.env.PRESERVE_TEST_LOGS === 'true'
        }
    }
};
