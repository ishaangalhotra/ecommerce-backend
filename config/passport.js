const passport = require('passport');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { Strategy: LocalStrategy } = require('passport-local');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { Strategy: FacebookStrategy } = require('passport-facebook');
const { Strategy: GitHubStrategy } = require('passport-github2');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const helmet = require('helmet');
const { RateLimiterRedis } = require('rate-limiter-flexible');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const axios = require('axios');

const User = require('../models/User');
const config = require('./config');
const logger = require('../utils/logger');
const { redisManager } = require('./redis');

class PassportManager {
    constructor() {
        this.failedAttempts = new Map();
        this.suspiciousActivity = new Set();
        this.maxFailedAttempts = config.security?.maxFailedAttempts || 5;
        this.lockoutDuration = config.security?.lockoutDuration || 30 * 60 * 1000;
        
        // Initialize MFA system
        this.mfa = {
            generateSecret: this.generateMFASecret,
            verifyToken: this.verifyMFAToken,
            generateBackupCodes: this.generateBackupCodes
        };
    }

    // Security Headers Middleware
    setupSecurityHeaders() {
        return [
            helmet(),
            helmet.hsts({
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }),
            helmet.frameguard({ action: 'deny' }),
            helmet.noSniff(),
            helmet.xssFilter(),
            helmet.referrerPolicy({ policy: 'same-origin' }),
            (req, res, next) => {
                res.set('X-Content-Type-Options', 'nosniff');
                res.set('X-Frame-Options', 'DENY');
                res.set('X-XSS-Protection', '1; mode=block');
                res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
                next();
            }
        ];
    }

    // CSRF Protection
    setupCSRFProtection() {
        const csrf = require('csurf');
        return csrf({
            cookie: {
                httpOnly: true,
                sameSite: 'strict',
                secure: config.security?.https || false
            },
            value: (req) => req.headers['x-csrf-token'] || req.body._csrf
        });
    }

    // Rate Limiting
    setupRateLimiting() {
        const rateLimiterMemory = new RateLimiterRedis({
            points: 5,
            duration: 15 * 60,
            storeClient: { get: () => {}, set: () => {} } // Mock for fallback
        });
        
        const rateLimiterRedis = new RateLimiterRedis({
            storeClient: redisManager.client,
            points: config.security?.maxAuthAttempts || 5,
            duration: 15 * 60,
            blockDuration: 30 * 60,
            keyPrefix: 'auth_attempts',
            execEvenly: true,
            insuranceLimiter: rateLimiterMemory
        });
        
        return async (req, res, next) => {
            const key = `${req.ip}:${req.body.email}`;
            
            try {
                const rateLimiterRes = await rateLimiterRedis.consume(key);
                
                res.set({
                    'X-RateLimit-Limit': rateLimiterRedis.points,
                    'X-RateLimit-Remaining': rateLimiterRes.remainingPoints,
                    'X-RateLimit-Reset': Math.ceil(rateLimiterRes.msBeforeNext / 1000)
                });
                
                next();
            } catch (rejRes) {
                res.set({
                    'Retry-After': Math.ceil(rejRes.msBeforeNext / 1000),
                    'X-RateLimit-Limit': rateLimiterRedis.points,
                    'X-RateLimit-Remaining': 0,
                    'X-RateLimit-Reset': Math.ceil(rejRes.msBeforeNext / 1000)
                });
                
                return res.status(429).json({
                    error: 'Too many requests',
                    retryAfter: Math.ceil(rejRes.msBeforeNext / 1000)
                });
            }
        };
    }

    // Password Policy
    validatePasswordPolicy(password, user = null) {
        const policy = config.security?.passwordPolicy || {
            minLength: 12,
            requireUppercase: true,
            requireLowercase: true,
            requireNumbers: true,
            requireSymbols: true,
            blockCommon: true,
            blockReuse: true,
            blockSimilar: true
        };
        
        const errors = [];
        
        if (password.length < policy.minLength) {
            errors.push(`Password must be at least ${policy.minLength} characters`);
        }
        
        if (policy.requireUppercase && !/[A-Z]/.test(password)) {
            errors.push('Password must contain at least one uppercase letter');
        }
        
        if (policy.requireLowercase && !/[a-z]/.test(password)) {
            errors.push('Password must contain at least one lowercase letter');
        }
        
        if (policy.requireNumbers && !/[0-9]/.test(password)) {
            errors.push('Password must contain at least one number');
        }
        
        if (policy.requireSymbols && !/[^A-Za-z0-9]/.test(password)) {
            errors.push('Password must contain at least one symbol');
        }
        
        if (policy.blockCommon && this.isCommonPassword(password)) {
            errors.push('Password is too common');
        }
        
        if (policy.blockReuse && user && user.passwordHistory) {
            for (const oldHash of user.passwordHistory) {
                if (bcrypt.compareSync(password, oldHash)) {
                    errors.push('Cannot reuse previous passwords');
                    break;
                }
            }
        }
        
        if (policy.blockSimilar && user) {
            const userInfo = [user.email, user.name, user.username].filter(Boolean);
            for (const info of userInfo) {
                if (info && password.toLowerCase().includes(info.toLowerCase())) {
                    errors.push('Password too similar to your personal information');
                    break;
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    isCommonPassword(password) {
        const commonPasswords = new Set([
            'password', '123456', 'qwerty', 'letmein', 'welcome',
            'admin', 'password1', '12345678', '123456789', '123123'
        ]);
        
        return commonPasswords.has(password.toLowerCase());
    }

    // MFA System
    async generateMFASecret(user) {
        const secret = speakeasy.generateSecret({
            length: 32,
            name: `${config.app.name}:${user.email}`,
            issuer: config.app.name
        });
        
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
        
        return {
            secret: secret.base32,
            qrCodeUrl,
            otpauthUrl: secret.otpauth_url
        };
    }

    verifyMFAToken(user, token) {
        return speakeasy.totp.verify({
            secret: user.mfaSecret,
            encoding: 'base32',
            token,
            window: 1
        });
    }

    generateBackupCodes(count = 10) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }
        return codes;
    }

    requireMFA() {
        return async (req, res, next) => {
            if (!req.user) return res.status(401).json({ error: 'Authentication required' });
            if (!req.user.mfaEnabled) return next();
            
            const token = req.headers['x-mfa-token'] || req.body.mfaToken;
            if (!token) return res.status(403).json({ 
                error: 'MFA required',
                mfaRequired: true
            });
            
            const isValid = this.verifyMFAToken(req.user, token);
            if (!isValid) return res.status(403).json({ 
                error: 'Invalid MFA token',
                mfaRequired: true
            });
            
            next();
        };
    }

    // Session Management
    setupSessionManagement() {
        return session({
            store: new RedisStore({ client: redisManager.client }),
            secret: config.session.secret,
            resave: false,
            saveUninitialized: false,
            rolling: true,
            cookie: {
                httpOnly: true,
                secure: config.security?.https || false,
                sameSite: 'strict',
                maxAge: 24 * 60 * 60 * 1000,
                domain: config.session.cookieDomain || undefined
            },
            name: config.session.cookieName || 'sid'
        });
    }

    trackSessionActivity(userId, sessionId, req) {
        if (!redisManager.client) return;
        
        const sessionKey = `user:${userId}:sessions`;
        const sessionData = {
            id: sessionId,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
        };
        
        redisManager.client.hset(sessionKey, sessionId, JSON.stringify(sessionData));
        redisManager.client.expire(sessionKey, 30 * 24 * 60 * 60);
    }

    async getUserSessions(userId) {
        if (!redisManager.client) return [];
        
        const sessionKey = `user:${userId}:sessions`;
        const sessions = await redisManager.client.hgetall(sessionKey);
        return Object.values(sessions).map(s => JSON.parse(s));
    }

    async revokeSession(userId, sessionId) {
        if (!redisManager.client) return false;
        
        const sessionKey = `user:${userId}:sessions`;
        await redisManager.client.hdel(sessionKey, sessionId);
        await this.revokeToken(sessionId, 'Session revoked');
        return true;
    }

    // OAuth Enhancements
    generateOAuthState() {
        const state = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHmac('sha256', config.oauth.stateSecret)
            .update(state)
            .digest('hex');
        
        return `${state}.${hash}`;
    }

    verifyOAuthState(state) {
        if (!state) return false;
        
        const [stateValue, stateHash] = state.split('.');
        if (!stateValue || !stateHash) return false;
        
        const expectedHash = crypto.createHmac('sha256', config.oauth.stateSecret)
            .update(stateValue)
            .digest('hex');
        
        return stateHash === expectedHash;
    }

    async refreshOAuthToken(userId, provider) {
        const user = await User.findById(userId);
        if (!user || !user.oauth?.[provider]) return null;
        
        const oauthConfig = config.oauth[provider];
        const credentials = Buffer.from(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`).toString('base64');
        
        try {
            const response = await axios.post(oauthConfig.tokenUrl, {
                grant_type: 'refresh_token',
                refresh_token: user.oauth[provider].refreshToken,
                client_id: oauthConfig.clientId,
                client_secret: oauthConfig.clientSecret
            }, {
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            await User.updateOne(
                { _id: userId },
                { 
                    [`oauth.${provider}.accessToken`]: response.data.access_token,
                    [`oauth.${provider}.refreshToken`]: response.data.refresh_token || user.oauth[provider].refreshToken,
                    [`oauth.${provider}.tokenExpires`]: Date.now() + (response.data.expires_in * 1000),
                    [`oauth.${provider}.lastRefreshed`]: new Date()
                }
            );
            
            return response.data.access_token;
        } catch (error) {
            logger.error('OAuth token refresh failed', {
                error: error.message,
                userId,
                provider
            });
            return null;
        }
    }

    // Core Authentication Methods (from original implementation)
    initialize(passportInstance = passport) {
        this.setupJWTStrategy(passportInstance);
        this.setupLocalStrategy(passportInstance);
        this.setupOAuthStrategies(passportInstance);
        this.setupSessionHandling(passportInstance);
        this.setupSecurityMiddleware();
        
        logger.info('Passport authentication strategies initialized', {
            strategies: this.getEnabledStrategies()
        });
    }

    setupJWTStrategy(passportInstance) {
        const jwtOptions = {
            jwtFromRequest: ExtractJwt.fromExtractors([
                ExtractJwt.fromAuthHeaderAsBearerToken(),
                ExtractJwt.fromHeader('x-access-token'),
                ExtractJwt.fromUrlQueryParameter('token'),
                this.extractFromCookie,
                this.extractFromCustomHeader
            ]),
            secretOrKey: config.jwt.secret,
            issuer: config.jwt.issuer,
            audience: config.jwt.audience,
            algorithms: ['HS256'],
            clockTolerance: 30,
            ignoreExpiration: false,
            passReqToCallback: true
        };

        passportInstance.use('jwt', new JwtStrategy(jwtOptions, async (req, jwtPayload, done) => {
            // ... (original implementation)
        }));
    }

    setupLocalStrategy(passportInstance) {
        const localOptions = {
            usernameField: config.auth?.usernameField || 'email',
            passwordField: config.auth?.passwordField || 'password',
            passReqToCallback: true
        };

        passportInstance.use('local', new LocalStrategy(localOptions, async (req, email, password, done) => {
            // ... (original implementation)
        }));
    }

    setupOAuthStrategies(passportInstance) {
        if (config.oauth?.google?.enabled) {
            passportInstance.use('google', new GoogleStrategy({
                clientID: config.oauth.google.clientId,
                clientSecret: config.oauth.google.clientSecret,
                callbackURL: config.oauth.google.callbackUrl,
                scope: config.oauth.google.scope || ['profile', 'email'],
                passReqToCallback: true,
                state: true
            }, this.handleOAuthCallback('google')));
        }

        if (config.oauth?.facebook?.enabled) {
            passportInstance.use('facebook', new FacebookStrategy({
                clientID: config.oauth.facebook.clientId,
                clientSecret: config.oauth.facebook.clientSecret,
                callbackURL: config.oauth.facebook.callbackUrl,
                profileFields: config.oauth.facebook.profileFields || ['id', 'emails', 'name', 'displayName', 'photos'],
                passReqToCallback: true,
                state: true
            }, this.handleOAuthCallback('facebook')));
        }

        if (config.oauth?.github?.enabled) {
            passportInstance.use('github', new GitHubStrategy({
                clientID: config.oauth.github.clientId,
                clientSecret: config.oauth.github.clientSecret,
                callbackURL: config.oauth.github.callbackUrl,
                scope: config.oauth.github.scope || ['user:email'],
                passReqToCallback: true,
                state: true
            }, this.handleOAuthCallback('github')));
        }
    }

    // ... (include all other original methods)

    // Utility methods
    getEnabledStrategies() {
        const strategies = ['jwt', 'local'];
        if (config.oauth?.google?.enabled) strategies.push('google');
        if (config.oauth?.facebook?.enabled) strategies.push('facebook');
        if (config.oauth?.github?.enabled) strategies.push('github');
        return strategies;
    }

    async revokeToken(jti, reason = 'User logout') {
        if (!redisManager.client || !jti) return false;

        try {
            await redisManager.client.setex(
                `blacklist:${jti}`,
                24 * 60 * 60,
                JSON.stringify({
                    reason,
                    timestamp: new Date().toISOString()
                })
            );
            logger.info('Token revoked', { jti, reason });
            return true;
        } catch (error) {
            logger.error('Failed to revoke token', { error: error.message, jti });
            return false;
        }
    }
}

// Singleton instance
const passportManager = new PassportManager();

// Initialize function
const initializePassport = (passport) => {
    passportManager.initialize(passport);
};

// Export everything
module.exports = {
    PassportManager,
    passportManager,
    initializePassport,
    
    // Security middleware
    securityHeaders: passportManager.setupSecurityHeaders(),
    csrfProtection: passportManager.setupCSRFProtection(),
    rateLimiting: passportManager.setupRateLimiting(),
    sessionManagement: passportManager.setupSessionManagement(),
    
    // Authentication utilities
    requireAuth: (strategy = 'jwt') => passport.authenticate(strategy, { session: false }),
    requireRole: (roles) => (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                error: 'Insufficient permissions',
                required: roles,
                current: req.user.role
            });
        }
        next();
    },
    requireMFA: passportManager.requireMFA(),
    
    // Password utilities
    validatePassword: (password, user) => passportManager.validatePasswordPolicy(password, user),
    
    // MFA utilities
    mfa: passportManager.mfa,
    
    // Session utilities
    getSessions: (userId) => passportManager.getUserSessions(userId),
    revokeSession: (userId, sessionId) => passportManager.revokeSession(userId, sessionId),
    
    // OAuth utilities
    generateOAuthState: () => passportManager.generateOAuthState(),
    verifyOAuthState: (state) => passportManager.verifyOAuthState(state),
    refreshOAuthToken: (userId, provider) => passportManager.refreshOAuthToken(userId, provider),
    
    // Backward compatibility
    default: initializePassport
};