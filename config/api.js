// config/api.js
module.exports = {
    version: process.env.API_VERSION || 'v1',
    prefix: process.env.API_PREFIX || '/api',
    documentation: {
        enabled: process.env.ENABLE_DOCS !== 'false',
        path: '/docs',
        title: process.env.APP_NAME || 'API Documentation'
    },
    pagination: {
        defaultLimit: 20,
        maxLimit: 100
    },
    validation: {
        stripUnknown: true,
        abortEarly: false
    }
};
