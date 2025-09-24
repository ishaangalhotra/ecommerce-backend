// routes/imagekit.js - Memory-optimized direct upload system
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { hybridProtect } = require('../middleware/hybridAuthmiddleware');
const logger = require('../utils/logger');

/**
 * @route   GET /api/v1/imagekit/sign
 * @desc    Generate ImageKit signature for direct client upload (MEMORY OPTIMIZED)
 * @access  Private - Bypasses server memory by enabling direct browser->ImageKit upload
 */
router.get('/sign', hybridProtect, (req, res) => {
  try {
    // Validate environment variables
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
    const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;

    if (!privateKey || !publicKey) {
      logger.error('ImageKit configuration missing');
      return res.status(500).json({
        success: false,
        message: 'ImageKit configuration missing'
      });
    }

    // Generate timestamp and signature (minimal memory footprint)
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHmac('sha1', privateKey)
      .update(`timestamp=${timestamp}`)
      .digest('hex');

    // Memory-efficient logging
    logger.info('ImageKit signature generated', {
      userId: req.user._id || req.user.id,
      timestamp,
      userAgent: req.get('User-Agent')?.substring(0, 50) // Limit log size
    });

    // Return minimal response to reduce memory
    res.json({
      success: true,
      signature,
      timestamp,
      publicKey,
      urlEndpoint: urlEndpoint || 'https://ik.imagekit.io/your-imagekit-id',
      // User-specific folder for organization
      folder: `/users/${req.user._id || req.user.id}`,
      // Client-side validation limits
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    });

  } catch (error) {
    logger.error('ImageKit signature generation failed', {
      error: error.message,
      userId: req.user?._id || req.user?.id
    });
    res.status(500).json({
      success: false,
      message: 'Failed to generate upload signature'
    });
  }
});

/**
 * @route   POST /api/v1/imagekit/metadata  
 * @desc    Save image metadata after successful ImageKit upload (MEMORY OPTIMIZED)
 * @access  Private - Only stores minimal metadata, no file processing
 */
router.post('/metadata', hybridProtect, async (req, res) => {
  try {
    const { fileId, name, url, size, tags } = req.body;

    // Validate required fields (memory-efficient validation)
    if (!fileId || !url) {
      return res.status(400).json({
        success: false,
        message: 'File ID and URL required'
      });
    }

    // Store minimal metadata (no large objects in memory)
    const metadata = {
      userId: req.user._id || req.user.id,
      imagekitFileId: fileId,
      url: url.substring(0, 500), // Limit URL length
      name: name?.substring(0, 100) || 'untitled', // Limit name length  
      size: Math.min(size || 0, 10 * 1024 * 1024), // Cap at 10MB
      tags: Array.isArray(tags) ? tags.slice(0, 10) : [], // Limit tags
      uploadedAt: new Date()
    };

    // If you have an Image model, save efficiently:
    // const Image = require('../models/Image');
    // await new Image(metadata).save();

    // Memory-efficient logging
    logger.info('Image metadata saved', {
      userId: req.user._id || req.user.id,
      fileId: fileId.substring(0, 20), // Truncate for logs
      size: metadata.size
    });

    // Return minimal response
    res.json({
      success: true,
      message: 'Image uploaded successfully',
      image: {
        id: fileId,
        url: metadata.url,
        name: metadata.name
      }
    });

  } catch (error) {
    logger.error('Image metadata save failed', {
      error: error.message,
      userId: req.user?._id || req.user?.id
    });
    res.status(500).json({
      success: false,
      message: 'Failed to save image metadata'
    });
  }
});

// Legacy endpoint for backward compatibility (redirect to new endpoint)
router.get('/imagekit-auth', hybridProtect, (req, res) => {
  logger.warn('Deprecated imagekit-auth endpoint used', {
    userId: req.user._id || req.user.id,
    ip: req.ip
  });
  
  // Redirect to new endpoint
  res.redirect(301, '/api/v1/imagekit/sign');
});

module.exports = router;
