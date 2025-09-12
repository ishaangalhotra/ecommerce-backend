/**
 * QuickLocal Hybrid Authentication Client
 * Copy this file to: D:\frontend\js\hybrid-auth.js
 * 
 * This handles both Supabase (new users) and JWT (existing users) authentication
 */

class QuickLocalHybridAuth {
  constructor() {
    // Your Supabase configuration
    this.supabaseUrl = 'https://pmvhsjezhuokwygvhhqk.supabase.co';
    this.supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtdmhzamV6aHVva3d5Z3ZoaHFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NTU3MDUsImV4cCI6MjA3MzIzMTcwNX0.ZrVjuqB28Qer7F7zSdG_rJIs_ZQZhX1PNyrmpK-Qojg';
    this.backendUrl = 'https://quicklocal-backend.onrender.com';
    
    this.supabase = null;
    this.currentUser = null;
    this.authMethod = null;
    this.listeners = [];
    
    this.initializeSupabase();
    this.initialize();
  }

  initializeSupabase() {
    // Initialize Supabase client (CDN version)
    if (typeof window !== 'undefined' && window.supabase) {
      this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseAnonKey);
    }
  }

  async initialize() {
    try {
      console.log('🔧 Initializing QuickLocal Hybrid Auth...');
      
      // Check for existing Supabase session
      if (this.supabase) {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (session) {
          console.log('📱 Found Supabase session');
          await this.handleSupabaseAuth(session);
          return;
        }
      }

      // Fallback to legacy JWT token
      const token = localStorage.getItem('token') || localStorage.getItem('accessToken');
      if (token) {
        console.log('🔑 Found legacy JWT token');
        await this.handleLegacyAuth(token);
      } else {
        console.log('👤 No existing session found');
      }
    } catch (error) {
      console.error('❌ Failed to initialize auth:', error);
    }
  }

  async handleSupabaseAuth(session) {
    try {
      this.authMethod = 'supabase';
      console.log('🚀 Using Supabase authentication');
      
      const response = await fetch(`${this.backendUrl}/api/hybrid-auth/me`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        console.log('✅ Supabase user authenticated:', this.currentUser.name);
        this.notifyListeners(this.currentUser);
      } else {
        console.warn('⚠️ Supabase auth failed, response:', response.status);
      }
    } catch (error) {
      console.error('❌ Supabase auth error:', error);
    }
  }

  async handleLegacyAuth(token) {
    try {
      this.authMethod = 'jwt';
      console.log('🔄 Using legacy JWT authentication');
      
      const response = await fetch(`${this.backendUrl}/api/hybrid-auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        console.log('✅ Legacy user authenticated:', this.currentUser.name);
        this.notifyListeners(this.currentUser);
      } else {
        console.warn('⚠️ Legacy token expired, clearing storage');
        localStorage.removeItem('token');
        localStorage.removeItem('accessToken');
      }
    } catch (error) {
      console.error('❌ Legacy auth error:', error);
    }
  }

  /**
   * Register new user (uses Supabase for memory efficiency)
   * @param {string} email - User's email address
   * @param {string} password - User's password
   * @param {string} name - User's full name
   * @param {string} role - User role ('customer' or 'seller')
   * @param {string} phone - Optional phone number (Indian format)
   */
  async register(email, password, name, role = 'customer', phone = null) {
    try {
      console.log(`📝 Registering new ${role}:`, email);
      
      const requestBody = { email, password, name, role };
      if (phone) {
        requestBody.phone = phone;
      }
      
      const response = await fetch(`${this.backendUrl}/api/hybrid-auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Registration successful');
        return { 
          success: true, 
          message: data.message, 
          requiresVerification: data.requiresVerification 
        };
      } else {
        console.error('❌ Registration failed:', data.message);
        return { success: false, message: data.message };
      }
    } catch (error) {
      console.error('❌ Registration error:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Login user (hybrid approach - handles both auth methods)
   */
  async login(identifier, password) {
    try {
      console.log('🔐 Attempting login for:', identifier);
      
      const response = await fetch(`${this.backendUrl}/api/hybrid-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });

      const data = await response.json();
      
      if (response.ok) {
        // Handle Supabase tokens (new users)
        if (data.accessToken && data.refreshToken) {
          localStorage.setItem('supabase_access_token', data.accessToken);
          localStorage.setItem('supabase_refresh_token', data.refreshToken);
          this.authMethod = 'supabase';
          console.log('✅ Login successful with Supabase');
        } 
        // Handle legacy JWT (existing users)
        else if (data.token) {
          localStorage.setItem('token', data.token);
          this.authMethod = 'jwt';
          console.log('✅ Login successful with legacy JWT');
        }

        this.currentUser = data.user;
        this.notifyListeners(this.currentUser);
        return { success: true, user: data.user, message: data.message };
      } else {
        console.error('❌ Login failed:', data.message);
        return { success: false, message: data.message };
      }
    } catch (error) {
      console.error('❌ Login error:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Logout user (works with both auth methods)
   */
  async logout() {
    try {
      console.log('👋 Logging out...');
      
      await fetch(`${this.backendUrl}/api/hybrid-auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': this.getAuthHeader(),
          'Content-Type': 'application/json'
        }
      });

      // Sign out from Supabase if using Supabase
      if (this.authMethod === 'supabase' && this.supabase) {
        await this.supabase.auth.signOut();
      }

      // Clear all auth data
      localStorage.removeItem('token');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('supabase_access_token');
      localStorage.removeItem('supabase_refresh_token');

      this.currentUser = null;
      this.authMethod = null;
      this.notifyListeners(null);

      console.log('✅ Logout successful');
      return { success: true };
    } catch (error) {
      console.error('❌ Logout error:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get authorization header for API calls
   */
  getAuthHeader() {
    if (this.authMethod === 'supabase') {
      const token = localStorage.getItem('supabase_access_token');
      return token ? `Bearer ${token}` : '';
    } else if (this.authMethod === 'jwt') {
      const token = localStorage.getItem('token');
      return token ? `Bearer ${token}` : '';
    }
    return '';
  }

  /**
   * Make authenticated API calls to your backend
   */
  async apiCall(endpoint, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Authorization': this.getAuthHeader()
    };

    const response = await fetch(`${this.backendUrl}${endpoint}`, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers }
    });

    // Handle token refresh for Supabase users
    if (response.status === 401 && this.authMethod === 'supabase') {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // Retry with new token
        return fetch(`${this.backendUrl}${endpoint}`, {
          ...options,
          headers: { 
            ...defaultHeaders, 
            'Authorization': this.getAuthHeader(), 
            ...options.headers 
          }
        });
      }
    }

    return response;
  }

  /**
   * Refresh Supabase access token
   */
  async refreshToken() {
    try {
      const refreshToken = localStorage.getItem('supabase_refresh_token');
      if (!refreshToken) return false;

      const response = await fetch(`${this.backendUrl}/api/hybrid-auth/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('supabase_access_token', data.accessToken);
        localStorage.setItem('supabase_refresh_token', data.refreshToken);
        console.log('🔄 Token refreshed successfully');
        return true;
      }
    } catch (error) {
      console.error('❌ Token refresh error:', error);
    }
    return false;
  }

  /**
   * Subscribe to authentication state changes
   */
  onAuthStateChange(callback) {
    this.listeners.push(callback);
    // Call immediately with current state
    if (this.currentUser !== undefined) {
      callback(this.currentUser);
    }
  }

  /**
   * Notify all listeners of auth state changes
   */
  notifyListeners(user) {
    this.listeners.forEach(callback => {
      try {
        callback(user);
      } catch (error) {
        console.error('❌ Auth listener error:', error);
      }
    });
  }

  /**
   * Get current authenticated user
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.currentUser;
  }

  /**
   * Get current authentication method
   */
  getAuthMethod() {
    return this.authMethod;
  }

  /**
   * Get user role
   */
  getUserRole() {
    return this.currentUser?.role || 'guest';
  }

  /**
   * Check if user has specific role
   */
  hasRole(role) {
    return this.currentUser?.role === role;
  }

  /**
   * Validate phone number (Indian format)
   */
  isValidIndianPhone(phone) {
    if (!phone) return false;
    // Indian mobile number pattern: +91 or 0 followed by 10 digits
    const phoneRegex = /^(?:\+91|91|0)?[6789]\d{9}$/;
    return phoneRegex.test(phone.replace(/\s+/g, ''));
  }

  /**
   * Validate email address
   */
  isValidEmail(email) {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Register with validation
   */
  async registerWithValidation(email, password, name, role = 'customer', phone = null) {
    // Validate inputs
    if (!this.isValidEmail(email)) {
      return { success: false, message: 'Please provide a valid email address' };
    }
    
    if (!password || password.length < 6) {
      return { success: false, message: 'Password must be at least 6 characters long' };
    }
    
    if (!name || name.trim().length < 2) {
      return { success: false, message: 'Name must be at least 2 characters long' };
    }
    
    if (phone && !this.isValidIndianPhone(phone)) {
      return { success: false, message: 'Please provide a valid Indian phone number' };
    }
    
    if (!['customer', 'seller'].includes(role)) {
      return { success: false, message: 'Role must be either customer or seller' };
    }
    
    // Call the actual register method
    return await this.register(email, password, name, role, phone);
  }

  /**
   * Utility functions for common API calls
   */
  
  // Load products with authentication context
  async loadProducts(filters = {}) {
    try {
      const queryParams = new URLSearchParams(filters).toString();
      const response = await this.apiCall(`/api/v1/products${queryParams ? '?' + queryParams : ''}`);
      
      if (response.ok) {
        const data = await response.json();
        return { success: true, products: data.products };
      } else {
        return { success: false, message: 'Failed to load products' };
      }
    } catch (error) {
      console.error('❌ Failed to load products:', error);
      return { success: false, message: error.message };
    }
  }

  // Get user profile
  async getUserProfile() {
    try {
      const response = await this.apiCall('/api/v1/users/profile');
      
      if (response.ok) {
        const data = await response.json();
        return { success: true, profile: data.user };
      } else {
        return { success: false, message: 'Failed to load profile' };
      }
    } catch (error) {
      console.error('❌ Failed to load profile:', error);
      return { success: false, message: error.message };
    }
  }

  // Add to cart
  async addToCart(productId, quantity = 1) {
    try {
      const response = await this.apiCall('/api/v1/cart/add', {
        method: 'POST',
        body: JSON.stringify({ productId, quantity })
      });
      
      if (response.ok) {
        const data = await response.json();
        return { success: true, cart: data.cart };
      } else {
        const data = await response.json();
        return { success: false, message: data.message };
      }
    } catch (error) {
      console.error('❌ Failed to add to cart:', error);
      return { success: false, message: error.message };
    }
  }
}

// Create global instance
window.quickLocalAuth = new QuickLocalHybridAuth();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QuickLocalHybridAuth;
}

// Log initialization
console.log('🚀 QuickLocal Hybrid Auth loaded successfully');
console.log('📊 Memory-efficient authentication ready');
console.log('🔗 Backend URL:', 'https://quicklocal-backend.onrender.com');
console.log('🗃️ Supabase URL:', 'https://pmvhsjezhuokwygvhhqk.supabase.co');
