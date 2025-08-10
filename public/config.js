// Frontend Configuration for QuickLocal
// This file provides API configuration for frontend applications

(function() {
  'use strict';
  
  // Detect environment
  const isLocalhost = window.location.hostname === 'localhost' || 
                     window.location.hostname === '127.0.0.1' ||
                     window.location.protocol === 'file:';
  
  const isProduction = window.location.hostname.includes('quicklocal.shop') ||
                      window.location.hostname.includes('onrender.com') ||
                      window.location.hostname.includes('vercel.app');
  
  // Configuration object
  const config = {
    // Development configuration
    development: {
      apiBaseUrl: 'http://localhost:10000/api/v1',
      wsUrl: 'ws://localhost:10000',
      timeout: 10000,
      retryAttempts: 3
    },
    
    // Production configuration
    production: {
      apiBaseUrl: 'https://quicklocal-backend.onrender.com/api/v1',
      wsUrl: 'wss://quicklocal-backend.onrender.com',
      timeout: 15000,
      retryAttempts: 5
    }
  };
  
  // Get current configuration
  const currentConfig = isLocalhost ? config.development : config.production;
  
  // API helper functions
  const api = {
    baseUrl: currentConfig.apiBaseUrl,
    wsUrl: currentConfig.wsUrl,
    timeout: currentConfig.timeout,
    retryAttempts: currentConfig.retryAttempts,
    
    // Make API request with retry logic
    async request(endpoint, options = {}) {
      const url = `${this.baseUrl}${endpoint}`;
      const config = {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        timeout: this.timeout,
        ...options
      };
      
      // Add auth token if available
      const token = localStorage.getItem('authToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      
      let lastError;
      for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
        try {
          const response = await fetch(url, config);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          return await response.json();
        } catch (error) {
          lastError = error;
          console.warn(`API request failed (attempt ${attempt}/${this.retryAttempts}):`, error);
          
          if (attempt < this.retryAttempts) {
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          }
        }
      }
      
      throw lastError;
    },
    
    // Convenience methods
    get: (endpoint) => api.request(endpoint),
    
    post: (endpoint, data) => api.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    
    put: (endpoint, data) => api.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
    
    delete: (endpoint) => api.request(endpoint, {
      method: 'DELETE'
    }),
    
    // Health check
    async health() {
      try {
        const response = await fetch(`${this.baseUrl.replace('/api/v1', '')}/health`);
        return response.ok;
      } catch (error) {
        console.error('Health check failed:', error);
        return false;
      }
    }
  };
  
  // WebSocket helper
  const ws = {
    url: currentConfig.wsUrl,
    
    connect(token = null) {
      const wsUrl = token ? `${this.url}?token=${token}` : this.url;
      return new WebSocket(wsUrl);
    }
  };
  
  // Expose to global scope
  window.QuickLocalConfig = {
    api,
    ws,
    env: isLocalhost ? 'development' : 'production',
    isLocalhost,
    isProduction
  };
  
  // Log configuration
  console.log('🚀 QuickLocal Frontend Config loaded:', {
    env: window.QuickLocalConfig.env,
    apiBaseUrl: api.baseUrl,
    wsUrl: ws.url
  });
  
})();
