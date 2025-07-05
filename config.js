const Joi = require('joi');
const path = require('path');
const { exit } = require('process');

// Enhanced validation schema
const envVarsSchema = Joi.object({
  // App Configuration
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(5000),
  FRONTEND_URL: Joi.string().uri().required(),
  APP_NAME: Joi.string().default('MyStore'),
  API_BASE_PATH: Joi.string().default('/api/v1'),
  SERVER_TIMEOUT: Joi.number().default(30000),

  // Database
  MONGODB_URI: Joi.string().uri().required(),
  DB_POOL_SIZE: Joi.number().min(1).max(100).default(20),
  DB_CONNECTION_TIMEOUT: Joi.number().min(1000).default(5000),
  DB_SOCKET_TIMEOUT: Joi.number().min(1000).default(30000),

  // Redis
  REDIS_URL: Joi.string().uri().required(),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_TTL: Joi.number().min(60).default(86400), // 1 day min
  SESSION_SECRET: Joi.string().min(32).required(),
  SESSION_COOKIE_NAME: Joi.string().default('session'),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  JWT_ISSUER: Joi.string().default('your-app-name'),
  JWT_AUDIENCE: Joi.string().default('your-app-client'),
  JWT_COOKIE_EXPIRES: Joi.number().default(7), // In days
  COOKIE_DOMAIN: Joi.string().default('localhost'),

  // Security
  CSRF_SECRET: Joi.string().min(32).required(),
  COOKIE_SECRET: Joi.string().min(32).required(),
  TRUST_PROXY: Joi.string().default('loopback'),
  CORS_ORIGINS: Joi.string().required(), // Comma-separated origins
  MAX_JSON_REQUEST_SIZE: Joi.string().default('1mb'),
  MAX_URL_ENCODED_REQUEST_SIZE: Joi.string().default('1mb'),
  HELMET_ENABLE: Joi.boolean().default(true),
  HSTS_MAX_AGE: Joi.number().default(31536000), // 1 year
  CONTENT_SECURITY_POLICY: Joi.string().default("default-src 'self'"),

  // Email
  EMAIL_HOST: Joi.string().required(),
  EMAIL_PORT: Joi.number().port().required(),
  EMAIL_USER: Joi.string().required(),
  EMAIL_PASS: Joi.string().allow('').default(''),
  EMAIL_SECURE: Joi.boolean().default(false),
  EMAIL_RETRY_ATTEMPTS: Joi.number().default(3),

  // Uploads
  UPLOAD_DIR: Joi.string().default('uploads'),
  MAX_FILE_SIZE: Joi.number().default(5 * 1024 * 1024), // 5MB
  ALLOWED_FILE_TYPES: Joi.string().default('image/jpeg,image/png,application/pdf'),

  // Features
  FEATURE_EMAIL_VERIFICATION: Joi.boolean().default(false),
  FEATURE_2FA: Joi.boolean().default(false),
  FEATURE_RATE_LIMITING: Joi.boolean().default(true),

  // Maintenance
  MAINTENANCE_MODE: Joi.boolean().default(false),
  MAINTENANCE_ALLOWED_IPS: Joi.string().allow('').default(''),

  // Sentry (Error Tracking)
  SENTRY_DSN: Joi.string().allow('').default(''),

  // Google OAuth Credentials - NEWLY ADDED!
  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().required()

}).unknown()
  .and('EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER'); // Require all email settings if one is present

// Load environment variables
const { error, value: envVars } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  console.error(`❌ Config validation error: ${error.message}`);
  exit(1); // Exit if environment variables are not correctly configured
}

const config = {
  env: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
  isDevelopment: envVars.NODE_ENV === 'development',
  isTest: envVars.NODE_ENV === 'test',
  port: envVars.PORT,
  frontendUrl: envVars.FRONTEND_URL,
  app: {
    name: envVars.APP_NAME,
    apiBasePath: envVars.API_BASE_PATH,
    version: '1.0.0' // Consider reading this from package.json
  },
  db: {
    uri: envVars.MONGODB_URI,
    options: {
      poolSize: envVars.DB_POOL_SIZE,
      connectTimeoutMS: envVars.DB_CONNECTION_TIMEOUT,
      socketTimeoutMS: envVars.DB_SOCKET_TIMEOUT,
      autoIndex: envVars.NODE_ENV === 'development' // Auto-index only in development
    }
  },
  redis: {
    url: envVars.REDIS_URL,
    password: envVars.REDIS_PASSWORD,
    ttl: envVars.REDIS_TTL,
    sessionSecure: envVars.NODE_ENV === 'production' // Session cookie secure only in production
  },
  jwt: {
    accessSecret: envVars.JWT_ACCESS_SECRET,
    refreshSecret: envVars.JWT_REFRESH_SECRET,
    accessExpiresIn: envVars.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
    algorithm: 'HS256',
    issuer: envVars.JWT_ISSUER,
    audience: envVars.JWT_AUDIENCE,
    cookie: {
      domain: envVars.COOKIE_DOMAIN,
      secure: envVars.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax', // Use 'lax' for CSRF protection and better compatibility
      expires: new Date(Date.now() + envVars.JWT_COOKIE_EXPIRES * 24 * 60 * 60 * 1000)
    }
  },
  security: {
    csrfSecret: envVars.CSRF_SECRET,
    cookieSecret: envVars.COOKIE_SECRET,
    rateLimit: {
      windowMs: envVars.FEATURE_RATE_LIMITING ? envVars.RATE_LIMIT_WINDOW_MS || 900000 : 0, // 15 mins
      max: envVars.FEATURE_RATE_LIMITING ? envVars.RATE_LIMIT_MAX || 100 : 9999999 // Max requests per window
    },
    cors: {
      origin: envVars.CORS_ORIGINS.split(',').map(o => o.trim()),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-CSRF-Token']
    },
    hsts: {
      maxAge: envVars.HSTS_MAX_AGE,
      includeSubDomains: true
    },
    csp: envVars.CONTENT_SECURITY_POLICY
  },

  email: {
    host: envVars.EMAIL_HOST,
    port: envVars.EMAIL_PORT,
    auth: {
      user: envVars.EMAIL_USER,
      pass: envVars.EMAIL_PASS
    },
    secure: envVars.EMAIL_SECURE,
    requireTLS: true, // Often recommended for STARTTLS
    retryAttempts: envVars.EMAIL_RETRY_ATTEMPTS
  },

  uploads: {
    dir: path.resolve(__dirname, '../', envVars.UPLOAD_DIR),
    maxSize: envVars.MAX_FILE_SIZE,
    allowedTypes: envVars.ALLOWED_FILE_TYPES.split(',').map(t => t.trim())
  },

  features: {
    emailVerification: envVars.FEATURE_EMAIL_VERIFICATION,
    twoFactorAuth: envVars.FEATURE_2FA,
    rateLimiting: envVars.FEATURE_RATE_LIMITING
  },

  maintenance: {
    enabled: envVars.MAINTENANCE_MODE,
    allowedIPs: envVars.MAINTENANCE_ALLOWED_IPS.split(',').filter(ip => ip.trim())
  },

  sentry: {
    dsn: envVars.SENTRY_DSN
  },

  // Google OAuth Configuration - NEWLY ADDED!
  google: {
    clientId: envVars.GOOGLE_CLIENT_ID,
    clientSecret: envVars.GOOGLE_CLIENT_SECRET,
    callbackUrl: envVars.GOOGLE_CALLBACK_URL
  }
};

// Development logging with sensitive data masked
if (envVars.NODE_ENV === 'development') {
  const maskedConfig = {
    ...config,
    db: { ...config.db, uri: '***' }, // Mask database URI
    redis: { ...config.redis, password: '***' }, // Mask Redis password
    jwt: {
      ...config.jwt,
      accessSecret: '***',
      refreshSecret: '***',
      cookie: { ...config.jwt.cookie, domain: '***', secure: '***' } // Mask cookie domain/secure
    },
    security: {
      ...config.security,
      csrfSecret: '***',
      cookieSecret: '***'
    },
    email: {
      ...config.email,
      auth: { user: '***', pass: '***' }
    },
    google: { // Mask Google secrets
        ...config.google,
        clientId: '***',
        clientSecret: '***'
    }
  };
  console.log('⚙️ Loaded configuration:', maskedConfig);
}

module.exports = config;