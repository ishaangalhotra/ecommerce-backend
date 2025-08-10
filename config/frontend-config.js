// Frontend-Backend Connection Configuration
const config = {
  // Development settings
  development: {
    apiBaseUrl: 'http://localhost:10000/api/v1',
    wsUrl: 'ws://localhost:10000',
    corsOrigins: [
      'http://localhost:3000',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:8080',
      'file://' // For local HTML files
    ]
  },
  
  // Production settings
  production: {
    apiBaseUrl: 'https://quicklocal-backend.onrender.com/api/v1',
    wsUrl: 'wss://quicklocal-backend.onrender.com',
    corsOrigins: [
      'https://quicklocal.shop',
      'https://www.quicklocal.shop',
      'https://quicklocal-frontend.vercel.app',
      'https://quicklocal-admin.vercel.app'
    ]
  },
  
  // Test settings
  test: {
    apiBaseUrl: 'http://localhost:10000/api/v1',
    wsUrl: 'ws://localhost:10000',
    corsOrigins: ['http://localhost:3000']
  }
};

// Get current environment
const env = process.env.NODE_ENV || 'development';

// Export configuration for current environment
module.exports = {
  ...config[env],
  env,
  
  // Helper functions
  getApiUrl: (endpoint = '') => `${config[env].apiBaseUrl}${endpoint}`,
  getWsUrl: () => config[env].wsUrl,
  getCorsOrigins: () => config[env].corsOrigins,
  
  // Frontend configuration object (for embedding in HTML)
  getFrontendConfig: () => ({
    apiBaseUrl: config[env].apiBaseUrl,
    wsUrl: config[env].wsUrl,
    env: env
  })
};
