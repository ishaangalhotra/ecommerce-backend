/**
 * Hybrid Authentication Client for Frontend
 * Supports both Supabase Auth and legacy JWT
 * Place this in your Vercel frontend project
 */

// Import Supabase (add this to your package.json: npm install @supabase/supabase-js)
// import { createClient } from '@supabase/supabase-js'

class HybridAuthClient {
  constructor(supabaseUrl, supabaseAnonKey, backendUrl) {
    // Initialize Supabase client
    this.supabase = window.supabase?.createClient ? 
      window.supabase.createClient(supabaseUrl, supabaseAnonKey) :
      null;
    
    this.backendUrl = backendUrl;
    this.currentUser = null;
    this.authMethod = null;
    
    // Initialize auth state
    this.initializeAuth();
  }

  /**
   * Initialize authentication state
   */
  async initializeAuth() {
    try {
      // Check for existing Supabase session
      if (this.supabase) {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (session) {
          await this.handleSupabaseAuth(session);
          return;
        }
      }

      // Fallback to legacy JWT token
      const token = localStorage.getItem('token') || localStorage.getItem('accessToken');
      if (token) {
        await this.handleLegacyAuth(token);
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
    }
  }

  /**
   * Handle Supabase authentication
   */
  async handleSupabaseAuth(session) {
    try {
      this.authMethod = 'supabase';
      
      // Get user details from your backend
      const response = await fetch(`${this.backendUrl}/api/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        this.onAuthStateChange?.(this.currentUser);
      }
    } catch (error) {
      console.error('Supabase auth error:', error);
    }
  }

  /**
   * Handle legacy JWT authentication
   */
  async handleLegacyAuth(token) {
    try {
      this.authMethod = 'jwt';
      
      const response = await fetch(`${this.backendUrl}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.currentUser = data.user;
        this.onAuthStateChange?.(this.currentUser);
      } else {
        // Token might be expired, clear it
        localStorage.removeItem('token');
        localStorage.removeItem('accessToken');
      }
    } catch (error) {
      console.error('Legacy auth error:', error);
    }
  }

  /**
   * Register new user (uses Supabase)
   */
  async register(email, password, name, role = 'customer') {
    try {
      const response = await fetch(`${this.backendUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password, name, role })
      });

      const data = await response.json();
      
      if (response.ok) {
        return {
          success: true,
          message: data.message,
          requiresVerification: data.requiresVerification
        };
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Login user (hybrid approach)
   */
  async login(email, password) {
    try {
      const response = await fetch(`${this.backendUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      
      if (response.ok) {
        // Handle Supabase tokens
        if (data.accessToken && data.refreshToken) {
          localStorage.setItem('supabase_access_token', data.accessToken);
          localStorage.setItem('supabase_refresh_token', data.refreshToken);
          this.authMethod = 'supabase';
        } 
        // Handle legacy JWT
        else if (data.token) {
          localStorage.setItem('token', data.token);
          this.authMethod = 'jwt';
        }

        this.currentUser = data.user;
        this.onAuthStateChange?.(this.currentUser);

        return {
          success: true,
          user: data.user,
          message: data.message
        };
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Logout user
   */
  async logout() {
    try {
      // Call backend logout
      await fetch(`${this.backendUrl}/api/v1/auth/logout`, {
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

      // Clear local storage
      localStorage.removeItem('token');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('supabase_access_token');
      localStorage.removeItem('supabase_refresh_token');

      this.currentUser = null;
      this.authMethod = null;
      this.onAuthStateChange?.(null);

      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get current authentication header
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
   * Make authenticated API call
   */
  async apiCall(endpoint, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Authorization': this.getAuthHeader()
    };

    const response = await fetch(`${this.backendUrl}${endpoint}`, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers
      }
    });

    // Handle token refresh for Supabase
    if (response.status === 401 && this.authMethod === 'supabase') {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // Retry the request with new token
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
   * Refresh Supabase token
   */
  async refreshToken() {
    try {
      const refreshToken = localStorage.getItem('supabase_refresh_token');
      if (!refreshToken) return false;

      const response = await fetch(`${this.backendUrl}/api/hybrid-auth/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('supabase_access_token', data.accessToken);
        localStorage.setItem('supabase_refresh_token', data.refreshToken);
        return true;
      }
    } catch (error) {
      console.error('Token refresh error:', error);
    }
    return false;
  }

  /**
   * Subscribe to real-time updates via Supabase
   */
  subscribeToRealtime(userId, callbacks = {}) {
    if (!this.supabase || this.authMethod !== 'supabase') {
      console.warn('Real-time requires Supabase authentication');
      return null;
    }

    const channel = this.supabase
      .channel(`user_${userId}`)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_updates',
          filter: `user_id=eq.${userId}`
        },
        callbacks.onOrderUpdate || (() => {})
      )
      .on('postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${userId}`
        },
        callbacks.onNotification || (() => {})
      )
      .subscribe();

    return channel;
  }

  /**
   * Get user notifications
   */
  async getNotifications() {
    if (!this.currentUser) return [];

    const response = await this.apiCall('/api/notifications');
    if (response.ok) {
      const data = await response.json();
      return data.notifications;
    }
    return [];
  }

  /**
   * Mark notification as read
   */
  async markNotificationRead(notificationId) {
    const response = await this.apiCall(`/api/notifications/${notificationId}/read`, {
      method: 'PATCH'
    });
    return response.ok;
  }

  /**
   * Set auth state change callback
   */
  onAuthStateChange(callback) {
    this.onAuthStateChange = callback;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.currentUser;
  }

  /**
   * Get current user
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Get auth method being used
   */
  getAuthMethod() {
    return this.authMethod;
  }
}

// Usage example:
/*
const authClient = new HybridAuthClient(
  'https://your-project.supabase.co',
  'your-anon-key',
  'https://your-backend.render.com' // or fly.io
);

// Set up auth state listener
authClient.onAuthStateChange((user) => {
  if (user) {
    console.log('User logged in:', user);
    // Update UI for authenticated state
  } else {
    console.log('User logged out');
    // Update UI for unauthenticated state
  }
});

// Login
const result = await authClient.login('user@example.com', 'password');
if (result.success) {
  console.log('Login successful');
}

// Subscribe to real-time updates
const channel = authClient.subscribeToRealtime(user.supabaseId, {
  onOrderUpdate: (update) => {
    console.log('Order updated:', update);
  },
  onNotification: (notification) => {
    console.log('New notification:', notification);
  }
});
*/

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HybridAuthClient;
} else {
  window.HybridAuthClient = HybridAuthClient;
  console.log('✅ HybridAuthClient loaded and available globally');
}
