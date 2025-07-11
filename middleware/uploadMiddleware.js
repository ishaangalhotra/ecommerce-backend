const multer = require('multer');
const path = require('path');
const fs = require('fs/promises'); // For async file system operations
const { v4: uuidv4 } = require('uuid'); // For unique filenames
const { ErrorResponse } = require('./error'); // Import custom ErrorResponse
const logger = require('../utils/logger'); // Your logger utility
const mime = require('mime-types'); // To get file extension from mimetype

// Custom error specifically for bad requests (e.g., validation, file uploads)
class BadRequest extends ErrorResponse {
  constructor(message = 'Bad Request', details = null) {
    super(message, 400, details);
  }
}

// Define upload directories
const UPLOADS_DIR = path.join(__dirname, '../uploads'); // Production/final upload directory
const TEMP_DIR = path.join(__dirname, '../temp_uploads'); // Temporary upload directory (can be used for processing before moving)

/**
 * Initializes upload directories if they don't exist.
 * Should be called once during application startup.
 */
const initDirs = async () => {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true, mode: 0o755 });
    await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o755 });
    logger.info(`Upload directories initialized: ${UPLOADS_DIR}, ${TEMP_DIR}`);
  } catch (error) {
    logger.error(`Failed to initialize upload directories: ${error.message}`);
    // Potentially exit the process if directories can't be created, as uploads won't work
    // process.exit(1); 
  }
};

// Multer disk storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Store in temp directory if not in production, otherwise directly to uploads
    cb(null, process.env.NODE_ENV === 'production' ? UPLOADS_DIR : TEMP_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename using UUID and original file extension
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname).slice(1);
    cb(null, `${uuidv4()}.${ext}`);
  }
});

/**
 * Creates a file filter function for Multer.
 * @param {string[]} allowedTypes - Array of allowed MIME types (e.g., ['image/jpeg', 'image/png']).
 * @param {number} maxSize - Maximum allowed file size in bytes.
 * @returns {function} Multer file filter function.
 */
const fileFilter = (allowedTypes, maxSize) => (req, file, cb) => {
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new BadRequest(`Invalid file type: ${file.mimetype}. Allowed types: ${allowedTypes.join(', ')}`));
  }
  if (file.size > maxSize) {
    return cb(new BadRequest(`File exceeds ${maxSize / (1024 * 1024)}MB limit.`));
  }
  cb(null, true);
};

/**
 * Express error handling middleware specifically for Multer errors.
 * Converts MulterError instances into `BadRequest` errors.
 */
const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    next(new BadRequest(`Upload failed: ${err.message}`));
  } else {
    next(err); // Pass other errors to the general error handler
  }
};

/**
 * Cleans up uploaded files. Useful for removing temporary files or after failed operations.
 * @param {object[]|string[]} files - Array of file objects (from Multer) or file paths to delete.
 */
const cleanupFiles = async (files = []) => {
  await Promise.all(files.map(async (file) => {
    const filePath = typeof file === 'string' ? file : file.path;
    try {
      if (filePath) {
        await fs.unlink(filePath);
        logger.info(`Cleaned up file: ${filePath}`);
      }
    } catch (err) {
      // Log but don't throw, as cleanup shouldn't block main process
      if (err.code === 'ENOENT') { // File not found, likely already deleted
        logger.debug(`File not found during cleanup, skipping: ${filePath}`);
      } else {
        logger.error(`Failed to cleanup file ${filePath}: ${err.message}`);
      }
    }
  }));
};

module.exports = {
  // Multer instance for single file uploads (e.g., product image)
  uploadSingle: (fieldName, allowedTypes, maxSize) => multer({
    storage: storage,
    fileFilter: fileFilter(allowedTypes, maxSize),
    limits: { fileSize: maxSize }
  }).single(fieldName),

  // Multer instance for multiple file uploads (e.g., product gallery)
  uploadArray: (fieldName, maxCount, allowedTypes, maxSize) => multer({
    storage: storage,
    fileFilter: fileFilter(allowedTypes, maxSize),
    limits: { fileSize: maxSize }
  }).array(fieldName, maxCount),

  // Multer instance for multiple fields (e.g., different types of files)
  uploadFields: (fieldsArray, allowedTypes, maxSize) => multer({
    storage: storage,
    fileFilter: fileFilter(allowedTypes, maxSize),
    limits: { fileSize: maxSize }
  }).fields(fieldsArray),

  handleUploadErrors,
  initDirs,
  cleanupFiles,
  BadRequest // Export custom error for direct use if needed
};