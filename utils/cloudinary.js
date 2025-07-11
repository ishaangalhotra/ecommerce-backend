const cloudinary = require('cloudinary').v2;
const logger = require('./logger'); // Your logging utility

// Validate required Cloudinary config
const validateConfig = () => {
  const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.error('Missing Cloudinary config:', { missing });
    throw new Error(`Missing Cloudinary config: ${missing.join(', ')}`);
  }
};

// Initialize Cloudinary
try {
  validateConfig();
  
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true // Force HTTPS
  });
  
  logger.info('Cloudinary configured successfully');
} catch (err) {
  logger.error('Cloudinary initialization failed:', err);
  process.exit(1); // Critical failure
}

// Delete image with error handling
exports.deleteImage = async (publicId) => {
  if (!publicId) {
    logger.warn('Attempted to delete image with empty publicId');
    throw new Error('publicId is required');
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true // Optional: CDN cache invalidation
    });
    
    if (result.result !== 'ok') {
      throw new Error(`Cloudinary deletion failed: ${result.result}`);
    }
    
    logger.info(`Image deleted: ${publicId}`);
    return result;
  } catch (err) {
    logger.error('Image deletion failed:', { 
      publicId,
      error: err.message 
    });
    throw err; // Re-throw for controller handling
  }
};

// Upload image with validation
exports.uploadImage = async (filePath, folder = 'products') => {
  if (!filePath) throw new Error('filePath is required');

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: 'auto',
      allowed_formats: ['jpg', 'png', 'webp'],
      quality: 'auto:good'
    });

    logger.info(`Image uploaded to ${result.secure_url}`);
    return {
      url: result.secure_url,
      publicId: result.public_id
    };
  } catch (err) {
    logger.error('Image upload failed:', { 
      filePath, 
      error: err.message 
    });
    throw err;
  }
};

exports.cloudinary = cloudinary;