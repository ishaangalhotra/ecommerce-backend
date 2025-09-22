/**
 * Hybrid Authentication Client for Frontend
 * Supports both Supabase Auth and legacy JWT
 * Place this in your backend's /public directory
 */
class HybridAuthClient {
    constructor(supabaseUrl, supabaseAnonKey, backendUrl) {
        // Initialize Supabase client if the library is available
        this.supabase = window.supabase?.createClient ?
            window.supabase.createClient(supabaseUrl, supabaseAnonKey) :
            null;

        if (!this.supabase) {
            console.warn('Supabase client library not found. Please ensure it is loaded for full functionality.');
        }

        this.backendUrl = backendUrl;
        // CORRECTED: The backend routes are mounted under /auth, not /hybrid-auth
        this.apiBasePath = '/api/v1/auth';
        this.currentUser = null;
        this.authMethod = null;

        this.initializeAuth();
    }

    async initializeAuth() {
        try {
            if (this.supabase) {
                const { data: { session } } = await this.supabase.auth.getSession();
                if (session) {
                    await this.handleSupabaseAuth(session);
                    return;
                }
            }
            const token = localStorage.getItem('token') || localStorage.getItem('accessToken');
            if (token) {
                await this.handleLegacyAuth(token);
            }
        } catch (error) {
            console.error('Failed to initialize auth:', error);
        }
    }

    async handleSupabaseAuth(session) {
        try {
            this.authMethod = 'supabase';
            const response = await fetch(`${this.backendUrl}${this.apiBasePath}/me`, {
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.authStateCallback?.(this.currentUser);
            }
        } catch (error) {
            console.error('Supabase auth error:', error);
        }
    }

    async handleLegacyAuth(token) {
        try {
            this.authMethod = 'jwt';
            const response = await fetch(`${this.backendUrl}${this.apiBasePath}/me`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.authStateCallback?.(this.currentUser);
            } else {
                localStorage.removeItem('token');
                localStorage.removeItem('accessToken');
            }
        } catch (error) {
            console.error('Legacy auth error:', error);
        }
    }

    async register(userData) {
        try {
            const response = await fetch(`${this.backendUrl}${this.apiBasePath}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
            const data = await response.json();
            if (response.ok && data.success) {
                return { success: true, message: data.message, data: data.data };
            } else {
                throw new Error(data.message || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            return { success: false, message: error.message };
        }
    }

    async login(email, password) {
        try {
            const response = await fetch(`${this.backendUrl}${this.apiBasePath}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // CORRECTED: The backend expects the key 'email', not 'identifier'
                body: JSON.stringify({ email: email, password: password })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                if (data.session) { // Supabase login
                    localStorage.setItem('supabase_access_token', data.session.access_token);
                    localStorage.setItem('supabase_refresh_token', data.session.refresh_token);
                    this.authMethod = 'supabase';
                } else if (data.token) { // Legacy JWT
                    localStorage.setItem('token', data.token);
                    this.authMethod = 'jwt';
                }
                this.currentUser = data.user;
                this.authStateCallback?.(this.currentUser);
                return { success: true, user: data.user, message: data.message };
            } else {
                throw new Error(data.message || `Request failed with status ${response.status}`);
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, message: error.message };
        }
    }

    async requestPasswordReset(email) {
        try {
            const response = await fetch(`${this.backendUrl}${this.apiBasePath}/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();
            return { success: response.ok, message: data.message };
        } catch (error) {
            console.error('Password reset request error:', error);
            return { success: false, message: error.message };
        }
    }

    async logout() {
        try {
            await fetch(`${this.backendUrl}${this.apiBasePath}/logout`, {
                method: 'POST',
                headers: { 'Authorization': this.getAuthHeader() }
            });
            if (this.authMethod === 'supabase' && this.supabase) {
                await this.supabase.auth.signOut();
            }
            localStorage.clear();
            this.currentUser = null;
            this.authMethod = null;
            this.authStateCallback?.(null);
            return { success: true };
        } catch (error) {
            console.error('Logout error:', error);
            return { success: false, message: error.message };
        }
    }

    getAuthHeader() {
        const token = localStorage.getItem('supabase_access_token') || localStorage.getItem('token');
        return token ? `Bearer ${token}` : '';
    }

    async apiCall(endpoint, options = {}) {
        const fullEndpoint = endpoint.startsWith(this.apiBasePath) ? endpoint : `${this.apiBasePath}${endpoint}`;
        const response = await fetch(`${this.backendUrl}${fullEndpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this.getAuthHeader(),
                ...options.headers
            }
        });

        if (response.status === 401 && this.authMethod === 'supabase') {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                return this.apiCall(endpoint, options); // Retry with new token
            }
        }
        return response;
    }

    async refreshToken() {
        try {
            const refreshToken = localStorage.getItem('supabase_refresh_token');
            if (!refreshToken) return false;

            const response = await fetch(`${this.backendUrl}${this.apiBasePath}/refresh-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: refreshToken })
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

    onAuthStateChange(callback) {
        this.authStateCallback = callback;
    }

    isAuthenticated() {
        return !!this.currentUser;
    }

    getCurrentUser() {
        return this.currentUser;
    }
}