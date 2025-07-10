const passport = require('passport');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const config = require('./config');
const User = require('../models/User'); // Adjust path if your User model is elsewhere

// JWT Strategy Options
const opts = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: config.jwt.secret,
  issuer: config.jwt.issuer || 'MyStore',
  audience: config.jwt.audience || 'MyStore-Client'
};

// JWT Strategy
passport.use(new JwtStrategy(opts, async (jwt_payload, done) => {
  try {
    const user = await User.findById(jwt_payload.sub);
    if (user) {
      return done(null, user);
    }
    return done(null, false);
  } catch (err) {
    return done(err, false);
  }
}));

// Initialize Passport
module.exports = passport;