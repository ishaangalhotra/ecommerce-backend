const jwtConfig = require('../../config/jwt.config');

const setCookies = (res, tokens) => {
  const { accessToken, refreshToken } = tokens;
  const cookieOptions = {
    httpOnly: jwtConfig.cookie.httpOnly,
    secure: jwtConfig.cookie.secure,
    sameSite: jwtConfig.cookie.sameSite,
    domain: jwtConfig.cookie.domain
  };

  // Access Token Cookie
  res.cookie('access_token', accessToken, {
    ...cookieOptions,
    expires: new Date(Date.now() + jwtConfig.accessExpiresIn * 1000),
    path: '/'
  });

  // Refresh Token Cookie
  res.cookie('refresh_token', refreshToken, {
    ...cookieOptions,
    expires: new Date(Date.now() + jwtConfig.refreshExpiresIn * 1000),
    path: '/api/v1/auth/refresh-token'
  });
};

const clearCookies = (res) => {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  };

  res.clearCookie('access_token', options);
  res.clearCookie('refresh_token', { ...options, path: '/api/v1/auth/refresh-token' });
};

module.exports = { setCookies, clearCookies };
