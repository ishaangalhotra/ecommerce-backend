module.exports = {
  secret: process.env.JWT_SECRET || 'your-strong-default-secret',
  refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-strong-refresh-secret',
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
  issuer: process.env.JWT_ISSUER || 'your-app-name',
  cookie: {
    name: 'token',
    expiresIn: process.env.JWT_COOKIE_EXPIRES || 7, // days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    domain: process.env.COOKIE_DOMAIN || undefined
  }
};