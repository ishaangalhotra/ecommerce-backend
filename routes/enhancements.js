
// CSRF token issuance (Redis-backed)
// Returns a token and sets a XSRF-TOKEN cookie. Token is stored in Redis with a short TTL.
router.get('/csrf-token', async (req, res) => {
  try {
    const token = require('crypto').randomBytes(24).toString('hex');
    // store in Redis with TTL (e.g., 15 minutes)
    const { client, useRedis } = require('../config/redisClient');
    if (useRedis) {
      try {
        await client.set(`csrf:${token}`, '1', 'EX', 60 * 15); // 15 minutes
      } catch (e) {
        console.error('Failed to write CSRF token to Redis', e);
      }
    }
    res.cookie('XSRF-TOKEN', token, { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' });
    res.json({ csrfToken: token });
  } catch (err) {
    console.error('CSRF token error', err);
    res.status(500).json({ error: 'Server error' });
  }
});


const express = require('express');
const router = express.Router();
const Product = require('../models/product');
const Coupon = require('../models/coupon');
const crypto = require('crypto');

// Simple product suggestions (server-side fallback)
router.get('/products/suggest', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ suggestions: [] });
    const regex = new RegExp(q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
    const products = await Product.find({ name: regex, status: 'active' })
      .limit(10)
      .select('name price image category')
      .lean();
    res.json({ suggestions: products });
  } catch (err) {
    console.error('Suggest error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Related products by category heuristic
router.get('/products/related/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId).lean();
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const related = await Product.find({
      _id: { $ne: product._id },
      category: product.category,
      status: 'active'
    })
    .sort({ sales: -1, rating: -1 })
    .limit(6)
    .select('name price image category')
    .lean();
    res.json({ related });
  } catch (err) {
    console.error('Related error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Simple coupon verification endpoint
router.post('/coupons/verify', async (req, res) => {
  try {
    const code = (req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ valid: false, message: 'Coupon code required' });
    const coupon = await Coupon.findOne({ code });
    if (!coupon) return res.json({ valid: false, message: 'Invalid coupon' });
    // Use model method if available
    const now = new Date();
    const isActive = coupon.isActive && (!coupon.validFrom || now >= coupon.validFrom) && (!coupon.validUntil || now <= coupon.validUntil);
    if (!isActive) return res.json({ valid: false, message: 'Coupon expired or inactive' });
    // Note: server-side per-user usage limit enforcement should be added in production
    res.json({ valid: true, message: 'Coupon valid', coupon: { code: coupon.code, type: coupon.type, value: coupon.value } });
  } catch (err) {
    console.error('Coupon verify error', err);
    res.status(500).json({ valid: false, message: 'Server error' });
  }
});

// CSRF token issuance (double-submit token pattern)
// This endpoint returns a short-lived random token for the client to send with mutating requests.
// For robust protection use server-side sessions & csurf.
res.json({ csrfToken: token });
  } catch (err) {
    console.error('CSRF token error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
