const multer = require('multer');
const path = require('path');
const { BUSINESS_CONFIG } = require('../constants');
const logger = require('../utils/logger');

/**
 * File validation middleware for uploads
 */

// File type configurations
const FILE_TYPES = {
  IMAGES: {
    mimes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    maxFiles: 10
  },
  DOCUMENTS: {
    mimes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    extensions: ['.pdf', '.doc', '.docx'],
    maxSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5
  }
};

/**
 * Create multer configuration for file uploads
 */
const createUploadConfig = (fileType = 'IMAGES', options = {}) => {
  const config = FILE_TYPES[fileType];
  const {
    maxFiles = config.maxFiles,
    maxSize = config.maxSize,
    allowedMimes = config.mimes,
    allowedExtensions = config.extensions
  } = options;

  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxSize,
      files: maxFiles
    },
    fileFilter: (req, file, cb) => {
      try {
        // Check MIME type
        if (!allowedMimes.includes(file.mimetype)) {
          const error = new Error(`Invalid file type. Allowed types: ${allowedMimes.join(', ')}`);
          error.code = 'INVALID_FILE_TYPE';
          return cb(error, false);
        }

        // Check file extension
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
          const error = new Error(`Invalid file extension. Allowed extensions: ${allowedExtensions.join(', ')}`);
          error.code = 'INVALID_FILE_EXTENSION';
          return cb(error, false);
        }

        // Additional security checks
        if (file.originalname.includes('..') || file.originalname.includes('/')) {
          const error = new Error('Invalid file name');
          error.code = 'INVALID_FILE_NAME';
          return cb(error, false);
        }

        cb(null, true);
      } catch (error) {
        logger.error('File validation error', { error: error.message, file: file.originalname });
        cb(error, false);
      }
    }
  });
};

/**
 * Image upload middleware
 */
const uploadImages = (maxFiles = 10) => {
  const upload = createUploadConfig('IMAGES', { maxFiles });
  
  return (req, res, next) => {
    const uploadHandler = upload.array('images', maxFiles);
    
    uploadHandler(req, res, (err) => {
      if (err) {
        logger.warn('Image upload failed', {
          error: err.message,
          code: err.code,
          userId: req.user?.id
        });

        if (err instanceof multer.MulterError) {
          switch (err.code) {
            case 'LIMIT_FILE_SIZE':
              return res.status(400).json({
                success: false,
                message: `File too large. Maximum size: ${FILE_TYPES.IMAGES.maxSize / (1024 * 1024)}MB`,
                code: 'FILE_TOO_LARGE'
              });
            case 'LIMIT_FILE_COUNT':
              return res.status(400).json({
                success: false,
                message: `Too many files. Maximum: ${maxFiles}`,
                code: 'TOO_MANY_FILES'
              });
            case 'LIMIT_UNEXPECTED_FILE':
              return res.status(400).json({
                success: false,
                message: 'Unexpected field name for file upload',
                code: 'UNEXPECTED_FIELD'
              });
            default:
              return res.status(400).json({
                success: false,
                message: 'File upload error',
                code: 'UPLOAD_ERROR'
              });
          }
        }

        // Custom validation errors
        return res.status(400).json({
          success: false,
          message: err.message,
          code: err.code || 'VALIDATION_ERROR'
        });
      }

      next();
    });
  };
};

/**
 * Single image upload middleware
 */
const uploadSingleImage = (fieldName = 'image') => {
  const upload = createUploadConfig('IMAGES', { maxFiles: 1 });
  
  return (req, res, next) => {
    const uploadHandler = upload.single(fieldName);
    
    uploadHandler(req, res, (err) => {
      if (err) {
        logger.warn('Single image upload failed', {
          error: err.message,
          fieldName,
          userId: req.user?.id
        });

        if (err instanceof multer.MulterError) {
          switch (err.code) {
            case 'LIMIT_FILE_SIZE':
              return res.status(400).json({
                success: false,
                message: `File too large. Maximum size: ${FILE_TYPES.IMAGES.maxSize / (1024 * 1024)}MB`
              });
            default:
              return res.status(400).json({
                success: false,
                message: 'File upload error'
              });
          }
        }

        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      next();
    });
  };
};

/**
 * Document upload middleware
 */
const uploadDocuments = (maxFiles = 5) => {
  const upload = createUploadConfig('DOCUMENTS', { maxFiles });
  
  return (req, res, next) => {
    const uploadHandler = upload.array('documents', maxFiles);
    
    uploadHandler(req, res, (err) => {
      if (err) {
        logger.warn('Document upload failed', {
          error: err.message,
          userId: req.user?.id
        });

        if (err instanceof multer.MulterError) {
          switch (err.code) {
            case 'LIMIT_FILE_SIZE':
              return res.status(400).json({
                success: false,
                message: `File too large. Maximum size: ${FILE_TYPES.DOCUMENTS.maxSize / (1024 * 1024)}MB`
              });
            case 'LIMIT_FILE_COUNT':
              return res.status(400).json({
                success: false,
                message: `Too many files. Maximum: ${maxFiles}`
              });
            default:
              return res.status(400).json({
                success: false,
                message: 'File upload error'
              });
          }
        }

        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      next();
    });
  };
};

/**
 * Validate file requirements
 */
const validateFileRequirements = (requirements = {}) => {
  const {
    required = false,
    minFiles = 0,
    maxFiles = 10,
    allowedTypes = FILE_TYPES.IMAGES.mimes
  } = requirements;

  return (req, res, next) => {
    const files = req.files || [];
    
    // Check if files are required
    if (required && files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one file is required',
        code: 'FILES_REQUIRED'
      });
    }

    // Check minimum files
    if (files.length < minFiles) {
      return res.status(400).json({
        success: false,
        message: `Minimum ${minFiles} files required`,
        code: 'INSUFFICIENT_FILES'
      });
    }

    // Check maximum files
    if (files.length > maxFiles) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${maxFiles} files allowed`,
        code: 'TOO_MANY_FILES'
      });
    }

    // Validate each file type
    for (const file of files) {
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: `Invalid file type: ${file.mimetype}. Allowed: ${allowedTypes.join(', ')}`,
          code: 'INVALID_FILE_TYPE'
        });
      }
    }

    next();
  };
};

/**
 * File size validation middleware
 */
const validateFileSize = (maxSizeBytes) => {
  return (req, res, next) => {
    const files = req.files || [];
    
    for (const file of files) {
      if (file.size > maxSizeBytes) {
        return res.status(400).json({
          success: false,
          message: `File "${file.originalname}" is too large. Maximum size: ${Math.round(maxSizeBytes / (1024 * 1024))}MB`,
          code: 'FILE_TOO_LARGE'
        });
      }
    }

    next();
  };
};

/**
 * Generate unique filename
 */
const generateUniqueFilename = (originalName, userId = null) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9]/g, '_');
  
  const userPrefix = userId ? `${userId}_` : '';
  return `${userPrefix}${baseName}_${timestamp}_${random}${ext}`;
};

/**
 * Sanitize filename
 */
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100); // Limit filename length
};

module.exports = {
  uploadImages,
  uploadSingleImage,
  uploadDocuments,
  validateFileRequirements,
  validateFileSize,
  generateUniqueFilename,
  sanitizeFilename,
  FILE_TYPES,
  createUploadConfig
};