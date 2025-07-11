const { generateTokens, verifyJWT, decodeToken } = require('./token.utils');
const { setCookies, clearCookies } = require('./cookie.utils');

module.exports = {
  generateTokens,
  verifyJWT,
  decodeToken,
  setCookies,
  clearCookies,
  // Add other auth utilities here
};