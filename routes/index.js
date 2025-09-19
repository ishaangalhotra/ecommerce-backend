const express = require('express');
const router = express.Router();

// Import all route modules
const authRoutes = require('./hybridAuth'); // Fixed: Use hybridAuth instead of missing auth.js
const testAuthRoutes = require('./testAuth');
const authBypassRoutes = require('./authBypass');
const userRoutes = require('./users');
const productRoutes = require('./products');
const orderRoutes = require('./orders');
const deliveryRoutes = require('./delivery');
const cartRoutes = require('./cart');
const sellerRoutes = require('./seller');
const adminRoutes = require('./admin');
const wishlistRoutes = require('./wishlist');
const categoryRoutes = require('./categories');
const analyticsRoutes = require('./analytics');

// Mount routes
router.use('/auth', authRoutes);
router.use('/test', testAuthRoutes);
router.use('/bypass', authBypassRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/delivery', deliveryRoutes);
router.use('/cart', cartRoutes);
router.use('/seller', sellerRoutes);
router.use('/admin', adminRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/categories', categoryRoutes);
router.use('/analytics', analyticsRoutes);

module.exports = router;
