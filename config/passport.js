const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const config = require('./config'); // Your enhanced config
const logger = require('../utils/logger'); // Assuming you have a logger utility

// Enhanced Google OAuth configuration
module.exports = (passport) => {
  // Only configure Google strategy if credentials exist
  if (config.google && config.google.clientId && config.google.clientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientId,
          clientSecret: config.google.clientSecret,
          callbackURL: config.google.callbackUrl,
          passReqToCallback: true, // Allows access to the request object
          scope: ['profile', 'email'], // Explicitly request these scopes
          state: true // Enable CSRF protection
        },
        async (req, accessToken, refreshToken, profile, done) => {
          try {
            // Validate profile has required data
            if (!profile.emails || !profile.emails[0]) {
              logger.warn('Google OAuth profile missing email', { profile });
              return done(new Error('No email found in Google profile'), null);
            }

            // Find or create user
            let user = await User.findOne({ 
              $or: [
                { googleId: profile.id },
                { email: profile.emails[0].value }
              ]
            });

            if (!user) {
              user = await User.create({
                googleId: profile.id,
                email: profile.emails[0].value,
                name: profile.displayName,
                isVerified: true,
                avatar: profile.photos?.[0]?.value,
                provider: 'google'
              });
              logger.info(`New user created via Google OAuth: ${user.email}`);
            } else if (!user.googleId) {
              // User exists but hasn't linked Google account
              user.googleId = profile.id;
              user.isVerified = true;
              await user.save();
              logger.info(`Existing user linked Google account: ${user.email}`);
            }

            return done(null, user);
          } catch (err) {
            logger.error('Google authentication error', { error: err.message, stack: err.stack });
            return done(err, null);
          }
        }
      )
    );
  } else {
    logger.warn('Google OAuth credentials not configured. Google login will be disabled.');
  }

  // Enhanced serialization with error handling
  passport.serializeUser((user, done) => {
    try {
      done(null, user.id);
    } catch (err) {
      logger.error('Serialization error', { error: err.message });
      done(err, null);
    }
  });

  // Enhanced deserialization with caching
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id).cache({
        key: `user:${id}`,
        ttl: config.redis?.ttl || 3600 // Use configured TTL or default
      });
      
      if (!user) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }
      
      done(null, user);
    } catch (err) {
      logger.error('Deserialization error', { userId: id, error: err.message });
      done(err, null);
    }
  });
};