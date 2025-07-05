const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { BadRequest } = require('./error');
const logger = require('./logger');
const mime = require('mime-types');
const sanitize = require('sanitize-filename');

const UPLOADS_DIR = path.join(__dirname, '../uploads');
const TEMP_DIR = path.join(__dirname, '../temp');

// Ensure directories exist
const initDirs = async () => {
  await fs.mkdir(UPLOADS_DIR, { recursive: true, mode: 0o755 });
  await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o755 });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.NODE_ENV === 'production' ? UPLOADS_DIR : TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname).slice(1);
    cb(null, `${uuidv4()}.${ext}`);
  }
});

const fileFilter = (allowedTypes, maxSize) => (req, file, cb) => {
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new BadRequest(`Invalid file type: ${file.mimetype}`));
  }
  if (file.size > maxSize) {
    return cb(new BadRequest(`File exceeds ${maxSize / 1024 / 1024}MB limit`));
  }
  cb(null, true);
};

const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    next(new BadRequest(err.message));
  } else {
    next(err);
  }
};

const cleanupFiles = async (files = []) => {
  await Promise.all(files.map(async (file) => {
    try {
      await fs.unlink(file.path);
    } catch (err) {
      logger.error(`Failed to cleanup ${file.path}: ${err.message}`);
    }
  }));
};

module.exports = {
  initUploads: initDirs,
  imageUpload: multer({
    storage,
    fileFilter: fileFilter(
      ['image/jpeg', 'image/png', 'image/webp'],
      5 * 1024 * 1024 // 5MB
    ),
    limits: { files: 5 }
  }),
  documentUpload: multer({
    storage,
    fileFilter: fileFilter(
      ['application/pdf'],
      10 * 1024 * 1024 // 10MB
    )
  }),
  handleUploadErrors,
  cleanupFiles
};