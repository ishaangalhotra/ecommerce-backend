const { client, useRedis } = require('../config/redisClient');
/**
 * Redis-backed CSRF middleware.
 * Expects token in X-CSRF-Token header and stored in Redis under key `csrf:<token>` mapped to a short value (e.g., user id or '1').
 * Also supports double-submit cookie fallback (header === XSRF-TOKEN cookie).
 */
module.exports = async function csrfMiddleware(req, res, next) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  const header = req.get('X-CSRF-Token') || req.get('x-xsrf-token');
  const cookieToken = req.cookies && req.cookies['XSRF-TOKEN'];
  // If Redis is available, check Redis for token key
  if (useRedis && header) {
    try {
      const val = await client.get(`csrf:${header}`);
      if (val) {
        // Optionally delete one-time tokens here
        // await client.del(`csrf:${header}`);
        return next();
      }
      return res.status(403).json({ error: 'Invalid CSRF token' });
    } catch (err) {
      console.error('CSRF redis check error', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // Fallback double-submit cookie check
  if (!header || !cookieToken || header !== cookieToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next();
};
