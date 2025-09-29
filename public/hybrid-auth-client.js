/**
 * Hybrid Authentication Client for Frontend - SECURE PRODUCTION VERSION
 * Supports both Supabase Auth and legacy JWT with enhanced security
 */
class HybridAuthClient {
  constructor(config = {}) {
    const {
      supabaseUrl = window.REACT_APP_SUPABASE_URL || 'https://pmvhsjezhuokwygvhhqk.supabase.co',
      supabaseAnonKey = window.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtdmhzamV6aHVva3d5Z3ZoaHFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NTU3MDUsImV4cCI6MjA3MzIzMTcwNX0.ZrVjuqB28Qer7F7zSdG_rJIs_ZQZhX1PNyrmpK-Qojg',
      backendUrl = window.REACT_APP_BACKEND_URL || 'https://quicklocal-backend.onrender.com',
      autoInitialize = true,
      enableSessionWatcher = true,
      maxRetryAttempts = 2
    } = config;
    
    this.supabase = window.supabase?.createClient ? 
      window.supabase.createClient(supabaseUrl, supabaseAnonKey) : null;
    
    this.backendUrl = backendUrl;
    this.currentUser = null;
    this.authMethod = null;
    this.config = config;
    this.maxRetryAttempts = maxRetryAttempts;
    this.sessionInterval = null;
    
    if (autoInitialize) {
      this.initializeAuth();
    }
    
    if (enableSessionWatcher) {
      this.startSessionWatcher();
    }
  }

  /**
   * Initialize authentication state
   */
  async initializeAuth() {
    try {
      console.log('[Auth] Initializing authentication state...');

      // Priority 1: Check for an active Supabase session via SDK
      if (this.supabase) {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (session && this.validateToken(session.access_token)) {
          console.log('[Auth] Initialized from Supabase SDK session.');
          await this.handleSupabaseAuth(session);
          return;
        }
      }

      // Priority 2: Check secure storage for a Supabase token
      const accessToken = this.getSecureToken('supabase_access_token');
      if (accessToken && this.validateToken(accessToken)) {
        console.log('[Auth] Initialized from secure storage token.');
        const mockSession = { access_token: accessToken };
        await this.handleSupabaseAuth(mockSession);
        return;
      }

      // Priority 3: Fallback to legacy JWT token
      const legacyToken = this.getSecureToken('token') || this.getSecureToken('accessToken');
      if (legacyToken && this.validateToken(legacyToken)) {
        console.log('[Auth] Initialized from legacy JWT.');
        await this.handleLegacyAuth(legacyToken);
        return;
      }

      console.log('[Auth] No valid authentication tokens found.');
    } catch (error) {
      console.error('Failed to initialize auth:', error);
    }
  }

  /**
   * Validate token structure and expiry
   */
  validateToken(token) {
    if (!token || token === 'undefined' || token === 'null' || token === '') {
      return false;
    }
    
    try {
      // Basic JWT structure validation
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.warn('[Auth] Invalid token structure');
        return false;
      }
      
      // Check if token is expired
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp && payload.exp < Date.now() / 1000) {
        console.warn('[Auth] Token expired');
        return false;
      }
      
      return true;
    } catch (error) {
      console.warn('[Auth] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Handle Supabase authentication
   */
  async handleSupabaseAuth(session) {
    if (!session || !this.validateToken(session.access_token)) {
      console.warn('[Auth] handleSupabaseAuth called with invalid session.');
      return;
    }

    try {
      this.authMethod = 'supabase';
      
      const response = await fetch(`${this.backendUrl}/api/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          this.currentUser = data.user;
          this.setSecureToken('quicklocal_user', JSON.stringify(this.currentUser));
          console.log('[Auth] User authenticated:', this.currentUser.name);
          this.authStateCallback?.(this.currentUser);
        } else {
          throw new Error('Invalid user data received');
        }
      } else {
        console.warn('[Auth] Token validation failed, clearing tokens');
        await this.logout();
      }
    } catch (error) {
      console.error('Supabase auth error:', error);
      await this.logout();
    }
  }

  /**
   * Handle legacy JWT authentication
   */
  async handleLegacyAuth(token) {
    try {
      this.authMethod = 'jwt';
      
      const response = await fetch(`${this.backendUrl}/api/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          this.currentUser = data.user;
          this.authStateCallback?.(this.currentUser);
        }
      } else {
        await this.logout();
      }
    } catch (error) {
      console.error('Legacy auth error:', error);
      await this.logout();
    }
  }

  /**
   * Register new user
   */
  async register(userData) {
    try {
      const response = await fetch(`${this.backendUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        return { success: true, ...data };
      } else {
        // Provide specific error messages based on status code
        switch (response.status) {
          case 400:
            throw new Error(data.message || 'Invalid registration data');
          case 409:
            throw new Error(data.message || 'User already exists');
          case 422:
            throw new Error(data.message || 'Validation failed');
          default:
            throw new Error(data.message || 'Registration failed');
        }
      }
    } catch (error) {
      return { 
        success: false, 
        message: error.message,
        code: 'REGISTRATION_FAILED'
      };
    }
  }

  /**
   * Login user
   */
  async login(identifier, password) {
    try {
      const response = await fetch(`${this.backendUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        // Provide specific error messages
        switch (response.status) {
          case 401:
            throw new Error('Invalid email/phone or password');
          case 429:
            throw new Error('Too many login attempts. Please try again later.');
          case 423:
            throw new Error('Account temporarily locked due to failed attempts');
          default:
            throw new Error(data.message || 'Login failed');
        }
      }

      if (data.accessToken) {
        this.setSecureToken('supabase_access_token', data.accessToken);
        this.setSecureToken('quicklocal_access_token', data.accessToken);
        this.setSecureToken('token', data.accessToken);
        
        if (data.refreshToken) {
          this.setSecureToken('supabase_refresh_token', data.refreshToken);
          this.setSecureToken('quicklocal_refresh_token', data.refreshToken);
        }
        
        if (this.supabase && data.accessToken && data.refreshToken) {
          await this.supabase.auth.setSession({
            access_token: data.accessToken,
            refresh_token: data.refreshToken,
          });
        }
        
        this.authMethod = 'supabase';
      }

      if (data.user) {
        this.currentUser = data.user;
        this.setSecureToken('quicklocal_user', JSON.stringify(data.user));
        this.authStateCallback?.(this.currentUser);
      }

      return { 
        success: true, 
        user: data.user, 
        message: data.message || 'Login successful' 
      };
    } catch (error) {
      console.error('Login error:', error);
      return { 
        success: false, 
        message: error.message,
        code: 'LOGIN_FAILED'
      };
    }
  }

  /**
   * Login with social provider
   */
  async loginWithProvider(provider) {
    try {
      if (!this.supabase) {
        throw new Error('Social login requires Supabase configuration');
      }

      const { error } = await this.supabase.auth.signInWithOAuth({
        provider: provider,
        options: { 
          redirectTo: `${window.location.origin}/marketplace.html?login=success` 
        }
      });

      if (error) throw error;
      
      return { 
        success: true, 
        message: `Redirecting to ${provider}...` 
      };
    } catch (error) {
      console.error(`${provider} login error:`, error);
      return { 
        success: false, 
        message: error.message,
        code: 'SOCIAL_LOGIN_FAILED'
      };
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email) {
    try {
      const response = await fetch(`${this.backendUrl}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        return { success: true, message: data.message };
      } else {
        switch (response.status) {
          case 404:
            throw new Error('No account found with this email');
          case 429:
            throw new Error('Too many reset attempts. Please try again later.');
          default:
            throw new Error(data.message || 'Failed to send reset email');
        }
      }
    } catch (error) {
      return { 
        success: false, 
        message: error.message,
        code: 'PASSWORD_RESET_FAILED'
      };
    }
  }

  /**
   * Refresh token
   */
  async refreshToken() {
    try {
      const refreshToken = this.getSecureToken('supabase_refresh_token') || 
                           this.getSecureToken('quicklocal_refresh_token');
      
      if (!refreshToken || !this.validateToken(refreshToken)) {
        console.warn('[Auth] No valid refresh token available');
        return false;
      }

      console.log('[Auth] Attempting token refresh...');
      
      const response = await fetch(`${this.backendUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${refreshToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.accessToken && this.validateToken(data.accessToken)) {
          this.setSecureToken('supabase_access_token', data.accessToken);
          this.setSecureToken('quicklocal_access_token', data.accessToken);
          this.setSecureToken('token', data.accessToken);
          
          if (data.refreshToken && this.validateToken(data.refreshToken)) {
            this.setSecureToken('supabase_refresh_token', data.refreshToken);
            this.setSecureToken('quicklocal_refresh_token', data.refreshToken);
          }
          
          console.log('[Auth] Token refreshed successfully');
          return true;
        }
      }
      
      console.warn('[Auth] Token refresh failed');
      return false;
      
    } catch (error) {
      console.error('[Auth] Token refresh error:', error);
      return false;
    }
  }

  /**
   * Logout user
   */
  async logout() {
    try {
      // Stop session watcher
      this.stopSessionWatcher();

      try {
        await fetch(`${this.backendUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': this.getAuthHeader() }
        });
      } catch (error) {
        console.warn('Backend logout call failed:', error.message);
      }

      if (this.supabase) {
        await this.supabase.auth.signOut();
      }

      this.clearAllAuthData();

      this.currentUser = null;
      this.authMethod = null;
      this.authStateCallback?.(null);

      console.log('✅ User logged out successfully');
      return { success: true };
      
    } catch (error) {
      console.error('Logout error:', error);
      this.clearAllAuthData();
      return { 
        success: false, 
        message: error.message,
        code: 'LOGOUT_FAILED'
      };
    }
  }

  /**
   * Secure token storage with basic obfuscation
   */
  setSecureToken(key, value) {
    try {
      // Simple obfuscation (not true encryption, but better than plain storage)
      const encoded = btoa(JSON.stringify({
        value: value,
        timestamp: Date.now(),
        version: '1.0'
      }));
      localStorage.setItem(key, encoded);
    } catch (error) {
      console.warn('Secure storage failed, falling back to plain storage');
      localStorage.setItem(key, value);
    }
  }

  getSecureToken(key) {
    try {
      const encoded = localStorage.getItem(key);
      if (!encoded) return null;
      
      const decoded = JSON.parse(atob(encoded));
      // Optional: Check token age and auto-expire (24 hours max)
      if (Date.now() - decoded.timestamp > 24 * 60 * 60 * 1000) {
        this.removeSecureToken(key);
        return null;
      }
      
      return decoded.value;
    } catch {
      return localStorage.getItem(key);
    }
  }

  removeSecureToken(key) {
    localStorage.removeItem(key);
  }

  /**
   * Clear all authentication data
   */
  clearAllAuthData() {
    const authKeys = [
      'token', 'accessToken', 
      'quicklocal_access_token', 'quicklocal_refresh_token', 'quicklocal_user',
      'supabase_access_token', 'supabase_refresh_token'
    ];
    
    authKeys.forEach(key => this.removeSecureToken(key));
    
    // Clean up any Supabase storage
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-') && key.includes('-auth-token')) {
        localStorage.removeItem(key);
      }
    });
  }

  /**
   * Get current authentication header
   */
  getAuthHeader() {
    const token = this.getSecureToken('supabase_access_token') || 
                  this.getSecureToken('quicklocal_access_token') || 
                  this.getSecureToken('token');

    if (token && this.validateToken(token)) {
      return `Bearer ${token}`;
    }
    
    return '';
  }

  /**
   * Make authenticated API call - IMPROVED VERSION
   */
  async apiCall(endpoint, options = {}) {
    try {
      const authHeader = this.getAuthHeader();
          
      if (!authHeader) {
        throw new Error('No authentication token available');
      }

      const defaultHeaders = {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      };

      // ✅ FIXED: Simpler, more reliable endpoint normalization
      let finalEndpoint = endpoint;
          
      // Remove leading slash if present
      if (finalEndpoint.startsWith('/')) {
        finalEndpoint = finalEndpoint.substring(1);
      }
          
      // Only add /api/v1 if it's not already there
      if (!finalEndpoint.startsWith('api/v1/')) {
        finalEndpoint = `api/v1/${finalEndpoint}`;
      }
          
      // Add back the leading slash
      finalEndpoint = `/${finalEndpoint}`;
          
      console.log(`[API] 🔍 Normalized: ${endpoint} → ${finalEndpoint}`);
      
      let response = await fetch(`${this.backendUrl}${finalEndpoint}`, {
        ...options,
        headers: { ...defaultHeaders, ...options.headers }
      });

      // Handle 401 with retry logic
      const retryCount = options._retryCount || 0;
      if (response.status === 401 && retryCount < this.maxRetryAttempts) {
        console.log('[API] 401 received, attempting token refresh...');
        const refreshed = await this.refreshToken();
        
        if (refreshed) {
          await new Promise(resolve => setTimeout(resolve, 100));
          console.log('[API] Retrying request with new token...');
          // Retry with original endpoint (will be normalized again)
          return this.apiCall(endpoint, { 
            ...options, 
            _retryCount: retryCount + 1 
          });
        } else {
          await this.logout();
          throw new Error('Session expired. Please log in again.');
        }
      }

      return response;
      
    } catch (error) {
      console.error(`[API] Call failed: ${endpoint}`, error);
      throw error;
    }
  }

  /**
   * Session management and monitoring
   */
  startSessionWatcher() {
    // Check every 5 minutes for session validity
    this.sessionInterval = setInterval(async () => {
      if (this.currentUser) {
        const isValid = await this.validateCurrentSession();
        if (!isValid) {
          console.warn('[Auth] Session invalid, logging out...');
          await this.logout();
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  stopSessionWatcher() {
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
  }

  async validateCurrentSession() {
    try {
      const response = await this.apiCall('/api/v1/auth/me');
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Set auth state change callback
   */
  onAuthStateChange(callback) {
    this.authStateCallback = callback;
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated() {
    if (this.currentUser) return true;
    
    try {
      const storedUser = this.getSecureToken('quicklocal_user');
      if (storedUser) {
        this.currentUser = JSON.parse(storedUser);
        return true;
      }
    } catch (error) {
      console.warn('Failed to restore user from storage:', error);
    }
    
    return false;
  }

  /**
   * Get current user
   */
  getCurrentUser() {
    if (this.currentUser) return this.currentUser;
    
    try {
      const storedUser = this.getSecureToken('quicklocal_user');
      return storedUser ? JSON.parse(storedUser) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get auth method
   */
  getAuthMethod() {
    return this.authMethod;
  }

  /**
   * Update user profile
   */
  async updateProfile(userData) {
    try {
      const response = await this.apiCall('/api/v1/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(userData)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        this.currentUser = { ...this.currentUser, ...data.user };
        this.setSecureToken('quicklocal_user', JSON.stringify(this.currentUser));
        this.authStateCallback?.(this.currentUser);
        
        return { success: true, user: this.currentUser };
      } else {
        throw new Error(data.message || 'Profile update failed');
      }
    } catch (error) {
      return { 
        success: false, 
        message: error.message,
        code: 'PROFILE_UPDATE_FAILED'
      };
    }
  }

  /**
   * Change password
   */
  async changePassword(currentPassword, newPassword) {
    try {
      const response = await this.apiCall('/api/v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        return { success: true, message: data.message };
      } else {
        throw new Error(data.message || 'Password change failed');
      }
    } catch (error) {
      return { 
        success: false, 
        message: error.message,
        code: 'PASSWORD_CHANGE_FAILED'
      };
    }
  }
}

// Auto-instantiate with configuration
const hybridAuthClient = new HybridAuthClient({
  supabaseUrl: window.REACT_APP_SUPABASE_URL || 'https://pmvhsjezhuokwygvhhqk.supabase.co',
  supabaseAnonKey: window.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtdmhzamV6aHVva3d5Z3ZoaHFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NTU3MDUsImV4cCI6MjA3MzIzMTcwNX0.ZrVjuqB28Qer7F7zSdG_rJIs_ZQZhX1PNyrmpK-Qojg',
  backendUrl: window.REACT_APP_BACKEND_URL || 'https://quicklocal-backend.onrender.com',
  autoInitialize: true,
  enableSessionWatcher: true,
  maxRetryAttempts: 2
});

// Make available globally
window.HybridAuthClient = hybridAuthClient;
window.HybridAuthClientClass = HybridAuthClient;

console.log('✅ HybridAuthClient (SECURE PRODUCTION VERSION) loaded and available globally');

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HybridAuthClient, hybridAuthClient };
}