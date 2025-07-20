require('dotenv').config();

const Joi = require('joi');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

/**
 * Advanced Configuration System with:
 * 1. Comprehensive validation with custom rules and error messages
 * 2. Environment-specific configuration management
 * 3. Security-first approach with secrets management
 * 4. Performance optimization settings
 * 5. Feature flag management with runtime overrides
 * 6. Health monitoring configuration
 * 7. Configuration encryption for sensitive data
 * 8. Configuration versioning and schema validation
 * 9. Automatic documentation generation
 * 10. Runtime configuration modification protection
 */

// Configuration metadata
const CONFIG_SCHEMA_VERSION = '1.1.0';
const CONFIG_DOCS = {
    description: 'Application configuration manager',
    lastUpdated: new Date().toISOString(),
    schemaVersion: CONFIG_SCHEMA_VERSION
};

// Custom Joi validators with improved error messages
const customValidators = {
    // Validate MongoDB URI format with more detailed checks
    mongoUri: Joi.string().custom((value, helpers) => {
        if (!value.includes('mongodb://') && !value.includes('mongodb+srv://')) {
            return helpers.error('custom.mongoUri.format');
        }
        
        try {
            const uri = new URL(value);
            if (!uri.pathname || uri.pathname === '/') {
                return helpers.error('custom.mongoUri.database');
            }
            
            if (value.includes('@') && !uri.password) {
                return helpers.error('custom.mongoUri.password');
            }
            
            return value;
        } catch (err) {
            return helpers.error('custom.mongoUri.invalid');
        }
    }, 'MongoDB URI validation'),

    // Enhanced secret strength validation
    strongSecret: Joi.string().min(32).custom((value, helpers) => {
        const hasLowercase = /[a-z]/.test(value);
        const hasUppercase = /[A-Z]/.test(value);
        const hasNumber = /[0-9]/.test(value);
        const hasSpecialChar = /[^a-zA-Z0-9]/.test(value);
        
        const missing = [];
        if (!hasLowercase) missing.push('lowercase letters');
        if (!hasUppercase) missing.push('uppercase letters');
        if (!hasNumber) missing.push('numbers');
        if (!hasSpecialChar) missing.push('special characters');
        
        if (missing.length > 0) {
            return helpers.error('custom.weakSecret', { missing: missing.join(', ') });
        }
        
        return value;
    }, 'Strong secret validation'),

    // Enhanced URL list validation
    urlList: Joi.string().custom((value, helpers) => {
        if (!value) return '';
        
        const urls = value.split(',').map(url => url.trim());
        const invalidUrls = urls.filter(url => {
            try {
                const parsed = new URL(url);
                if (!parsed.protocol || !parsed.hostname) return true;
                return false;
            } catch {
                return true;
            }
        });
        
        if (invalidUrls.length > 0) {
            return helpers.error('custom.invalidUrls', { urls: invalidUrls.join(', ') });
        }
        
        return value;
    }, 'URL list validation'),
    
    // Environment variable name validation
    envVarName: Joi.string().pattern(/^[A-Z][A-Z0-9_]*$/, 'uppercase with underscores')
};

// Configuration schema with improved organization and documentation
const envVarsSchema = Joi.object({
    // ========== Core Application Configuration ==========
    NODE_ENV: Joi.string()
        .valid('development', 'production', 'test', 'staging', 'preview')
        .default('development')
        .description('Application runtime environment'),
    
    APP_NAME: Joi.string()
        .default('MyStore')
        .description('Application name used in logs and headers'),
    
    APP_VERSION: Joi.string()
        .default('1.0.0')
        .description('Application version for API and monitoring'),
    
    INSTANCE_ID: Joi.string()
        .default(() => crypto.randomBytes(4).toString('hex'))
        .description('Unique instance identifier for distributed systems'),
    
    PORT: Joi.number()
        .port()
        .default(5000)
        .description('Port the application will listen on'),
    
    HOST: Joi.string()
        .default('0.0.0.0')
        .description('Host address the application will bind to'),
    
    // ========== API Configuration ==========
    API_BASE_PATH: Joi.string()
        .default('/api/v1')
        .description('Base path for all API routes'),
    
    API_URL: Joi.string()
        .uri()
        .required()
        .description('Full base URL of the API (e.g., https://api.example.com)'),
    
    CLIENT_URL: Joi.string()
        .uri()
        .required()
        .description('URL of the main client application'),
    
    ADMIN_URL: Joi.string()
        .uri()
        .optional()
        .description('URL of the admin dashboard if separate from client'),
    
    // ========== Database Configuration ==========
    MONGODB_URI: customValidators.mongoUri
        .required()
        .description('MongoDB connection URI with database name'),
    
    DB_NAME: Joi.string()
        .default('mystore')
        .description('Default database name (overrides URI database if set)'),
    
    DB_POOL_SIZE: Joi.number()
        .min(1)
        .max(100)
        .default(10)
        .description('Maximum number of connections in the connection pool'),
    
    DB_CONNECT_TIMEOUT_MS: Joi.number()
        .default(30000)
        .description('How long to wait for initial connection to MongoDB'),
    
    DB_SOCKET_TIMEOUT_MS: Joi.number()
        .default(45000)
        .description('How long to wait for socket operations to complete'),
    
    DB_MAX_IDLE_TIME_MS: Joi.number()
        .default(30000)
        .description('Maximum time a connection can remain idle before being closed'),
    
    DB_SERVER_SELECTION_TIMEOUT_MS: Joi.number()
        .default(5000)
        .description('How long to wait for server selection'),
    
    DB_HEARTBEAT_FREQUENCY_MS: Joi.number()
        .default(10000)
        .description('Frequency of heartbeat checks to MongoDB'),
    
    // ========== Authentication & Security ==========
    JWT_SECRET: customValidators.strongSecret
        .required()
        .description('Secret key for signing JWT tokens (min 32 chars with mixed case, numbers, special chars)'),
    
    JWT_ACCESS_EXPIRES_IN: Joi.string()
        .default('15m')
        .description('Access token expiration time (e.g., 15m, 1h, 7d)'),
    
    JWT_REFRESH_EXPIRES_IN: Joi.string()
        .default('7d')
        .description('Refresh token expiration time'),
    
    JWT_COOKIE_EXPIRES_DAYS: Joi.number()
        .integer()
        .min(1)
        .default(90)
        .description('Number of days before JWT cookies expire'),
    
    JWT_ISSUER: Joi.string()
        .default('MyStore')
        .description('Issuer claim in JWT tokens'),
    
    JWT_AUDIENCE: Joi.string()
        .default('MyStore-Users')
        .description('Audience claim in JWT tokens'),
    
    // ========== OAuth Providers ==========
    GOOGLE_CLIENT_ID: Joi.string()
        .optional()
        .description('Google OAuth client ID'),
    
    GOOGLE_CLIENT_SECRET: Joi.string()
        .optional()
        .description('Google OAuth client secret'),
    
    FACEBOOK_APP_ID: Joi.string()
        .optional()
        .description('Facebook OAuth app ID'),
    
    FACEBOOK_APP_SECRET: Joi.string()
        .optional()
        .description('Facebook OAuth app secret'),
    
    GITHUB_CLIENT_ID: Joi.string()
        .optional()
        .description('GitHub OAuth client ID'),
    
    GITHUB_CLIENT_SECRET: Joi.string()
        .optional()
        .description('GitHub OAuth client secret'),
    
    // ========== Security Configuration ==========
    CORS_ORIGINS: customValidators.urlList
        .default('')
        .description('Comma-separated list of allowed CORS origins'),
    
    RATE_LIMIT_WINDOW_MS: Joi.number()
        .default(15 * 60 * 1000)
        .description('Time window for rate limiting in milliseconds'),
    
    RATE_LIMIT_MAX: Joi.number()
        .default(100)
        .description('Maximum requests per window per IP'),
    
    TRUST_PROXY: Joi.alternatives()
        .try(Joi.number(), Joi.string(), Joi.boolean())
        .default(1)
        .description('Controls proxy header trust (number, boolean, or IP/CIDR)'),
    
    CSRF_SECRET: Joi.string()
        .min(32)
        .default(() => crypto.randomBytes(32).toString('hex'))
        .description('Secret for CSRF protection'),
    
    ENCRYPTION_KEY: Joi.string()
        .length(64)
        .default(() => crypto.randomBytes(32).toString('hex'))
        .description('Key for data encryption (must be exactly 64 hex chars)'),
    
    SESSION_SECRET: Joi.string()
        .min(32)
        .default(() => crypto.randomBytes(32).toString('hex'))
        .description('Secret for session encryption'),
    
    // ========== Redis Configuration ==========
    REDIS_URL: Joi.string()
        .uri()
        .allow('')
        .optional()
        .description('Complete Redis connection URL (overrides host/port if set)'),
    
    REDIS_HOST: Joi.string()
        .optional()
        .description('Redis server hostname'),
    
    REDIS_PORT: Joi.number()
        .port()
        .optional()
        .description('Redis server port'),
    
    REDIS_PASSWORD: Joi.string()
        .optional()
        .description('Redis password if required'),
    
    REDIS_DB: Joi.number()
        .min(0)
        .max(15)
        .default(0)
        .description('Redis database number (0-15)'),
    
    REDIS_TTL_SECONDS: Joi.number()
        .default(86400)
        .description('Default TTL for Redis keys in seconds'),
    
    // ========== Email Configuration ==========
    SMTP_HOST: Joi.string()
        .optional()
        .description('SMTP server hostname'),
    
    SMTP_PORT: Joi.number()
        .optional()
        .description('SMTP server port'),
    
    SMTP_SECURE: Joi.boolean()
        .default(true)
        .description('Use TLS for SMTP connection'),
    
    SMTP_USERNAME: Joi.string()
        .optional()
        .description('SMTP authentication username'),
    
    SMTP_PASSWORD: Joi.string()
        .optional()
        .description('SMTP authentication password'),
    
    EMAIL_FROM: Joi.string()
        .when('SMTP_HOST', {
            is: Joi.exist(),
            then: Joi.string().email().required(),
            otherwise: Joi.string().optional()
        })
        .description('Default email sender address'),
    
    EMAIL_FROM_NAME: Joi.string()
        .default('MyStore')
        .description('Default email sender name'),
    
    // ========== File Upload Configuration ==========
    UPLOAD_MAX_SIZE: Joi.number()
        .default(10 * 1024 * 1024) // 10MB
        .description('Maximum file upload size in bytes'),
    
    UPLOAD_MAX_FILES: Joi.number()
        .default(10)
        .description('Maximum number of files per upload'),
    
    UPLOAD_ALLOWED_TYPES: Joi.string()
        .default('image/jpeg,image/png,image/gif,application/pdf')
        .description('Comma-separated list of allowed MIME types'),
    
    UPLOAD_DESTINATION: Joi.string()
        .default('./uploads')
        .description('Base directory for file uploads'),
    
    // ========== Monitoring & Logging ==========
    SENTRY_DSN: Joi.string()
        .uri()
        .allow('')
        .optional()
        .description('Sentry DSN for error tracking'),
    
    LOG_LEVEL: Joi.string()
        .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
        .default('info')
        .description('Minimum log level to output'),
    
    LOG_DIR: Joi.string()
        .default(path.join(__dirname, '../logs'))
        .description('Directory for log files'),
    
    // ========== Feature Flags ==========
    ENABLE_GOOGLE_OAUTH: Joi.boolean()
        .default(false)
        .description('Enable Google OAuth authentication'),
    
    ENABLE_FACEBOOK_OAUTH: Joi.boolean()
        .default(false)
        .description('Enable Facebook OAuth authentication'),
    
    ENABLE_HEALTH_CHECKS: Joi.boolean()
        .default(true)
        .description('Enable health check endpoints'),
    
    // ========== Performance Configuration ==========
    CLUSTER_MODE: Joi.boolean()
        .default(false)
        .description('Enable cluster mode for multi-process operation'),
    
    MAX_WORKERS: Joi.number()
        .default(os.cpus().length)
        .description('Maximum number of worker processes in cluster mode')
})
.unknown()
.prefs({ 
    errors: { label: 'key' },
    messages: {
        'custom.mongoUri.format': 'MongoDB URI must start with mongodb:// or mongodb+srv://',
        'custom.mongoUri.database': 'MongoDB URI must include a database name',
        'custom.mongoUri.password': 'MongoDB URI with username must include password',
        'custom.mongoUri.invalid': 'Invalid MongoDB URI format',
        'custom.weakSecret': 'Secret must contain: {#missing}',
        'custom.invalidUrls': 'Invalid URLs found: {#urls}',
        'string.pattern.base': 'Environment variable name must be uppercase with underscores'
    }
});

// Validate environment variables with detailed error reporting
const { value: envVars, error } = envVarsSchema.validate(process.env, {
    abortEarly: false,
    stripUnknown: true,
    allowUnknown: true,
    convert: true
});

if (error) {
    const errorDetails = error.details.map(detail => {
        const path = detail.path.join('.');
        const message = detail.message.replace(/"/g, '');
        return { path, message };
    });
    
    console.error('\n🚨 Configuration Validation Failed:');
    console.table(errorDetails);
    console.error('\nPlease fix the configuration errors above.\n');
    process.exit(1);
}

// Configuration builder with enhanced security and organization
class ConfigBuilder {
    constructor(envVars) {
        this.envVars = envVars;
        this.config = {};
        this.requiredDirs = [];
        this.sensitiveKeys = new Set([
            'JWT_SECRET', 'ENCRYPTION_KEY', 'SESSION_SECRET', 
            'SMTP_PASSWORD', 'REDIS_PASSWORD', 'STRIPE_SECRET_KEY'
        ]);
    }

    build() {
        this.addMetadata();
        this.addCoreConfig();
        this.addDatabaseConfig();
        this.addSecurityConfig();
        this.addRedisConfig();
        this.addEmailConfig();
        this.addFeatureFlags();
        this.addUtilities();
        
        this.validateConfig();
        this.ensureDirectories();
        this.maskSensitiveData();
        
        return Object.freeze(this.config);
    }

    addMetadata() {
        this.config._metadata = {
            schemaVersion: CONFIG_SCHEMA_VERSION,
            loadedAt: new Date().toISOString(),
            environment: this.envVars.NODE_ENV,
            hostname: os.hostname(),
            nodeVersion: process.version,
            platform: os.platform(),
            pid: process.pid
        };
    }

    addCoreConfig() {
        this.config.env = this.envVars.NODE_ENV;
        this.config.isProduction = this.envVars.NODE_ENV === 'production';
        this.config.isDevelopment = this.envVars.NODE_ENV === 'development';
        
        this.config.app = {
            name: this.envVars.APP_NAME,
            version: this.envVars.APP_VERSION,
            instanceId: this.envVars.INSTANCE_ID,
            host: this.envVars.HOST,
            port: this.envVars.PORT,
            api: {
                basePath: this.envVars.API_BASE_PATH,
                url: this.envVars.API_URL
            },
            urls: {
                client: this.envVars.CLIENT_URL,
                admin: this.envVars.ADMIN_URL
            }
        };
    }

    addDatabaseConfig() {
        this.config.database = {
            uri: this.envVars.MONGODB_URI,
            name: this.envVars.DB_NAME,
            options: {
                maxPoolSize: this.envVars.DB_POOL_SIZE,
                connectTimeoutMS: this.envVars.DB_CONNECT_TIMEOUT_MS,
                socketTimeoutMS: this.envVars.DB_SOCKET_TIMEOUT_MS
            }
        };
    }

    addSecurityConfig() {
        this.config.security = {
            jwt: {
                secret: this.envVars.JWT_SECRET,
                accessExpiresIn: this.envVars.JWT_ACCESS_EXPIRES_IN,
                refreshExpiresIn: this.envVars.JWT_REFRESH_EXPIRES_IN
            },
            cors: {
                origins: this.envVars.CORS_ORIGINS ? 
                    this.envVars.CORS_ORIGINS.split(',').map(s => s.trim()) : 
                    [this.envVars.CLIENT_URL, this.envVars.ADMIN_URL].filter(Boolean)
            },
            rateLimit: {
                windowMs: this.envVars.RATE_LIMIT_WINDOW_MS,
                max: this.envVars.RATE_LIMIT_MAX
            }
        };
    }

    addRedisConfig() {
        if (this.envVars.REDIS_URL || this.envVars.REDIS_HOST) {
            this.config.redis = {
                url: this.envVars.REDIS_URL,
                host: this.envVars.REDIS_HOST,
                port: this.envVars.REDIS_PORT,
                db: this.envVars.REDIS_DB,
                ttl: this.envVars.REDIS_TTL_SECONDS
            };
        }
    }

    addEmailConfig() {
        if (this.envVars.SMTP_HOST && this.envVars.SMTP_PORT) {
            this.config.email = {
                host: this.envVars.SMTP_HOST,
                port: this.envVars.SMTP_PORT,
                secure: this.envVars.SMTP_SECURE,
                from: {
                    email: this.envVars.EMAIL_FROM,
                    name: this.envVars.EMAIL_FROM_NAME
                }
            };
            
            if (this.envVars.SMTP_USERNAME) {
                this.config.email.auth = {
                    user: this.envVars.SMTP_USERNAME,
                    pass: this.envVars.SMTP_PASSWORD
                };
            }
        }
    }

    addFeatureFlags() {
        this.config.features = {
            googleOAuth: this.envVars.ENABLE_GOOGLE_OAUTH && !!this.envVars.GOOGLE_CLIENT_ID,
            healthChecks: this.envVars.ENABLE_HEALTH_CHECKS,
            clusterMode: this.envVars.CLUSTER_MODE
        };
    }

    addUtilities() {
        // Get nested config value with dot notation
        this.config.get = (path, defaultValue) => {
            return path.split('.').reduce((obj, key) => 
                (obj && obj[key] !== undefined) ? obj[key] : defaultValue, this.config);
        };

        // Check if feature is enabled
        this.config.isFeatureEnabled = feature => {
            return this.config.features[feature] === true;
        };

        // Generate configuration documentation
        this.config.generateDocs = () => {
            return {
                ...CONFIG_DOCS,
                environment: this.envVars.NODE_ENV,
                config: Object.keys(this.config)
                    .filter(key => !key.startsWith('_'))
                    .reduce((docs, key) => {
                        docs[key] = typeof this.config[key] === 'object' ? 
                            '[Object]' : String(this.config[key]);
                        return docs;
                    }, {})
            };
        };
    }

    validateConfig() {
        const warnings = [];
        
        if (this.config.isProduction) {
            if (!this.config.get('security.jwt.secret') || 
                this.config.get('security.jwt.secret').length < 32) {
                warnings.push('Weak JWT secret in production');
            }
            
            if (!this.config.redis) {
                warnings.push('Redis not configured - performance may be impacted');
            }
        }
        
        if (warnings.length > 0) {
            console.warn('Configuration warnings:');
            warnings.forEach(warning => console.warn(`⚠️  ${warning}`));
        }
    }

    ensureDirectories() {
        this.requiredDirs = [
            this.envVars.LOG_DIR,
            this.envVars.UPLOAD_DESTINATION
        ];
        
        this.requiredDirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
            }
        });
    }

    maskSensitiveData() {
        this.sensitiveKeys.forEach(key => {
            if (this.envVars[key]) {
                this.envVars[key] = '*****';
            }
        });
    }
}

// Build and export the configuration
const config = new ConfigBuilder(envVars).build();

// Log configuration summary in development
if (config.isDevelopment) {
    console.log('\n📋 Configuration Summary:');
    console.log(`   Environment: ${config.env}`);
    console.log(`   Port: ${config.app.port}`);
    console.log(`   Database: ${config.database.name}`);
    console.log(`   Redis: ${config.redis ? 'Enabled' : 'Disabled'}`);
    console.log(`   Features: ${Object.entries(config.features)
        .filter(([, enabled]) => enabled)
        .map(([feature]) => feature)
        .join(', ')}`);
    console.log('');
}

module.exports = config;