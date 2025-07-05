// utils/validators.js
const { check, validationResult } = require('express-validator');
const { isEmail } = require('validator');

// Email validation
const validateEmail = (email) => {
  return isEmail(email) && 
         /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
};

// Password validation
const validatePassword = (password) => {
  return password.length >= 8 &&
         /[A-Z]/.test(password) &&
         /[a-z]/.test(password) &&
         /[0-9]/.test(password);
};

// Google OAuth profile validation
const validateGoogleProfile = (profile) => {
  return profile?.id && 
         profile?.displayName && 
         profile?.emails?.[0]?.value;
};

// Export validation middleware
exports.authValidation = [
  check('email').custom(validateEmail),
  check('password').custom(validatePassword)
];

// Export validation functions
module.exports = {
  validateEmail,
  validatePassword,
  validateGoogleProfile,
  authValidation: exports.authValidation
};