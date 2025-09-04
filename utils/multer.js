const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Centralized, low-memory upload config
const UPLOAD_DIR = path.join(__dirname, '..', 'tmp', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Use diskStorage to avoid holding entire files in RAM
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = (file.originalname || 'upload').replace(/[^\w.\-]/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});

// Only allow images by default
const fileFilter = (req, file, cb) => {
  if (/^image\//.test(file.mimetype)) return cb(null, true);
  return cb(new Error('Only images allowed'), false);
};

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10                    // cap file count to avoid spikes
  }
});
