const multer = require("multer");
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => /^image\//.test(file.mimetype) ? cb(null, true) : cb(new Error("Only images allowed"), false);
module.exports = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
