// routes/imagekit.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

/**
 * @route   GET /api/v1/imagekit-auth
 * @desc    Generate signed upload parameters for ImageKit
 * @access  Private (Seller only)
 */
router.get('/imagekit-auth', protect, (req, res) => {
  try {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) {
      return res.status(500).json({ error: 'IMAGEKIT_PRIVATE_KEY not set in environment' });
    }

    const token = crypto.randomBytes(16).toString('hex');
    const expire = Math.floor(Date.now() / 1000) + 240; // expire in 4 minutes

    const signature = crypto
      .createHmac('sha1', privateKey)
      .update(token + expire)
      .digest('hex');

    res.json({
      signature,
      expire,
      token
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to generate ImageKit signature',
      details: err.message
    });
  }
});

module.exports = router;
