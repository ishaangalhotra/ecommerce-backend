const express = require('express');
const router = express.Router();

// Import individual route files
const authRoutes = require('./auth');
const userRoutes = require('./users');
const productRoutes = require('./products');
const cartRoutes = require('./cart');
const orderRoutes = require('./orders');
const adminRoutes = require('./admin');
const adminProductRoutes = require('./adminproducts');
const sellerRoutes = require('./seller');
const paymentRoutes = require('./payment-routes');
const webhookRoutes = require('./webhook-routes');
const wishlistRoutes = require('./wishlist');
const deliveryRoutes = require('./delivery');
const localDeliveryRoutes = require('./localdelivery');

// API documentation route
router.get('/', (req, res) => {
  res.json({
    message: 'QuickLocal Backend API',
    version: '2.0.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      products: '/api/products',
      cart: '/api/cart',
      orders: '/api/orders',
      admin: '/api/admin',
      seller: '/api/seller',
      payments: '/api/payments',
      webhooks: '/api/webhooks',
      wishlist: '/api/wishlist',
      delivery: '/api/delivery',
      localDelivery: '/api/local-delivery'
    }
  });
});

// Mount API routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/products', adminProductRoutes);
router.use('/seller', sellerRoutes);
router.use('/payments', paymentRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/delivery', deliveryRoutes);
router.use('/local-delivery', localDeliveryRoutes);

module.exports = router;
