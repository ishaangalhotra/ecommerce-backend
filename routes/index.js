const express = require('express');
const router = express.Router();

// Import all route modules
const authRoutes = require('./hybridAuth');
const testAuthRoutes = require('./testAuth');
const authBypassRoutes = require('./authBypass');
const userRoutes = require('./users');
const productRoutes = require('./products');
const categoryRoutes = require('./categories'); // ✅ ADD THIS LINE
const orderRoutes = require('./advancedOrders');
const deliveryRoutes = require('./delivery');
const cartRoutes = require('./cart');
const sellerRoutes = require('./seller');
const adminRoutes = require('./admin');
const wishlistRoutes = require('./wishlist');

// Mount routes
router.use('/auth', authRoutes);
router.use('/test', testAuthRoutes);
router.use('/bypass', authBypassRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes); // ✅ AND ADD THIS LINE
router.use('/orders', orderRoutes);
router.use('/delivery', deliveryRoutes);
router.use('/cart', cartRoutes);
router.use('/seller', sellerRoutes);
router.use('/admin', adminRoutes);
router.use('/wishlist', wishlistRoutes);

module.exports = router;