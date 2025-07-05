const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User'); // Adjust path as per your project structure
const config = require('./index'); // Import your main config file

module.exports = () => {
  // Google OAuth Strategy
  passport.use(new GoogleStrategy({
    clientID: config.google.clientId,
    clientSecret: config.google.clientSecret,
    callbackURL: config.google.callbackUrl
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id });

      if (user) {
        // User exists, update if necessary (e.g., if email verification is needed)
        // For simplicity, we'll just pass the user
        done(null, user);
      } else {
        // Create new user if they don't exist
        user = await User.create({
          googleId: profile.id,
          name: profile.displayName,
          email: profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null,
          isVerified: true // Assuming Google-authenticated emails are verified
          // You might want to add a default password or method to set one later if local login is also supported
        });
        done(null, user);
      }
    } catch (err) {
      done(err, false); // Pass error to Passport
    }
  }));

  // Passport serialize and deserialize user (if using sessions, although your current auth.js disables it)
  // Even if not using sessions for the main JWT flow, Passport might internally use these for OAuth.
  // It's good practice to have them.
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err, false);
    }
  });
};