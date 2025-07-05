const logger = require('../middleware/logger');

module.exports = function validateEnv() {
  const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'FRONTEND_URL'
  ];

  const missingVars = requiredEnvVars.filter(env => !process.env[env]);

  if (missingVars.length > 0) {
    logger.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }

  // Validate MongoDB URI format
  if (!process.env.MONGODB_URI.startsWith('mongodb')) {
    logger.error('❌ Invalid MONGODB_URI format');
    process.exit(1);
  }

  // Validate JWT secret length
  if (process.env.JWT_SECRET.length < 32) {
    logger.error('❌ JWT_SECRET must be at least 32 characters long');
    process.exit(1);
  }
};