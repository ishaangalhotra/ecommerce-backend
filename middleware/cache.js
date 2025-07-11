const { getCache } = require('../services/cache');

module.exports = (keyPrefix, ttl) => async (req, res, next) => {
  const key = `${keyPrefix}:${req.originalUrl}`;
  const cachedData = await getCache(key);
  
  if (cachedData) {
    return res.status(200).json({
      status: 'success',
      fromCache: true,
      data: cachedData
    });
  }
  
  res.sendResponse = res.json;
  res.json = (body) => {
    setCache(key, body.data, ttl);
    res.sendResponse(body);
  };
  
  next();
};