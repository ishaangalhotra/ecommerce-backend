require('dotenv').config();
const Joi = require('joi');
const path = require('path');
const fs = require('fs');

// Validation schema for environment variables
const envVarsSchema = Joi.object({
  // Core Configuration
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),
  PORT: Joi.number().port().default(5000),
  API_BASE_PATH: Joi.string().default('/api/v1'),
  API_URL: Joi.string().uri().required(),
  CLIENT_URL: Joi.string().uri().required(),

  // Database Configuration
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  DB_NAME: Joi.string().default('mystore'),
  DB_POOL_SIZE: Joi.number().min(1).max(100).default(10),
  DB_CONNECT_TIMEOUT_MS: Joi.number().default(30000),
  DB_SOCKET_TIMEOUT_MS: Joi.number().default(45000),

  // Authentication
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  JWT_COOKIE_EXPIRES_DAYS: Joi.number().integer().min(1).default(90),

  // OAuth Providers
  GOOGLE_CLIENT_ID: Joi.string().when('ENABLE_GOOGLE_OAUTH', {
    is: Joi.valid('true', '1', true),
    then: Joi.string().required()
  }),
  GOOGLE_CLIENT_SECRET: Joi.string().when('ENABLE_GOOGLE_OAUTH', {
    is: Joi.valid('true', '1', true),
    then: Joi.string().required()
  }),
  FACEBOOK_APP_ID: Joi.string().optional(),
  FACEBOOK_APP_SECRET: Joi.string().optional(),

  // Security
  CORS_ORIGINS: Joi.string().default(''),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: Joi.number().default(100),
  TRUST_PROXY: Joi.number().default(1),
  CSRF_SECRET: Joi.string().min(32).default(() => require('crypto').randomBytes(32).toString('hex')),

  // Services
  REDIS_URL: Joi.string().uri({ scheme: ['redis'] }).optional(),
  REDIS_TTL_SECONDS: Joi.number().default(86400),
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_USERNAME: Joi.string().optional(),
  SMTP_PASSWORD: Joi.string().optional(),
  EMAIL_FROM: Joi.string().email().optional(),

  // Monitoring & Logging
  SENTRY_DSN: Joi.string().uri().optional(),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),
  LOG_DIR: Joi.string().default(path.join(__dirname, '../logs')),

  // Feature Flags
  ENABLE_GOOGLE_OAUTH: Joi.boolean().default(false),
  ENABLE_RATE_LIMITING: Joi.boolean().default(true)
})
.unknown()
.prefs({ errors: { label: 'key' } });

// Validate environment variables
const { value: envVars, error } = envVarsSchema.validate(process.env, {
  abortEarly: false,
  stripUnknown: true,
  allowUnknown: true
});

if (error) {
  const errorMessages = error.details.map(detail => {
    return `${detail.message}`;
  }).join('\n  ');
  throw new Error(`Config validation error:\n  ${errorMessages}`);
}

// Ensure log directory exists
if (!fs.existsSync(envVars.LOG_DIR)) {
  fs.mkdirSync(envVars.LOG_DIR, { recursive: true });
}

// Export configuration
module.exports = {
  env: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
  isDevelopment: envVars.NODE_ENV === 'development',
  isTest: envVars.NODE_ENV === 'test',
  port: envVars.PORT,
  api: {
    basePath: envVars.API_BASE_PATH,
    url: envVars.API_URL,
    clientUrl: envVars.CLIENT_URL
  },
  db: {
    uri: envVars.MONGODB_URI,
    name: envVars.DB_NAME,
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      poolSize: envVars.DB_POOL_SIZE,
      connectTimeoutMS: envVars.DB_CONNECT_TIMEOUT_MS,
      socketTimeoutMS: envVars.DB_SOCKET_TIMEOUT_MS,
      autoIndex: envVars.NODE_ENV !== 'production'
    }
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpiresIn: envVars.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
    cookie: {
      secure: envVars.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: envVars.NODE_ENV === 'production' ? 'none' : 'lax',
      expires: new Date(Date.now() + envVars.JWT_COOKIE_EXPIRES_DAYS * 24 * 60 * 60 * 1000)
    }
  },
  oauth: {
    google: {
      enabled: envVars.ENABLE_GOOGLE_OAUTH,
      clientId: envVars.GOOGLE_CLIENT_ID,
      clientSecret: envVars.GOOGLE_CLIENT_SECRET,
      callbackUrl: `${envVars.API_URL}/auth/google/callback`,
      scope: ['profile', 'email']
    },
    facebook: {
      enabled: !!envVars.FACEBOOK_APP_ID,
      clientId: envVars.FACEBOOK_APP_ID,
      clientSecret: envVars.FACEBOOK_APP_SECRET,
      callbackUrl: `${envVars.API_URL}/auth/facebook/callback`,
      profileFields: ['id', 'emails', 'name', 'displayName', 'photos']
    }
  },
  security: {
    cors: {
      origin: envVars.CORS_ORIGINS
        ? envVars.CORS_ORIGINS.split(',').map(s => s.trim())
        : [envVars.CLIENT_URL],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true
    },
    rateLimit: {
      enabled: envVars.ENABLE_RATE_LIMITING,
      windowMs: envVars.RATE_LIMIT_WINDOW_MS,
      max: envVars.RATE_LIMIT_MAX
    },
    csrf: {
      secret: envVars.CSRF_SECRET
    },
    trustProxy: envVars.TRUST_PROXY
  },
  redis: envVars.REDIS_URL ? {
    url: envVars.REDIS_URL,
    ttl: envVars.REDIS_TTL_SECONDS
  } : null,
  email: (envVars.SMTP_HOST && envVars.SMTP_PORT) ? {
    host: envVars.SMTP_HOST,
    port: envVars.SMTP_PORT,
    auth: {
      user: envVars.SMTP_USERNAME,
      pass: envVars.SMTP_PASSWORD
    },
    from: envVars.EMAIL_FROM || `MyStore <noreply@${envVars.CLIENT_URL.replace(/^https?:\/\//, '')}>`
  } : null,
  sentry: envVars.SENTRY_DSN ? {
    dsn: envVars.SENTRY_DSN,
    environment: envVars.NODE_ENV,
    tracesSampleRate: 0.1
  } : null,
  logs: {
    level: envVars.LOG_LEVEL,
    directory: envVars.LOG_DIR,
    maxFiles: '30d',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: envVars.NODE_ENV === 'production'
  },
  features: {
    googleOAuth: envVars.ENABLE_GOOGLE_OAUTH,
    rateLimiting: envVars.ENABLE_RATE_LIMITING
  }
};