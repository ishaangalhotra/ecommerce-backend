const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const crypto = require('crypto');
const mime = require('mime-types');
const { ErrorResponse } = require('./errorhandler');
const logger = require('../utils/logger');
const config = require('../config/config');
const stream = require('stream');
const util = require('util');
const pipeline = util.promisify(stream.pipeline);
const { Storage } = require('@google-cloud/storage'); // For cloud storage
const AWS = require('aws-sdk'); // For S3 storage

/**
 * Enhanced error classes for upload handling
 */
class UploadError extends ErrorResponse {
    constructor(message = 'Upload failed', details = null, code = 'UPLOAD_ERROR') {
        super(message, 400, details, code);
        this.name = 'UploadError';
        this.isOperational = true;
    }
}

class FileSizeError extends UploadError {
    constructor(message = 'File size exceeds limit', maxSize = null) {
        super(message, { maxSize }, 'FILE_SIZE_EXCEEDED');
        this.name = 'FileSizeError';
    }
}

class FileTypeError extends UploadError {
    constructor(message = 'Invalid file type', allowedTypes = null) {
        super(message, { allowedTypes }, 'INVALID_FILE_TYPE');
        this.name = 'FileTypeError';
    }
}

class StorageError extends UploadError {
    constructor(message = 'Storage operation failed', details = null) {
        super(message, details, 'STORAGE_ERROR');
        this.name = 'StorageError';
    }
}

class VirusScanError extends UploadError {
    constructor(message = 'File contains malware', details = null) {
        super(message, 422, details, 'VIRUS_DETECTED');
        this.name = 'VirusScanError';
    }
}

/**
 * Upload configuration with comprehensive options
 */
const UPLOAD_CONFIG = {
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB default
    MAX_FILES: 20,
    ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'],
    TEMP_RETENTION: 24 * 60 * 60 * 1000, // 24 hours
    VIRUS_SCAN_ENABLED: process.env.VIRUS_SCAN_ENABLED === 'true',
    IMAGE_OPTIMIZATION: process.env.IMAGE_OPTIMIZATION !== 'false',
    STORAGE_TYPE: process.env.STORAGE_TYPE || 'local', // local, s3, gcs
    MAX_FILENAME_LENGTH: 255,
    CHUNK_SIZE: 5 * 1024 * 1024, // 5MB chunks for large files
    RATE_LIMIT: {
        UPLOADS_PER_HOUR: 100,
        CONCURRENT_UPLOADS: 5
    }
};

// Directory configuration with fallbacks
const DIRECTORIES = {
    uploads: process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'),
    temp: process.env.TEMP_DIR || path.join(process.cwd(), 'temp_uploads'),
    processed: process.env.PROCESSED_DIR || path.join(process.cwd(), 'processed'),
    quarantine: process.env.QUARANTINE_DIR || path.join(process.cwd(), 'quarantine'),
    thumbnails: process.env.THUMBNAIL_DIR || path.join(process.cwd(), 'thumbnails')
};

// Initialize cloud storage clients if configured
const storageClients = {
    s3: process.env.AWS_ACCESS_KEY_ID ? new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION
    }) : null,
    gcs: process.env.GOOGLE_CLOUD_PROJECT ? new Storage({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    }) : null
};

/**
 * Initialize upload system with comprehensive setup
 */
const initializeUploadSystem = async () => {
    const startTime = Date.now();
    const initReport = {
        success: true,
        warnings: [],
        errors: [],
        directories: {},
        storage: {
            type: UPLOAD_CONFIG.STORAGE_TYPE,
            ready: false
        }
    };

    try {
        // Initialize local directories if using local storage
        if (UPLOAD_CONFIG.STORAGE_TYPE === 'local') {
            await initializeLocalDirectories(initReport);
        }

        // Verify cloud storage connectivity if configured
        if (UPLOAD_CONFIG.STORAGE_TYPE === 's3' && storageClients.s3) {
            await verifyS3Connection(initReport);
        } else if (UPLOAD_CONFIG.STORAGE_TYPE === 'gcs' && storageClients.gcs) {
            await verifyGCSConnection(initReport);
        }

        // Schedule cleanup tasks
        scheduleCleanupTasks();

        logger.info('Upload system initialized', {
            duration: `${Date.now() - startTime}ms`,
            ...initReport
        });

        return initReport;
    } catch (error) {
        logger.error('Upload system initialization failed', {
            error: error.message,
            stack: error.stack,
            ...initReport
        });
        throw new StorageError('Upload system initialization failed', initReport);
    }
};

/**
 * Initialize local directories with proper permissions and verification
 */
async function initializeLocalDirectories(initReport) {
    const permissions = process.platform === 'win32' ? undefined : 0o755;
    
    for (const [name, dir] of Object.entries(DIRECTORIES)) {
        try {
            await fs.mkdir(dir, { recursive: true, mode: permissions });
            
            // Verify directory is writable
            const testFile = path.join(dir, `.write-test-${Date.now()}`);
            await fs.writeFile(testFile, 'test');
            await fs.unlink(testFile);
            
            initReport.directories[name] = {
                path: dir,
                status: 'ready',
                permissions: permissions?.toString(8)
            };
        } catch (error) {
            initReport.directories[name] = {
                path: dir,
                status: 'failed',
                error: error.message
            };
            initReport.warnings.push(`Failed to initialize directory: ${name}`);
            logger.warn(`Directory initialization failed: ${name}`, { error: error.message });
        }
    }
}

/**
 * Verify S3 connection and bucket accessibility
 */
async function verifyS3Connection(initReport) {
    try {
        if (!process.env.S3_BUCKET_NAME) {
            throw new Error('S3_BUCKET_NAME environment variable not set');
        }

        await storageClients.s3.headBucket({ Bucket: process.env.S3_BUCKET_NAME }).promise();
        initReport.storage.ready = true;
        initReport.storage.bucket = process.env.S3_BUCKET_NAME;
    } catch (error) {
        initReport.storage.error = error.message;
        initReport.errors.push('S3 connection failed');
        throw error;
    }
}

/**
 * Verify Google Cloud Storage connection and bucket accessibility
 */
async function verifyGCSConnection(initReport) {
    try {
        if (!process.env.GCS_BUCKET_NAME) {
            throw new Error('GCS_BUCKET_NAME environment variable not set');
        }

        const [buckets] = await storageClients.gcs.getBuckets();
        if (!buckets.some(b => b.name === process.env.GCS_BUCKET_NAME)) {
            throw new Error(`Bucket ${process.env.GCS_BUCKET_NAME} not found`);
        }

        initReport.storage.ready = true;
        initReport.storage.bucket = process.env.GCS_BUCKET_NAME;
    } catch (error) {
        initReport.storage.error = error.message;
        initReport.errors.push('GCS connection failed');
        throw error;
    }
}

/**
 * Enhanced storage engine with multi-backend support
 */
class MultiStorageEngine {
    constructor(options = {}) {
        this.options = {
            destination: DIRECTORIES.temp,
            filename: null,
            storageType: UPLOAD_CONFIG.STORAGE_TYPE,
            bucket: process.env[`${UPLOAD_CONFIG.STORAGE_TYPE.toUpperCase()}_BUCKET_NAME`],
            acl: 'private',
            contentType: null,
            ...options
        };
    }

    _handleFile(req, file, cb) {
        const fileId = uuidv4();
        const fileExtension = path.extname(file.originalname) || mime.extension(file.mimetype) || '';
        const filename = this.options.filename 
            ? this.options.filename(req, file) 
            : `${fileId}${fileExtension}`;

        req.uploadContext = req.uploadContext || {};
        req.uploadContext.fileId = fileId;
        req.uploadContext.generatedName = filename;
        req.uploadContext.originalName = file.originalname;

        switch (this.options.storageType) {
            case 's3':
                this._handleS3Upload(req, file, filename, cb);
                break;
            case 'gcs':
                this._handleGCSUpload(req, file, filename, cb);
                break;
            default:
                this._handleLocalUpload(req, file, filename, cb);
        }
    }

    _removeFile(req, file, cb) {
        switch (this.options.storageType) {
            case 's3':
                this._removeS3File(file, cb);
                break;
            case 'gcs':
                this._removeGCSFile(file, cb);
                break;
            default:
                this._removeLocalFile(file, cb);
        }
    }

    async _handleS3Upload(req, file, filename, cb) {
        const params = {
            Bucket: this.options.bucket,
            Key: filename,
            Body: file.stream,
            ACL: this.options.acl,
            ContentType: this.options.contentType || file.mimetype,
            Metadata: {
                originalName: encodeURIComponent(file.originalname),
                uploadId: req.uploadContext.fileId,
                uploader: req.user?.id || 'anonymous'
            }
        };

        try {
            const upload = storageClients.s3.upload(params);
            const result = await upload.promise();

            cb(null, {
                filename,
                path: result.Location,
                size: result.ContentLength,
                etag: result.ETag,
                bucket: result.Bucket,
                key: result.Key,
                storageType: 's3'
            });
        } catch (error) {
            cb(new StorageError('S3 upload failed', { originalError: error.message }));
        }
    }

    async _handleGCSUpload(req, file, filename, cb) {
        const bucket = storageClients.gcs.bucket(this.options.bucket);
        const gcsFile = bucket.file(filename);

        const streamOptions = {
            metadata: {
                contentType: this.options.contentType || file.mimetype,
                metadata: {
                    originalName: encodeURIComponent(file.originalname),
                    uploadId: req.uploadContext.fileId,
                    uploader: req.user?.id || 'anonymous'
                }
            }
        };

        try {
            await pipeline(
                file.stream,
                gcsFile.createWriteStream(streamOptions)
            );

            const [metadata] = await gcsFile.getMetadata();

            cb(null, {
                filename,
                path: `gs://${this.options.bucket}/${filename}`,
                size: parseInt(metadata.size),
                etag: metadata.etag,
                bucket: this.options.bucket,
                key: filename,
                storageType: 'gcs'
            });
        } catch (error) {
            cb(new StorageError('GCS upload failed', { originalError: error.message }));
        }
    }

    async _handleLocalUpload(req, file, filename, cb) {
        const filePath = path.join(this.options.destination, filename);
        
        try {
            await fs.mkdir(this.options.destination, { recursive: true });
            
            const writeStream = fs.createWriteStream(filePath);
            await pipeline(file.stream, writeStream);

            const stats = await fs.stat(filePath);

            cb(null, {
                filename,
                path: filePath,
                size: stats.size,
                storageType: 'local'
            });
        } catch (error) {
            cb(new StorageError('Local upload failed', { 
                originalError: error.message,
                filePath
            }));
        }
    }

    async _removeS3File(file, cb) {
        try {
            await storageClients.s3.deleteObject({
                Bucket: file.bucket,
                Key: file.key
            }).promise();
            cb(null);
        } catch (error) {
            cb(new StorageError('Failed to delete S3 file', { 
                originalError: error.message,
                file
            }));
        }
    }

    async _removeGCSFile(file, cb) {
        try {
            await storageClients.gcs.bucket(file.bucket)
                .file(file.key)
                .delete();
            cb(null);
        } catch (error) {
            cb(new StorageError('Failed to delete GCS file', { 
                originalError: error.message,
                file
            }));
        }
    }

    async _removeLocalFile(file, cb) {
        try {
            await fs.unlink(file.path);
            cb(null);
        } catch (error) {
            if (error.code === 'ENOENT') {
                cb(null); // File doesn't exist, consider it deleted
            } else {
                cb(new StorageError('Failed to delete local file', { 
                    originalError: error.message,
                    file
                }));
            }
        }
    }
}

/**
 * Enhanced file validation with comprehensive checks
 */
class FileValidator {
    constructor(options = {}) {
        this.options = {
            allowedTypes: [],
            allowedExtensions: UPLOAD_CONFIG.ALLOWED_EXTENSIONS,
            maxSize: UPLOAD_CONFIG.MAX_FILE_SIZE,
            maxFiles: UPLOAD_CONFIG.MAX_FILES,
            allowExecutables: false,
            customValidators: [],
            ...options
        };

        this.dangerousExtensions = [
            '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', 
            '.vbs', '.js', '.jar', '.sh', '.php', '.pl'
        ];
    }

    async validate(req, file) {
        const errors = [];
        const context = req.uploadContext || {};

        // Basic validation
        this._validateFileSize(file, errors);
        this._validateFileType(file, errors);
        this._validateFileExtension(file, errors);
        this._validateFilename(file, errors);
        this._validateSecurity(file, errors);

        // Custom validators
        for (const validator of this.options.customValidators) {
            try {
                const result = await validator(req, file);
                if (result !== true) {
                    errors.push(new UploadError(
                        result.message || 'Custom validation failed',
                        result.details
                    ));
                }
            } catch (error) {
                errors.push(new UploadError(
                    'Custom validator error',
                    { originalError: error.message }
                ));
            }
        }

        // Store validation results
        context.validationErrors = [...(context.validationErrors || []), ...errors];

        if (errors.length > 0) {
            throw errors[0]; // Throw first error
        }

        return true;
    }

    _validateFileSize(file, errors) {
        if (file.size > this.options.maxSize) {
            errors.push(new FileSizeError(
                `File size exceeds ${formatBytes(this.options.maxSize)}`,
                this.options.maxSize
            ));
        }
    }

    _validateFileType(file, errors) {
        if (this.options.allowedTypes.length > 0 && 
            !this.options.allowedTypes.includes(file.mimetype)) {
            errors.push(new FileTypeError(
                `File type '${file.mimetype}' not allowed`,
                this.options.allowedTypes
            ));
        }
    }

    _validateFileExtension(file, errors) {
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (this.options.allowedExtensions.length > 0 && 
            !this.options.allowedExtensions.includes(ext)) {
            errors.push(new FileTypeError(
                `File extension '${ext}' not allowed`,
                this.options.allowedExtensions
            ));
        }
    }

    _validateFilename(file, errors) {
        if (!isValidFilename(file.originalname)) {
            errors.push(new UploadError(
                'Invalid characters in filename',
                { filename: file.originalname }
            ));
        }

        if (file.originalname.length > UPLOAD_CONFIG.MAX_FILENAME_LENGTH) {
            errors.push(new UploadError(
                'Filename too long',
                { 
                    maxLength: UPLOAD_CONFIG.MAX_FILENAME_LENGTH,
                    actualLength: file.originalname.length
                }
            ));
        }
    }

    _validateSecurity(file, errors) {
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (!this.options.allowExecutables && 
            this.dangerousExtensions.includes(ext)) {
            errors.push(new FileTypeError(
                `Potentially dangerous file type: ${ext}`,
                { dangerous: true }
            ));
        }

        // Check for double extensions (e.g., "file.pdf.exe")
        const doubleExt = file.originalname.split('.');
        if (doubleExt.length > 2 && 
            this.dangerousExtensions.includes(`.${doubleExt.pop().toLowerCase()}`)) {
            errors.push(new FileTypeError(
                'Suspicious file extension pattern',
                { doubleExtension: true }
            ));
        }
    }
}

/**
 * Enhanced upload middleware factory with comprehensive features
 */
const createUploadMiddleware = (type, options = {}) => {
    const {
        fieldName = 'file',
        maxCount = UPLOAD_CONFIG.MAX_FILES,
        maxSize = UPLOAD_CONFIG.MAX_FILE_SIZE,
        allowedTypes = [],
        allowedExtensions = UPLOAD_CONFIG.ALLOWED_EXTENSIONS,
        destination = DIRECTORIES.temp,
        processImages = UPLOAD_CONFIG.IMAGE_OPTIMIZATION,
        virusScan = UPLOAD_CONFIG.VIRUS_SCAN_ENABLED,
        generateThumbnails = false,
        customValidators = [],
        onUploadStart = null,
        onUploadComplete = null,
        onError = null,
        storageOptions = {},
        ...additionalOptions
    } = options;

    // Initialize validator
    const validator = new FileValidator({
        allowedTypes,
        allowedExtensions,
        maxSize,
        maxFiles: maxCount,
        customValidators
    });

    // Initialize storage
    const storage = new MultiStorageEngine({
        destination,
        storageType: UPLOAD_CONFIG.STORAGE_TYPE,
        ...storageOptions
    });

    // Multer configuration
    const multerConfig = {
        storage,
        limits: {
            fileSize: maxSize,
            files: maxCount,
            fieldNameSize: 100,
            fieldSize: 1024 * 1024, // 1MB for field data
            fields: 10
        },
        fileFilter: async (req, file, cb) => {
            try {
                await validator.validate(req, file);
                cb(null, true);
            } catch (error) {
                cb(error);
            }
        }
    };

    let upload;
    switch (type) {
        case 'single':
            upload = multer(multerConfig).single(fieldName);
            break;
        case 'array':
            upload = multer(multerConfig).array(fieldName, maxCount);
            break;
        case 'fields':
            upload = multer(multerConfig).fields(fieldName); // fieldName should be array for fields
            break;
        default:
            throw new Error(`Unknown upload type: ${type}`);
    }

    // Return enhanced middleware
    return async (req, res, next) => {
        const uploadStart = Date.now();
        req.uploadContext = req.uploadContext || {
            startTime: uploadStart,
            type,
            fieldName,
            options: { maxSize, maxCount, allowedTypes, allowedExtensions }
        };

        try {
            // Execute pre-upload hook
            if (onUploadStart) {
                await onUploadStart(req);
            }

            // Apply multer middleware
            upload(req, res, async (err) => {
                const uploadTime = Date.now() - uploadStart;
                req.uploadContext.uploadTime = uploadTime;

                try {
                    if (err) {
                        await handleUploadError(err, req, onError);
                        return next(err);
                    }

                    // Post-upload processing
                    await postUploadProcessing(req, {
                        processImages,
                        virusScan,
                        generateThumbnails,
                        onUploadComplete
                    });

                    // Finalize upload context
                    req.uploadMetadata = {
                        files: getUploadedFiles(req),
                        uploadTime,
                        processedAt: new Date().toISOString(),
                        storageType: UPLOAD_CONFIG.STORAGE_TYPE
                    };

                    logger.info('Upload completed successfully', {
                        type,
                        fieldName,
                        fileCount: req.uploadMetadata.files.length,
                        totalSize: req.uploadMetadata.files.reduce((sum, f) => sum + (f.size || 0), 0),
                        duration: `${uploadTime}ms`,
                        userId: req.user?.id || 'anonymous'
                    });

                    next();
                } catch (processingError) {
                    await handleProcessingError(processingError, req, onError);
                    next(processingError);
                }
            });
        } catch (error) {
            await handleProcessingError(error, req, onError);
            next(error);
        }
    };
};

/**
 * Comprehensive post-upload processing pipeline
 */
async function postUploadProcessing(req, options) {
    const { processImages, virusScan, generateThumbnails, onUploadComplete } = options;
    const files = getUploadedFiles(req);
    
    if (!files.length) return;

    const processingPromises = files.map(async (file) => {
        try {
            // Virus scanning (if file is local)
            if (virusScan && file.storageType === 'local') {
                const isSafe = await scanForVirus(file.path);
                if (!isSafe) {
                    await quarantineFile(file.path);
                    throw new VirusScanError('File failed virus scan', {
                        filename: file.originalName,
                        quarantined: true
                    });
                }
            }

            // Image processing (if file is local)
            if (processImages && isImageFile(file) && file.storageType === 'local') {
                await processImage(file);
            }

            // Thumbnail generation (if file is local)
            if (generateThumbnails && isImageFile(file) && file.storageType === 'local') {
                await generateThumbnail(file);
            }

            // Generate file metadata
            file.metadata = await generateFileMetadata(file);

        } catch (error) {
            logger.error('File processing failed', {
                error: error.message,
                filename: file.originalName,
                filepath: file.path
            });
            throw error;
        }
    });

    await Promise.all(processingPromises);

    // Execute completion callback
    if (onUploadComplete) {
        await onUploadComplete(req, files);
    }
}

/**
 * Enhanced error handling with comprehensive cleanup
 */
async function handleUploadError(err, req, customErrorHandler) {
    const files = getUploadedFiles(req);
    
    // Cleanup any uploaded files on error
    if (files.length > 0) {
        await cleanupFiles(files);
    }

    let transformedError = err;

    // Transform multer errors
    if (err instanceof multer.MulterError) {
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                transformedError = new FileSizeError(
                    `File size exceeds ${formatBytes(req.uploadContext?.options?.maxSize)}`,
                    req.uploadContext?.options?.maxSize
                );
                break;
            case 'LIMIT_FILE_COUNT':
                transformedError = new UploadError(
                    `Too many files. Maximum allowed: ${req.uploadContext?.options?.maxCount}`,
                    { maxCount: req.uploadContext?.options?.maxCount }
                );
                break;
            case 'LIMIT_UNEXPECTED_FILE':
                transformedError = new UploadError(
                    `Unexpected field: ${err.field}`,
                    { field: err.field, expectedField: req.uploadContext?.fieldName }
                );
                break;
            default:
                transformedError = new UploadError(`Upload failed: ${err.message}`, {
                    code: err.code
                });
        }
    }

    // Execute custom error handler if provided
    if (customErrorHandler) {
        await customErrorHandler(transformedError, req);
    }

    // Log the error
    logger.error('Upload failed', {
        error: transformedError.message,
        stack: transformedError.stack,
        context: req.uploadContext,
        validationErrors: req.uploadContext?.validationErrors
    });

    throw transformedError;
}

async function handleProcessingError(error, req, customErrorHandler) {
    const files = getUploadedFiles(req);
    
    // Cleanup any uploaded files on error
    if (files.length > 0) {
        await cleanupFiles(files);
    }

    // Execute custom error handler if provided
    if (customErrorHandler) {
        await customErrorHandler(error, req);
    }

    // Log the error
    logger.error('Upload processing failed', {
        error: error.message,
        stack: error.stack,
        context: req.uploadContext
    });
}

/**
 * File processing utilities
 */
async function processImage(file) {
    if (!isImageFile(file)) return;

    try {
        const processedPath = path.join(DIRECTORIES.processed, file.filename);
        
        await sharp(file.path)
            .resize(2000, 2000, { 
                fit: 'inside', 
                withoutEnlargement: true 
            })
            .rotate() // Auto-rotate based on EXIF
            .normalize() // Enhance contrast
            .jpeg({ 
                quality: 85, 
                progressive: true, 
                mozjpeg: true 
            })
            .png({ 
                compressionLevel: 9,
                adaptiveFiltering: true 
            })
            .webp({ quality: 85 })
            .toFile(processedPath);

        // Update file metadata
        const originalStats = await fs.stat(file.path);
        const processedStats = await fs.stat(processedPath);
        
        file.path = processedPath;
        file.processed = true;
        file.sizeReduction = originalStats.size - processedStats.size;
        file.optimizationRatio = (file.sizeReduction / originalStats.size * 100).toFixed(2);

        logger.debug('Image processed successfully', {
            originalSize: formatBytes(originalStats.size),
            processedSize: formatBytes(processedStats.size),
            reduction: `${file.optimizationRatio}%`,
            processedPath
        });

        // Remove original file
        await fs.unlink(file.path);
    } catch (error) {
        logger.error('Image processing failed', {
            error: error.message,
            file: file.originalName
        });
        throw new UploadError('Image processing failed', {
            filename: file.originalName
        });
    }
}

async function generateThumbnail(file) {
    if (!isImageFile(file)) return;

    try {
        const thumbnailPath = path.join(DIRECTORIES.thumbnails, `thumb_${file.filename}`);
        
        await sharp(file.path)
            .resize(300, 300, { fit: 'inside' })
            .jpeg({ quality: 70 })
            .toFile(thumbnailPath);

        file.thumbnail = {
            path: thumbnailPath,
            size: (await fs.stat(thumbnailPath)).size
        };

        logger.debug('Thumbnail generated', {
            original: file.originalName,
            thumbnailPath,
            size: formatBytes(file.thumbnail.size)
        });
    } catch (error) {
        logger.error('Thumbnail generation failed', {
            error: error.message,
            file: file.originalName
        });
        // Don't fail the upload if thumbnails fail
    }
}

async function generateFileMetadata(file) {
    try {
        let stats, hash;
        
        if (file.storageType === 'local') {
            stats = await fs.stat(file.path);
            hash = await generateFileHash(file.path);
        }

        return {
            originalName: file.originalName,
            filename: file.filename,
            mimetype: file.mimetype,
            size: file.size || stats?.size,
            hash,
            storageType: file.storageType,
            uploadedAt: new Date().toISOString(),
            lastModified: stats?.mtime.toISOString(),
            isImage: isImageFile(file),
            processed: file.processed || false,
            optimizationRatio: file.optimizationRatio,
            thumbnail: file.thumbnail ? {
                path: file.thumbnail.path,
                size: file.thumbnail.size
            } : null
        };
    } catch (error) {
        logger.warn('Failed to generate file metadata', {
            error: error.message,
            file: file.originalName
        });
        return null;
    }
}

/**
 * Security utilities
 */
async function scanForVirus(filePath) {
    // Implement with actual virus scanning solution
    // This is a placeholder for ClamAV, VirusTotal API, etc.
    logger.debug('Virus scan placeholder', { filePath });
    
    // Simulate scan delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Randomly reject 1% of files for testing
    if (Math.random() < 0.01) {
        logger.warn('VIRUS DETECTED (simulated)', { filePath });
        return false;
    }
    
    return true;
}

async function quarantineFile(filePath) {
    const quarantinePath = path.join(DIRECTORIES.quarantine, path.basename(filePath));
    
    try {
        await fs.rename(filePath, quarantinePath);
        logger.warn('File quarantined', { 
            originalPath: filePath, 
            quarantinePath 
        });
    } catch (error) {
        logger.error('Failed to quarantine file', {
            error: error.message,
            filePath
        });
        throw new StorageError('Quarantine failed', { filePath });
    }
}

/**
 * Scheduled cleanup tasks
 */
function scheduleCleanupTasks() {
    // Cleanup old temp files
    const cleanupInterval = setInterval(async () => {
        try {
            await cleanupOldFiles(DIRECTORIES.temp, UPLOAD_CONFIG.TEMP_RETENTION);
            await cleanupOldFiles(DIRECTORIES.quarantine, UPLOAD_CONFIG.TEMP_RETENTION * 7); // Keep quarantined files longer
        } catch (error) {
            logger.error('Scheduled cleanup failed', { error: error.message });
        }
    }, 60 * 60 * 1000); // Run every hour

    // Cleanup interval on process termination
    process.on('SIGTERM', () => clearInterval(cleanupInterval));
    process.on('SIGINT', () => clearInterval(cleanupInterval));
}

async function cleanupOldFiles(directory, maxAge) {
    try {
        const files = await fs.readdir(directory);
        const cutoffTime = Date.now() - maxAge;
        
        const cleanupPromises = files.map(async (filename) => {
            const filePath = path.join(directory, filename);
            try {
                const stats = await fs.stat(filePath);
                
                if (stats.mtime.getTime() < cutoffTime) {
                    await fs.unlink(filePath);
                    return filename;
                }
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    logger.warn('Failed to cleanup file', {
                        filePath,
                        error: error.message
                    });
                }
            }
            return null;
        });
        
        const cleaned = (await Promise.all(cleanupPromises)).filter(Boolean);
        
        if (cleaned.length > 0) {
            logger.info('Cleaned up old files', {
                directory,
                count: cleaned.length
            });
        }
    } catch (error) {
        if (error.code !== 'ENOENT') { // Ignore if directory doesn't exist
            throw error;
        }
    }
}

/**
 * Utility functions
 */
function getUploadedFiles(req) {
    if (req.file) return [req.file];
    if (req.files) {
        if (Array.isArray(req.files)) return req.files;
        return Object.values(req.files).flat();
    }
    return [];
}

async function cleanupFiles(files = [], options = {}) {
    const { force = false, retries = 3 } = options;
    
    if (!Array.isArray(files)) {
  return;
}

    const results = await Promise.allSettled(
        files.map(async (file) => {
            if (!file) return;
            
            let attempt = 0;
            while (attempt < retries) {
                try {
                    // Different cleanup for different storage types
                    if (file.storageType === 's3') {
                        await storageClients.s3.deleteObject({
                            Bucket: file.bucket,
                            Key: file.key
                        }).promise();
                    } else if (file.storageType === 'gcs') {
                        await storageClients.gcs.bucket(file.bucket)
                            .file(file.key)
                            .delete();
                    } else {
                        await fs.unlink(file.path);
                    }
                    
                    return;
                } catch (error) {
                    attempt++;
                    if (attempt >= retries) {
                        if (force) {
                            logger.warn('Failed to cleanup file after retries', {
                                file: file.filename,
                                error: error.message,
                                attempts: retries
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                    }
                }
            }
        })
    );

    // Log failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
        logger.error('File cleanup failures', {
            count: failures.length,
            errors: failures.map(f => f.reason.message)
        });
    }
}

function isImageFile(file) {
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    return imageTypes.includes(file.mimetype);
}

function isValidFilename(filename) {
    if (!filename || typeof filename !== 'string') return false;
    
    const dangerousPatterns = [
        /\.\./,          // Directory traversal
        /[<>:"|?*]/,     // Invalid characters
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i, // Reserved names (Windows)
        /^\./,           // Hidden files
        /\.$|\.$/,       // Ending with dot
        /[\x00-\x1f\x7f]/ // Control characters
    ];
    
    return !dangerousPatterns.some(pattern => pattern.test(filename));
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function generateFileHash(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    return new Promise((resolve, reject) => {
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Pre-configured upload middlewares for common use cases
 */
const uploaders = {
    // Single image upload with processing
    singleImage: (fieldName = 'image', options = {}) => createUploadMiddleware('single', {
        fieldName,
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        maxSize: 10 * 1024 * 1024, // 10MB
        processImages: true,
        generateThumbnails: true,
        ...options
    }),

    // Multiple image upload
    multipleImages: (fieldName = 'images', maxCount = 10, options = {}) => createUploadMiddleware('array', {
        fieldName,
        maxCount,
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        maxSize: 10 * 1024 * 1024, // 10MB per file
        processImages: true,
        generateThumbnails: true,
        ...options
    }),

    // Document upload with virus scanning
    document: (fieldName = 'document', options = {}) => createUploadMiddleware('single', {
        fieldName,
        allowedTypes: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain'
        ],
        maxSize: 25 * 1024 * 1024, // 25MB
        virusScan: true,
        ...options
    }),

    // Video upload with chunked processing
    video: (fieldName = 'video', options = {}) => createUploadMiddleware('single', {
        fieldName,
        allowedTypes: [
            'video/mp4',
            'video/quicktime',
            'video/x-msvideo',
            'video/x-ms-wmv',
            'video/webm'
        ],
        maxSize: 500 * 1024 * 1024, // 500MB
        storageOptions: {
            partSize: 10 * 1024 * 1024, // 10MB chunks
            queueSize: 4 // Concurrent chunks
        },
        ...options
    }),

    // Generic file upload with security checks
    any: (fieldName = 'file', options = {}) => createUploadMiddleware('single', {
        fieldName,
        maxSize: UPLOAD_CONFIG.MAX_FILE_SIZE,
        virusScan: true,
        ...options
    })
};

module.exports = {
    // Core functionality
    createUploadMiddleware,
    initializeUploadSystem,
    cleanupFiles,
    
    // Pre-configured uploaders
    ...uploaders,
    
    // Error classes
    UploadError,
    FileSizeError,
    FileTypeError,
    StorageError,
    VirusScanError,
    
    // Configuration
    UPLOAD_CONFIG,
    DIRECTORIES,
    
    // Utilities (for testing/extending)
    _utils: {
        isValidFilename,
        isImageFile,
        formatBytes,
        generateFileHash
    }
};