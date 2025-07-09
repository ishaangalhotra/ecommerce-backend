const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const config = require('./config');

module.exports = (passport) => {
  // Only configure Google strategy if credentials exist
  if (config.google && config.google.clientId && config.google.clientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientId,
          clientSecret: config.google.clientSecret,
          callbackURL: config.google.callbackUrl
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            let user = await User.findOne({ googleId: profile.id });
            
            if (!user) {
              user = await User.create({
                googleId: profile.id,
                email: profile.emails[0].value,
                name: profile.displayName,
                isVerified: true
              });
            }
            
            return done(null, user);
          } catch (err) {
            return done(err, null);
          }
        }
      )
    );
  }

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });
};