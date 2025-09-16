/**
 * Supabase Authentication Client for Frontend
 * Place this in your Vercel frontend project
 */

// Import Supabase (add this to your package.json: npm install @supabase/supabase-js)
// import { createClient } from '@supabase/supabase-js'

class QuickLocalAuthClient {
  constructor() {
    // Your Supabase configuration
    this.supabaseUrl = 'https://pmvhsjezhuokwygvhhqk.supabase.co';
    this.supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtdmhzamV6aHVva3d5Z3ZoaHFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NTU3MDUsImV4cCI6MjA3MzIzMTcwNX0.ZrVjuqB28Qer7F7zSdG_rJIs_ZQZhX1PNyrmpK-Qojg';
    this.backendUrl = 'https://quicklocal-backend.onrender.com';

    this.supabase = null;
    this.currentUser = null;
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
      console.log('🔧 Initializing QuickLocal Auth...');

      // Check for existing Supabase session
      if (this.supabase) {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (session) {
          console.log('📱 Found Supabase session');
          this.currentUser = session.user;
          this.notifyListeners(this.currentUser);
        } else {
          console.log('👤 No existing session found');
        }
      } else {
        console.error('❌ Supabase client not initialized.');
      }
    } catch (error) {
      console.error('❌ Failed to initialize auth:', error);
    }
  }

  /**
   * Register new user with Supabase
   */
  async register(email, password, name, role = 'customer') {
    try {
      console.log(`📝 Registering new ${role}:`, email);
      
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            role,
          },
        },
      });

      if (error) {
        console.error('❌ Registration failed:', error.message);
        return { success: false, message: error.message };
      }

      console.log('✅ Registration successful');
      
      // Update local state if a session is returned (e.g., if auto-login is enabled)
      if (data.session) {
        this.currentUser = data.user;
        this.notifyListeners(this.currentUser);
      }

      return {
        success: true,
        message: 'Registration successful! Please check your email for a verification link.',
        requiresVerification: true,
      };
    } catch (error) {
      console.error('❌ Registration error:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Login user with Supabase
   */
  async login(email, password) {
    try {
      console.log('🔐 Attempting login for:', email);

      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('❌ Login failed:', error.message);
        return { success: false, message: error.message };
      }

      this.currentUser = data.user;
      this.notifyListeners(this.currentUser);

      console.log('✅ Login successful with Supabase');
      return { success: true, user: data.user, message: 'Login successful' };
    } catch (error) {
      console.error('❌ Login error:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Logout user
   */
  async logout() {
    try {
      console.log('👋 Logging out...');
      await this.supabase.auth.signOut();
      this.currentUser = null;
      this.notifyListeners(null);
      console.log('✅ Logout successful');
      return { success: true };
    } catch (error) {
      console.error('❌ Logout error:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get Supabase authorization header for API calls
   */
  async getAuthHeader() {
    if (this.supabase) {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session) {
        return `Bearer ${session.access_token}`;
      }
    }
    return '';
  }

  /**
   * Make authenticated API calls to your backend
   */
  async apiCall(endpoint, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Authorization': await this.getAuthHeader()
    };

    const response = await fetch(`${this.backendUrl}${endpoint}`, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers }
    });

    return response;
  }

  /**
   * Subscribe to authentication state changes
   */
  onAuthStateChange(callback) {
    this.listeners.push(callback);
    if (this.currentUser !== undefined) {
      callback(this.currentUser);
    }

    // Supabase built-in auth state listener
    this.supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        this.currentUser = session.user;
        this.notifyListeners(this.currentUser);
      } else {
        this.currentUser = null;
        this.notifyListeners(null);
      }
    });
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
   * Get user role
   */
  getUserRole() {
    return this.currentUser?.user_metadata?.role || 'guest';
  }

  /**
   * Check if user has specific role
   */
  hasRole(role) {
    return this.currentUser?.user_metadata?.role === role;
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
window.quickLocalAuth = new QuickLocalAuthClient();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QuickLocalAuthClient;
}

// Log initialization
console.log('🚀 QuickLocal Supabase Auth Client loaded successfully');
console.log('🔗 Backend URL:', 'https://quicklocal-backend.onrender.com');
console.log('🗃️ Supabase URL:', 'https://pmvhsjezhuokwygvhhqk.supabase.co');