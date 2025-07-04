const multer = require('multer');
const path = require('path');
const ErrorResponse = require('../utils/errorResponse');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const filetypes = /jpe?g|png|webp/;
  const mimetype = filetypes.test(file.mimetype);
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new ErrorResponse('Only images (JPEG, PNG, WEBP) are allowed', 400));
};

const limits = {
  fileSize: 5 * 1024 * 1024, // 5MB
  files: 5 // Max 5 files
};

const upload = multer({ 
  storage, 
  fileFilter, 
  limits 
});

// Dynamic field-based upload
exports.uploadImages = (fieldName, maxCount = 1) => 
  upload.array(fieldName, maxCount);

// Single file upload with validation
exports.uploadSingleImage = (fieldName) => 
  upload.single(fieldName);

// PDF upload configuration (for invoices etc.)
exports.uploadPDF = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new ErrorResponse('Only PDF files are allowed', 400));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
}).single('document');