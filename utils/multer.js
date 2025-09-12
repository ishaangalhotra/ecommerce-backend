const multer = require('multer');
const fs = require('fs');
const path = require('path');

// DEPRECATION NOTICE: Consider using ImageKit direct upload for better memory efficiency
// This multer config is kept for legacy endpoints but ImageKit is recommended for new implementations
// Use /api/v1/imagekit/sign for direct client uploads to avoid server memory usage

const UPLOAD_DIR = path.join(__dirname, '..', 'tmp', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Log usage warning for monitoring
console.warn('⚠️ MEMORY WARNING: Multer file upload in use. Consider ImageKit direct upload for better memory efficiency.');
console.log('💡 TIP: Use /api/v1/imagekit/sign endpoint for direct uploads that bypass server memory');

// Use diskStorage to avoid holding entire files in RAM
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = (file.originalname || 'upload').replace(/[^\w.\-]/g, '_');
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    cb(null, `${timestamp}-${random}-${safe}`);
  }
});

// Enhanced file filter with better validation
const fileFilter = (req, file, cb) => {
  // Check MIME type
  if (!/^image\/(jpeg|png|gif|webp|bmp|svg\+xml)$/.test(file.mimetype)) {
    return cb(new Error(`File type ${file.mimetype} not allowed. Only image files are permitted.`), false);
  }
  
  // Check file extension
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return cb(new Error(`File extension ${ext} not allowed`), false);
  }
  
  return cb(null, true);
};

// Enhanced multer configuration with better memory management
const multerConfig = {
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,    // Reduced to 5MB per file for better memory management
    files: 8,                     // Reduced concurrent files to prevent memory spikes
    fieldSize: 100 * 1024,        // 100KB per field
    fieldNameSize: 100,           // Field name size limit
    headerPairs: 20               // Limit header pairs
  },
  // Enhanced error handling
  onError: (err, next) => {
    console.error('Multer error:', err.message);
    next(err);
  }
};

// Cleanup utility function
const cleanupTempFiles = (files) => {
  if (!files) return;
  
  const fileArray = Array.isArray(files) ? files : [files];
  fileArray.forEach(file => {
    if (file && file.path) {
      fs.unlink(file.path, (err) => {
        if (err) console.warn(`Failed to cleanup temp file: ${file.path}`, err.message);
      });
    }
  });
};

// Export multer instance with cleanup utility
const multerInstance = multer(multerConfig);
multerInstance.cleanupTempFiles = cleanupTempFiles;

module.exports = multerInstance;
