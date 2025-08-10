const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

class FileUploadService {
  constructor() {
    this.cloudinary = null;
    this.isInitialized = false;
    this.uploadPath = path.join(__dirname, '../uploads');
  }

  async initialize() {
    try {
      // Initialize Cloudinary
      if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET
        });
        this.cloudinary = cloudinary;
        logger.info('✅ Cloudinary service initialized');
      }

      // Create upload directory if it doesn't exist
      try {
        await fs.access(this.uploadPath);
      } catch (error) {
        await fs.mkdir(this.uploadPath, { recursive: true });
      }

      this.isInitialized = true;
      logger.info('✅ File upload service initialized successfully');
    } catch (error) {
      logger.error('❌ File upload service initialization failed:', error.message);
      throw error;
    }
  }

  // Multer Configuration
  getMulterConfig() {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, this.uploadPath);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + extension);
      }
    });

    const fileFilter = (req, file, cb) => {
      const allowedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
        'text/plain'
      ];

      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file type: ${file.mimetype}`), false);
      }
    };

    return multer({
      storage,
      fileFilter,
      limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
        files: 10 // Maximum 10 files
      }
    });
  }

  // Cloudinary Upload Methods
  async uploadToCloudinary(file, options = {}) {
    try {
      if (!this.cloudinary) {
        throw new Error('Cloudinary not configured');
      }

      const {
        folder = 'quicklocal',
        transformation = [],
        public_id = null,
        overwrite = false
      } = options;

      const uploadOptions = {
        folder,
        transformation,
        overwrite,
        resource_type: 'auto'
      };

      if (public_id) {
        uploadOptions.public_id = public_id;
      }

      const result = await this.cloudinary.uploader.upload(file.path, uploadOptions);

      logger.info('✅ File uploaded to Cloudinary', {
        publicId: result.public_id,
        url: result.secure_url,
        size: result.bytes
      });

      return {
        publicId: result.public_id,
        url: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
        size: result.bytes,
        createdAt: result.created_at
      };
    } catch (error) {
      logger.error('❌ Failed to upload to Cloudinary:', error.message);
      throw error;
    }
  }

  async uploadMultipleToCloudinary(files, options = {}) {
    try {
      const uploadPromises = files.map(file => this.uploadToCloudinary(file, options));
      const results = await Promise.all(uploadPromises);

      logger.info('✅ Multiple files uploaded to Cloudinary', {
        count: results.length
      });

      return results;
    } catch (error) {
      logger.error('❌ Failed to upload multiple files to Cloudinary:', error.message);
      throw error;
    }
  }

  async deleteFromCloudinary(publicId) {
    try {
      if (!this.cloudinary) {
        throw new Error('Cloudinary not configured');
      }

      const result = await this.cloudinary.uploader.destroy(publicId);

      logger.info('✅ File deleted from Cloudinary', { publicId });

      return result;
    } catch (error) {
      logger.error('❌ Failed to delete from Cloudinary:', error.message);
      throw error;
    }
  }

  // Local File Management
  async saveFileLocally(file, options = {}) {
    try {
      const {
        subfolder = '',
        filename = null
      } = options;

      const uploadDir = path.join(this.uploadPath, subfolder);
      
      // Create subfolder if it doesn't exist
      try {
        await fs.access(uploadDir);
      } catch {
        await fs.mkdir(uploadDir, { recursive: true });
      }

      const finalFilename = filename || file.filename;
      const filePath = path.join(uploadDir, finalFilename);

      // Move file to final location
      await fs.rename(file.path, filePath);

      logger.info('✅ File saved locally', {
        path: filePath,
        size: file.size
      });

      return {
        path: filePath,
        filename: finalFilename,
        size: file.size,
        mimetype: file.mimetype,
        url: `/uploads/${subfolder}/${finalFilename}`
      };
    } catch (error) {
      logger.error('❌ Failed to save file locally:', error.message);
      throw error;
    }
  }

  async deleteLocalFile(filePath) {
    try {
      await fs.unlink(filePath);
      logger.info('✅ Local file deleted', { path: filePath });
      return true;
    } catch (error) {
      logger.error('❌ Failed to delete local file:', error.message);
      throw error;
    }
  }

  // Image Processing
  async processImage(file, options = {}) {
    try {
      const {
        resize = null,
        quality = 80,
        format = 'auto',
        folder = 'processed'
      } = options;

      const transformation = [];

      if (resize) {
        transformation.push({
          width: resize.width,
          height: resize.height,
          crop: resize.crop || 'fill'
        });
      }

      transformation.push({ quality });

      const result = await this.uploadToCloudinary(file, {
        folder,
        transformation,
        public_id: `${folder}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
      });

      logger.info('✅ Image processed and uploaded', {
        publicId: result.publicId,
        transformation: transformation.length
      });

      return result;
    } catch (error) {
      logger.error('❌ Failed to process image:', error.message);
      throw error;
    }
  }

  // Product Image Upload
  async uploadProductImage(file, productId) {
    try {
      const options = {
        folder: `products/${productId}`,
        transformation: [
          { width: 800, height: 800, crop: 'fill' },
          { quality: 85 }
        ],
        public_id: `product_${productId}_${Date.now()}`
      };

      const result = await this.uploadToCloudinary(file, options);

      logger.info('✅ Product image uploaded', {
        productId,
        publicId: result.publicId
      });

      return result;
    } catch (error) {
      logger.error('❌ Failed to upload product image:', error.message);
      throw error;
    }
  }

  // User Avatar Upload
  async uploadUserAvatar(file, userId) {
    try {
      const options = {
        folder: `avatars/${userId}`,
        transformation: [
          { width: 200, height: 200, crop: 'fill', gravity: 'face' },
          { quality: 90 }
        ],
        public_id: `avatar_${userId}`
      };

      const result = await this.uploadToCloudinary(file, options);

      logger.info('✅ User avatar uploaded', {
        userId,
        publicId: result.publicId
      });

      return result;
    } catch (error) {
      logger.error('❌ Failed to upload user avatar:', error.message);
      throw error;
    }
  }

  // Document Upload
  async uploadDocument(file, documentType, userId) {
    try {
      const options = {
        folder: `documents/${documentType}/${userId}`,
        public_id: `${documentType}_${userId}_${Date.now()}`
      };

      const result = await this.uploadToCloudinary(file, options);

      logger.info('✅ Document uploaded', {
        documentType,
        userId,
        publicId: result.publicId
      });

      return result;
    } catch (error) {
      logger.error('❌ Failed to upload document:', error.message);
      throw error;
    }
  }

  // File Validation
  validateFile(file, allowedTypes = null, maxSize = null) {
    const errors = [];

    // Check file type
    const defaultAllowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf',
      'text/plain'
    ];

    const types = allowedTypes || defaultAllowedTypes;
    if (!types.includes(file.mimetype)) {
      errors.push(`Invalid file type: ${file.mimetype}`);
    }

    // Check file size
    const maxFileSize = maxSize || parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024;
    if (file.size > maxFileSize) {
      errors.push(`File size exceeds limit: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // File Cleanup
  async cleanupTempFiles(files) {
    try {
      const cleanupPromises = files.map(async (file) => {
        try {
          await fs.unlink(file.path);
          logger.debug('🗑️ Temp file cleaned up', { path: file.path });
        } catch (error) {
          logger.warn('⚠️ Failed to cleanup temp file:', error.message);
        }
      });

      await Promise.all(cleanupPromises);
      logger.info('✅ Temp files cleaned up', { count: files.length });
    } catch (error) {
      logger.error('❌ Failed to cleanup temp files:', error.message);
    }
  }

  // Generate File URLs
  generateFileUrl(filePath, baseUrl = process.env.BASE_URL) {
    if (filePath.startsWith('http')) {
      return filePath;
    }
    return `${baseUrl}${filePath}`;
  }

  // File Information
  async getFileInfo(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      
      return {
        path: filePath,
        name: path.basename(filePath),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        extension: ext,
        isImage: ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)
      };
    } catch (error) {
      logger.error('❌ Failed to get file info:', error.message);
      throw error;
    }
  }

  // Batch Operations
  async uploadBatch(files, options = {}) {
    try {
      const {
        folder = 'batch',
        processImages = true,
        cleanup = true
      } = options;

      const results = [];

      for (const file of files) {
        try {
          // Validate file
          const validation = this.validateFile(file);
          if (!validation.isValid) {
            logger.warn('⚠️ File validation failed:', validation.errors);
            continue;
          }

          let result;
          if (processImages && file.mimetype.startsWith('image/')) {
            result = await this.processImage(file, { folder });
          } else {
            result = await this.uploadToCloudinary(file, { folder });
          }

          results.push({
            originalName: file.originalname,
            success: true,
            result
          });
        } catch (error) {
          logger.error('❌ Failed to upload file:', error.message);
          results.push({
            originalName: file.originalname,
            success: false,
            error: error.message
          });
        }
      }

      // Cleanup temp files
      if (cleanup) {
        await this.cleanupTempFiles(files);
      }

      logger.info('✅ Batch upload completed', {
        total: files.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      });

      return results;
    } catch (error) {
      logger.error('❌ Batch upload failed:', error.message);
      throw error;
    }
  }

  // Error Handling
  handleUploadError(error) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return {
        error: 'File too large',
        message: 'The uploaded file exceeds the maximum allowed size'
      };
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return {
        error: 'Too many files',
        message: 'You can only upload a limited number of files at once'
      };
    }

    if (error.message.includes('Invalid file type')) {
      return {
        error: 'Invalid file type',
        message: 'The uploaded file type is not supported'
      };
    }

    return {
      error: 'Upload failed',
      message: 'An error occurred while uploading the file'
    };
  }
}

module.exports = new FileUploadService();
