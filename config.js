const { NODE_ENV = 'development' } = process.env;

if (NODE_ENV === 'production') {
  const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET', 'FRONTEND_URL'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
}

module.exports = {
  NODE_ENV,
  PORT: parseInt(process.env.PORT, 10) || 5000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce',
  JWT_SECRET: process.env.JWT_SECRET || (NODE_ENV === 'production' ? null : 'your-secret-key'),
  JWT_EXPIRE: '30d',
  FRONTEND_URL: process.env.FRONTEND_URL || (NODE_ENV === 'production' ? 'https://my-frontend-ifyr.vercel.app' : 'http://localhost:3000'),
  COOKIE_EXPIRE: 30 * 24 * 60 * 60 * 1000,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10),
  SMTP_EMAIL: process.env.SMTP_EMAIL,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@yourstore.com',
  FROM_NAME: process.env.FROM_NAME || 'MyStore'
};
