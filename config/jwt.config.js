const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Enterprise-Grade JWT Configuration
 * 
 * Features:
 * 1. Advanced security with multiple algorithms and key rotation
 * 2. Environment-aware configuration with validation
 * 3. Key management and certificate support
 * 4. Token lifecycle management with refresh strategies
 * 5. Enhanced cookie security and SameSite policies
 * 6. Audience and issuer validation
 * 7. Claims validation and custom payload support
 * 8. Performance optimization and caching
 */

class JWTConfig {
    constructor() {
        this.validateEnvironment();
        this.initializeKeys();
        this.setupTokenLifecycle();
        this.configureSecurityPolicies();
    }

    /**
     * Validate required environment variables and security settings
     */
    validateEnvironment() {
        const requiredSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
        const missingSecrets = requiredSecrets.filter(secret => !process.env[secret]);
        
        if (missingSecrets.length > 0) {
            console.error('❌ Missing required JWT secrets:', missingSecrets.join(', '));
            
            if (process.env.NODE_ENV === 'production') {
                throw new Error(`Missing JWT secrets in production: ${missingSecrets.join(', ')}`);
            } else {
                console.warn('⚠️ Using default secrets in development - NOT for production');
            }
        }

        // Validate secret strength
        this.validateSecretStrength(process.env.JWT_SECRET, 'JWT_SECRET');
        this.validateSecretStrength(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET');
    }

    /**
     * Validate secret strength for production security
     */
    validateSecretStrength(secret, name) {
        if (!secret) return;
        
        const requirements = {
            minLength: 32,
            hasUppercase: /[A-Z]/.test(secret),
            hasLowercase: /[a-z]/.test(secret),
            hasNumbers: /[0-9]/.test(secret),
            hasSymbols: /[^A-Za-z0-9]/.test(secret)
        };

        const issues = [];
        if (secret.length < requirements.minLength) {
            issues.push(`less than ${requirements.minLength} characters`);
        }
        if (!requirements.hasUppercase) issues.push('no uppercase letters');
        if (!requirements.hasLowercase) issues.push('no lowercase letters');
        if (!requirements.hasNumbers) issues.push('no numbers');
        if (!requirements.hasSymbols) issues.push('no symbols');

        if (issues.length > 0 && process.env.NODE_ENV === 'production') {
            console.warn(`⚠️ ${name} is weak: ${issues.join(', ')}`);
        }
    }

    /**
     * Initialize cryptographic keys and certificates
     */
    initializeKeys() {
        // Generate strong fallback secrets if not provided
        this.secrets = {
            access: process.env.JWT_SECRET || this.generateStrongSecret(),
            refresh: process.env.JWT_REFRESH_SECRET || this.generateStrongSecret(),
            signing: process.env.JWT_SIGNING_SECRET || this.generateStrongSecret()
        };

        // RSA key pair support for enhanced security
        this.keyPairs = this.loadKeyPairs();
        
        // Key rotation configuration
        this.keyRotation = {
            enabled: process.env.JWT_KEY_ROTATION === 'true',
            interval: parseInt(process.env.JWT_KEY_ROTATION_INTERVAL) || 24 * 60 * 60 * 1000, // 24 hours
            lastRotation: Date.now(),
            maxKeyAge: parseInt(process.env.JWT_MAX_KEY_AGE) || 7 * 24 * 60 * 60 * 1000 // 7 days
        };
    }

    /**
     * Generate cryptographically strong secret
     */
    generateStrongSecret(length = 64) {
        return crypto.randomBytes(length).toString('base64');
    }

    /**
     * Load RSA key pairs for JWT signing (if available)
     */
    loadKeyPairs() {
        const keyDir = process.env.JWT_KEY_DIR || path.join(process.cwd(), 'keys');
        const keyPairs = {};

        try {
            // Load private key
            const privateKeyPath = path.join(keyDir, 'jwt-private.pem');
            if (fs.existsSync(privateKeyPath)) {
                keyPairs.privateKey = fs.readFileSync(privateKeyPath, 'utf8');
            }

            // Load public key
            const publicKeyPath = path.join(keyDir, 'jwt-public.pem');
            if (fs.existsSync(publicKeyPath)) {
                keyPairs.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
            }

            if (keyPairs.privateKey && keyPairs.publicKey) {
                console.log('✅ JWT RSA key pairs loaded successfully');
            }
        } catch (error) {
            console.warn('⚠️ Failed to load JWT key pairs:', error.message);
        }

        return keyPairs;
    }

    /**
     * Setup token lifecycle management
     */
    setupTokenLifecycle() {
        this.lifecycle = {
            access: {
                expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
                maxAge: this.parseTimeToSeconds(process.env.JWT_ACCESS_EXPIRES || '15m'),
                refreshThreshold: 0.8 // Refresh when 80% of lifetime has passed
            },
            refresh: {
                expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
                maxAge: this.parseTimeToSeconds(process.env.JWT_REFRESH_EXPIRES || '7d'),
                rotationInterval: this.parseTimeToSeconds(process.env.JWT_REFRESH_ROTATION || '1d')
            },
            // Short-lived tokens for sensitive operations
            shortLived: {
                expiresIn: process.env.JWT_SHORT_LIVED_EXPIRES || '5m',
                maxAge: this.parseTimeToSeconds(process.env.JWT_SHORT_LIVED_EXPIRES || '5m')
            }
        };
    }

    /**
     * Configure security policies and validation rules
     */
    configureSecurityPolicies() {
        this.security = {
            algorithms: {
                primary: this.keyPairs.privateKey ? 'RS256' : 'HS256',
                allowed: this.keyPairs.privateKey ? 
                    ['RS256', 'RS384', 'RS512'] : 
                    ['HS256', 'HS384', 'HS512'],
                fallback: 'HS256'
            },
            validation: {
                clockTolerance: parseInt(process.env.JWT_CLOCK_TOLERANCE) || 30, // seconds
                maxAge: parseInt(process.env.JWT_MAX_AGE) || 24 * 60 * 60, // 24 hours max
                requireIat: true,
                requireExp: true,
                requireNbf: false,
                ignoreExpiration: false,
                ignoreNotBefore: false
            },
            claims: {
                issuer: process.env.JWT_ISSUER || process.env.APP_NAME || 'MyApp',
                audience: process.env.JWT_AUDIENCE || process.env.APP_URL || 'MyApp-Users',
                subject: 'user', // Default subject type
                jwtId: true, // Include JTI for token tracking
                custom: {
                    sessionId: true,
                    deviceId: false,
                    permissions: true,
                    roles: true
                }
            }
        };
    }

    /**
     * Parse time string to seconds
     */
    parseTimeToSeconds(timeStr) {
        if (typeof timeStr === 'number') return timeStr;
        
        const units = {
            's': 1,
            'm': 60,
            'h': 3600,
            'd': 86400,
            'w': 604800
        };

        const match = timeStr.match(/^(\d+)([smhdw]?)$/);
        if (!match) return 900; // 15 minutes default

        const [, value, unit] = match;
        return parseInt(value) * (units[unit] || 60); // default to minutes
    }

    /**
     * Get signing configuration based on algorithm
     */
    getSigningConfig(algorithm = null) {
        const alg = algorithm || this.security.algorithms.primary;
        
        if (alg.startsWith('RS') && this.keyPairs.privateKey) {
            return {
                algorithm: alg,
                privateKey: this.keyPairs.privateKey,
                publicKey: this.keyPairs.publicKey
            };
        }
        
        return {
            algorithm: 'HS256',
            secret: this.secrets.access
        };
    }

    /**
     * Get verification configuration
     */
    getVerificationConfig(algorithm = null) {
        const alg = algorithm || this.security.algorithms.primary;
        
        if (alg.startsWith('RS') && this.keyPairs.publicKey) {
            return {
                algorithm: alg,
                publicKey: this.keyPairs.publicKey,
                algorithms: this.security.algorithms.allowed
            };
        }
        
        return {
            algorithm: 'HS256',
            secret: this.secrets.access,
            algorithms: this.security.algorithms.allowed
        };
    }

    /**
     * Enhanced cookie configuration with security policies
     */
    getCookieConfig(tokenType = 'access') {
        const baseConfig = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production' || process.env.FORCE_HTTPS === 'true',
            sameSite: this.getSameSitePolicy(),
            domain: process.env.COOKIE_DOMAIN || undefined,
            path: process.env.COOKIE_PATH || '/',
            signed: process.env.COOKIE_SIGNED === 'true'
        };

        // Token-specific configurations
        switch (tokenType) {
            case 'access':
                return {
                    ...baseConfig,
                    name: process.env.JWT_ACCESS_COOKIE_NAME || 'access_token',
                    maxAge: this.lifecycle.access.maxAge * 1000, // milliseconds
                    priority: 'high'
                };
                
            case 'refresh':
                return {
                    ...baseConfig,
                    name: process.env.JWT_REFRESH_COOKIE_NAME || 'refresh_token',
                    maxAge: this.lifecycle.refresh.maxAge * 1000, // milliseconds
                    httpOnly: true, // Refresh tokens should always be httpOnly
                    sameSite: 'strict', // Stricter policy for refresh tokens
                    priority: 'high'
                };
                
            case 'csrf':
                return {
                    ...baseConfig,
                    name: process.env.CSRF_COOKIE_NAME || 'csrf_token',
                    httpOnly: false, // CSRF tokens need to be accessible to JavaScript
                    maxAge: this.lifecycle.access.maxAge * 1000,
                    priority: 'medium'
                };
                
            default:
                return baseConfig;
        }
    }

    /**
     * Determine appropriate SameSite policy based on environment
     */
    getSameSitePolicy() {
        const policy = process.env.COOKIE_SAMESITE?.toLowerCase();
        
        if (['strict', 'lax', 'none'].includes(policy)) {
            return policy;
        }
        
        // Default policies based on environment
        if (process.env.NODE_ENV === 'production') {
            return process.env.CROSS_ORIGIN_REQUESTS === 'true' ? 'none' : 'strict';
        }
        
        return 'lax'; // Development default
    }

    /**
     * Get token payload template
     */
    getPayloadTemplate(user, tokenType = 'access', customClaims = {}) {
        const now = Math.floor(Date.now() / 1000);
        const exp = now + (tokenType === 'refresh' ? 
            this.lifecycle.refresh.maxAge : 
            this.lifecycle.access.maxAge);

        const payload = {
            // Standard claims
            iss: this.security.claims.issuer,
            aud: this.security.claims.audience,
            sub: user.id || user._id,
            iat: now,
            exp: exp,
            jti: crypto.randomUUID(),
            
            // Token metadata
            tokenType,
            version: process.env.JWT_VERSION || '1.0',
            
            // User claims
            userId: user.id || user._id,
            email: user.email,
            role: user.role || 'user',
            permissions: user.permissions || [],
            
            // Security claims
            sessionId: customClaims.sessionId || crypto.randomUUID(),
            issuedBy: 'auth-service',
            
            // Custom claims
            ...customClaims
        };

        // Add optional claims based on configuration
        if (this.security.claims.custom.deviceId && customClaims.deviceId) {
            payload.deviceId = customClaims.deviceId;
        }

        if (user.mfaEnabled) {
            payload.mfaVerified = customClaims.mfaVerified || false;
        }

        return payload;
    }

    /**
     * Get complete JWT configuration object
     */
    getConfig() {
        return {
            // Secrets and keys
            secrets: this.secrets,
            keyPairs: this.keyPairs,
            
            // Token lifecycle
            lifecycle: this.lifecycle,
            
            // Security settings
            security: this.security,
            
            // Cookie configurations
            cookies: {
                access: this.getCookieConfig('access'),
                refresh: this.getCookieConfig('refresh'),
                csrf: this.getCookieConfig('csrf')
            },
            
            // Signing and verification
            signing: this.getSigningConfig(),
            verification: this.getVerificationConfig(),
            
            // Utility methods
            getPayload: this.getPayloadTemplate.bind(this),
            parseTime: this.parseTimeToSeconds.bind(this),
            
            // Key rotation
            keyRotation: this.keyRotation,
            
            // Environment info
            environment: {
                nodeEnv: process.env.NODE_ENV || 'development',
                isProduction: process.env.NODE_ENV === 'production',
                isDevelopment: process.env.NODE_ENV === 'development',
                forceHttps: process.env.FORCE_HTTPS === 'true'
            }
        };
    }

    /**
     * Validate JWT configuration
     */
    validateConfig() {
        const issues = [];
        
        // Check secret strength
        if (this.secrets.access.length < 32) {
            issues.push('JWT access secret is too short');
        }
        
        if (this.secrets.refresh.length < 32) {
            issues.push('JWT refresh secret is too short');
        }
        
        // Check token expiration times
        if (this.lifecycle.access.maxAge > this.lifecycle.refresh.maxAge) {
            issues.push('Access token lifetime should not exceed refresh token lifetime');
        }
        
        // Check cookie security in production
        if (process.env.NODE_ENV === 'production') {
            if (!this.getCookieConfig('access').secure) {
                issues.push('Cookies should be secure in production');
            }
        }
        
        // Check algorithm compatibility
        if (this.security.algorithms.primary.startsWith('RS') && !this.keyPairs.privateKey) {
            issues.push('RSA algorithm selected but no private key available');
        }
        
        return {
            valid: issues.length === 0,
            issues
        };
    }

    /**
     * Generate key rotation configuration
     */
    setupKeyRotation() {
        if (!this.keyRotation.enabled) return null;
        
        return {
            rotateKeys: async () => {
                // Implement key rotation logic
                this.secrets.access = this.generateStrongSecret();
                this.secrets.refresh = this.generateStrongSecret();
                this.keyRotation.lastRotation = Date.now();
                
                console.log('🔄 JWT keys rotated successfully');
            },
            
            shouldRotate: () => {
                const age = Date.now() - this.keyRotation.lastRotation;
                return age >= this.keyRotation.interval;
            },
            
            getRotationStatus: () => ({
                lastRotation: new Date(this.keyRotation.lastRotation).toISOString(),
                nextRotation: new Date(this.keyRotation.lastRotation + this.keyRotation.interval).toISOString(),
                age: Date.now() - this.keyRotation.lastRotation,
                shouldRotate: this.shouldRotate()
            })
        };
    }
}

// Create singleton instance
const jwtConfig = new JWTConfig();

// Validate configuration on startup
const validation = jwtConfig.validateConfig();
if (!validation.valid) {
    console.warn('⚠️ JWT Configuration Issues:', validation.issues);
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Invalid JWT configuration for production');
    }
}

// Export complete configuration
module.exports = {
    // Main configuration object
    ...jwtConfig.getConfig(),
    
    // Utility functions
    validateConfig: () => jwtConfig.validateConfig(),
    setupKeyRotation: () => jwtConfig.setupKeyRotation(),
    
    // Quick access properties for backward compatibility
    secret: jwtConfig.secrets.access,
    refreshSecret: jwtConfig.secrets.refresh,
    accessExpiresIn: jwtConfig.lifecycle.access.expiresIn,
    refreshExpiresIn: jwtConfig.lifecycle.refresh.expiresIn,
    issuer: jwtConfig.security.claims.issuer,
    audience: jwtConfig.security.claims.audience,
    cookie: jwtConfig.getCookieConfig('access'),
    
    // Enhanced exports
    algorithms: jwtConfig.security.algorithms,
    clockTolerance: jwtConfig.security.validation.clockTolerance,
    maxAge: jwtConfig.lifecycle.access.maxAge
};
