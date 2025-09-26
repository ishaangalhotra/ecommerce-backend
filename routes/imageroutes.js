// routes/imageRoutes.js
const express = require('express');
const multer = require('multer');
const ImageKit = require('imagekit');
const fs = require('fs');

const router = express.Router();

// Configure ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

// Configure multer
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Test ImageKit connection
router.get('/test-imagekit', (req, res) => {
  res.json({
    success: true,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    message: 'ImageKit configured successfully'
  });
});

// Single image upload
router.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const fileStream = fs.createReadStream(req.file.path);
const uploadResponse = await imagekit.upload({
      file: fileStream,
      fileName: `product-${Date.now()}-${req.file.originalname}`,
      folder: '/quicklocal-products',
      useUniqueFileName: true,
      tags: ['product', 'ecommerce']
    });

    fs.unlinkSync(req.file.path);

    const baseUrl = uploadResponse.url;
    const imageVariants = {
      original: baseUrl,
      large: `${baseUrl}?tr=w-1000,h-1000,c-maintain_ratio,q-80,f-auto`,
      medium: `${baseUrl}?tr=w-600,h-600,c-maintain_ratio,q-80,f-auto`,
      thumbnail: `${baseUrl}?tr=w-300,h-300,c-maintain_ratio,q-70,f-auto`
    };

    res.json({
      success: true,
      image: {
        id: uploadResponse.fileId,
        name: uploadResponse.name,
        url: baseUrl,
        variants: imageVariants
      }
    });

  } catch (error) {
    console.error('ImageKit upload error:', error);
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }
    res.status(500).json({ 
      error: 'Failed to upload image',
      details: error.message 
    });
  }
});

// Multiple images upload
router.post('/upload-multiple-images', upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    const uploadPromises = req.files.map(async (file) => {
      const fileStream = fs.createReadStream(file.path);
const uploadResponse = await imagekit.upload({
        file: fileStream,
        fileName: `product-${Date.now()}-${file.originalname}`,
        folder: '/quicklocal-products',
        useUniqueFileName: true,
        tags: ['product', 'ecommerce']
      });

      fs.unlinkSync(file.path);

      const baseUrl = uploadResponse.url;
      return {
        id: uploadResponse.fileId,
        name: uploadResponse.name,
        url: baseUrl,
        variants: {
          original: baseUrl,
          large: `${baseUrl}?tr=w-1000,h-1000,c-maintain_ratio,q-80,f-auto`,
          medium: `${baseUrl}?tr=w-600,h-600,c-maintain_ratio,q-80,f-auto`,
          thumbnail: `${baseUrl}?tr=w-300,h-300,c-maintain_ratio,q-70,f-auto`
        }
      };
    });

    const uploadedImages = await Promise.all(uploadPromises);

    res.json({
      success: true,
      images: uploadedImages,
      message: `${uploadedImages.length} images uploaded successfully`
    });

  } catch (error) {
    console.error('Multiple upload error:', error);
    
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to upload images',
      details: error.message 
    });
  }
});

module.exports = router;