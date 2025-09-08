// cdn-image-optimization.js - CDN and Image Optimization System
// Comprehensive image processing with WebP conversion, compression, and CDN integration

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class CDNImageOptimizationSystem {
  constructor() {
    this.enabled = process.env.IMAGE_OPTIMIZATION_ENABLED === 'true';
    this.cdnProvider = process.env.CDN_PROVIDER || 'cloudinary'; // cloudinary, aws, azure, etc.
    this.localOptimization = process.env.LOCAL_IMAGE_OPTIMIZATION === 'true';
    this.webpConversion = process.env.ENABLE_WEBP_CONVERSION === 'true';
    this.compressionEnabled = process.env.IMAGE_COMPRESSION_ENABLED === 'true';
    this.cacheEnabled = process.env.IMAGE_CACHE_ENABLED === 'true';
    
    // Image settings
    this.maxImageSize = parseInt(process.env.MAX_IMAGE_SIZE) || 5242880; // 5MB
    this.allowedMimeTypes = process.env.ALLOWED_IMAGE_TYPES?.split(',') || [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif'
    ];
    
    // Cache settings
    this.cacheDir = process.env.IMAGE_CACHE_DIR || './cache/images';
    this.cacheTTL = parseInt(process.env.IMAGE_CACHE_TTL) || 7 * 24 * 60 * 60 * 1000; // 7 days
    
    // CDN clients
    this.cdnClient = null;
    this.imageProcessor = null;
    
    this.initializeProcessor();
  }

  async initializeProcessor() {
    try {
      // Initialize image processing library
      if (this.localOptimization) {
        try {
          this.imageProcessor = require('sharp');
          console.log('✅ Sharp image processor initialized');
        } catch (error) {
          console.warn('⚠️ Sharp not found. Install with: npm install sharp');
          try {
            this.imageProcessor = require('jimp');
            console.log('✅ Jimp image processor initialized (fallback)');
          } catch (jimpError) {
            console.warn('⚠️ Jimp not found. Install with: npm install jimp');
            this.localOptimization = false;
          }
        }
      }

      // Initialize CDN client
      await this.initializeCDN();
      
      // Create cache directory
      if (this.cacheEnabled) {
        await this.ensureCacheDirectory();
      }
      
    } catch (error) {
      console.error('❌ Failed to initialize CDN image optimization system:', error);
    }
  }

  async initializeCDN() {
    if (!this.enabled) return;

    try {
      switch (this.cdnProvider.toLowerCase()) {
        case 'cloudinary':
          await this.initializeCloudinary();
          break;
        case 'aws':
        case 's3':
          await this.initializeAWS();
          break;
        case 'azure':
          await this.initializeAzure();
          break;
        case 'gcp':
        case 'google':
          await this.initializeGCP();
          break;
        default:
          console.warn(`⚠️ Unknown CDN provider: ${this.cdnProvider}`);
      }
    } catch (error) {
      console.error(`❌ Failed to initialize ${this.cdnProvider} CDN:`, error);
      this.enabled = false;
    }
  }

  async initializeCloudinary() {
    try {
      const cloudinary = require('cloudinary').v2;
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
      });
      
      this.cdnClient = cloudinary;
      console.log('✅ Cloudinary CDN initialized');
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.warn('⚠️ Cloudinary package not found. Install with: npm install cloudinary');
      }
      throw error;
    }
  }

  async initializeAWS() {
    try {
      const AWS = require('aws-sdk');
      AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1'
      });
      
      this.cdnClient = new AWS.S3({
        params: { Bucket: process.env.AWS_S3_BUCKET }
      });
      
      console.log('✅ AWS S3 CDN initialized');
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.warn('⚠️ AWS SDK not found. Install with: npm install aws-sdk');
      }
      throw error;
    }
  }

  async initializeAzure() {
    try {
      const { BlobServiceClient } = require('@azure/storage-blob');
      this.cdnClient = BlobServiceClient.fromConnectionString(
        process.env.AZURE_STORAGE_CONNECTION_STRING
      );
      console.log('✅ Azure Blob Storage CDN initialized');
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.warn('⚠️ Azure Storage package not found. Install with: npm install @azure/storage-blob');
      }
      throw error;
    }
  }

  async initializeGCP() {
    try {
      const { Storage } = require('@google-cloud/storage');
      this.cdnClient = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      });
      console.log('✅ Google Cloud Storage CDN initialized');
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.warn('⚠️ Google Cloud Storage package not found. Install with: npm install @google-cloud/storage');
      }
      throw error;
    }
  }

  async ensureCacheDirectory() {
    try {
      await fs.access(this.cacheDir);
    } catch (error) {
      await fs.mkdir(this.cacheDir, { recursive: true });
      console.log(`📁 Created image cache directory: ${this.cacheDir}`);
    }
  }

  // Main image processing function
  async processImage(imageBuffer, options = {}) {
    const processing = {
      width: options.width,
      height: options.height,
      quality: options.quality || 85,
      format: options.format || 'auto',
      webp: options.webp !== false && this.webpConversion,
      compress: options.compress !== false && this.compressionEnabled,
      resize: options.resize !== false,
      crop: options.crop || 'fill',
      gravity: options.gravity || 'center'
    };

    let processedImages = {};

    try {
      // Generate multiple sizes for responsive images
      const sizes = options.sizes || this.getDefaultSizes();
      
      for (const size of sizes) {
        const sizeOptions = {
          ...processing,
          width: size.width,
          height: size.height,
          suffix: size.suffix
        };

        if (this.localOptimization && this.imageProcessor) {
          processedImages[size.suffix] = await this.processImageLocally(imageBuffer, sizeOptions);
        } else {
          processedImages[size.suffix] = {
            buffer: imageBuffer,
            info: { width: size.width, height: size.height }
          };
        }
      }

      return processedImages;
    } catch (error) {
      console.error('❌ Image processing failed:', error);
      throw error;
    }
  }

  async processImageLocally(imageBuffer, options) {
    if (this.imageProcessor.name === 'sharp' || this.imageProcessor.constructor.name === 'Sharp') {
      return await this.processWithSharp(imageBuffer, options);
    } else {
      return await this.processWithJimp(imageBuffer, options);
    }
  }

  async processWithSharp(imageBuffer, options) {
    try {
      let processor = this.imageProcessor(imageBuffer);

      // Resize if dimensions provided
      if (options.width || options.height) {
        processor = processor.resize(options.width, options.height, {
          fit: this.getSharpFit(options.crop),
          position: this.getSharpPosition(options.gravity),
          withoutEnlargement: true
        });
      }

      // Convert format
      const outputFormat = this.determineOutputFormat(options.format, options.webp);
      switch (outputFormat) {
        case 'jpeg':
          processor = processor.jpeg({ quality: options.quality, progressive: true });
          break;
        case 'png':
          processor = processor.png({ compressionLevel: 9, progressive: true });
          break;
        case 'webp':
          processor = processor.webp({ quality: options.quality });
          break;
      }

      const { data, info } = await processor.toBuffer({ resolveWithObject: true });
      
      return {
        buffer: data,
        info: {
          ...info,
          originalSize: imageBuffer.length,
          compressedSize: data.length,
          compressionRatio: ((imageBuffer.length - data.length) / imageBuffer.length * 100).toFixed(2) + '%'
        }
      };
    } catch (error) {
      console.error('❌ Sharp processing failed:', error);
      throw error;
    }
  }

  async processWithJimp(imageBuffer, options) {
    try {
      const image = await this.imageProcessor.read(imageBuffer);
      
      // Resize if dimensions provided
      if (options.width || options.height) {
        image.cover(
          options.width || this.imageProcessor.AUTO,
          options.height || this.imageProcessor.AUTO
        );
      }

      // Apply quality
      image.quality(options.quality);

      // Determine output format
      const outputFormat = this.determineOutputFormat(options.format, options.webp);
      const mimeType = `image/${outputFormat}`;
      
      const buffer = await image.getBufferAsync(mimeType);
      
      return {
        buffer,
        info: {
          width: image.getWidth(),
          height: image.getHeight(),
          format: outputFormat,
          originalSize: imageBuffer.length,
          compressedSize: buffer.length,
          compressionRatio: ((imageBuffer.length - buffer.length) / imageBuffer.length * 100).toFixed(2) + '%'
        }
      };
    } catch (error) {
      console.error('❌ Jimp processing failed:', error);
      throw error;
    }
  }

  getDefaultSizes() {
    return [
      { width: 150, height: 150, suffix: 'thumbnail' },
      { width: 300, height: 300, suffix: 'small' },
      { width: 600, height: 600, suffix: 'medium' },
      { width: 1200, height: 1200, suffix: 'large' },
      { width: 1920, height: 1920, suffix: 'xlarge' }
    ];
  }

  determineOutputFormat(format, webpEnabled) {
    if (format === 'webp' && webpEnabled) return 'webp';
    if (format === 'auto') return webpEnabled ? 'webp' : 'jpeg';
    return format || 'jpeg';
  }

  getSharpFit(crop) {
    const fitMap = {
      'fill': 'cover',
      'fit': 'contain',
      'scale': 'fill',
      'crop': 'cover'
    };
    return fitMap[crop] || 'cover';
  }

  getSharpPosition(gravity) {
    const positionMap = {
      'center': 'center',
      'north': 'top',
      'south': 'bottom',
      'east': 'right',
      'west': 'left',
      'northeast': 'right top',
      'northwest': 'left top',
      'southeast': 'right bottom',
      'southwest': 'left bottom'
    };
    return positionMap[gravity] || 'center';
  }

  // Upload processed images to CDN
  async uploadToCDN(processedImages, originalFilename, options = {}) {
    if (!this.enabled || !this.cdnClient) {
      throw new Error('CDN not initialized');
    }

    const uploadResults = {};
    const baseKey = this.generateImageKey(originalFilename, options);

    try {
      for (const [suffix, imageData] of Object.entries(processedImages)) {
        const key = `${baseKey}_${suffix}`;
        
        switch (this.cdnProvider.toLowerCase()) {
          case 'cloudinary':
            uploadResults[suffix] = await this.uploadToCloudinary(imageData, key, options);
            break;
          case 'aws':
          case 's3':
            uploadResults[suffix] = await this.uploadToS3(imageData, key, options);
            break;
          case 'azure':
            uploadResults[suffix] = await this.uploadToAzure(imageData, key, options);
            break;
          case 'gcp':
          case 'google':
            uploadResults[suffix] = await this.uploadToGCP(imageData, key, options);
            break;
        }
      }

      return uploadResults;
    } catch (error) {
      console.error('❌ CDN upload failed:', error);
      throw error;
    }
  }

  async uploadToCloudinary(imageData, key, options) {
    return new Promise((resolve, reject) => {
      this.cdnClient.uploader.upload_stream(
        {
          public_id: key,
          folder: options.folder || 'quicklocal',
          resource_type: 'image',
          overwrite: true,
          transformation: {
            quality: 'auto',
            fetch_format: 'auto'
          }
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
              format: result.format,
              size: result.bytes
            });
          }
        }
      ).end(imageData.buffer);
    });
  }

  async uploadToS3(imageData, key, options) {
    const params = {
      Key: key,
      Body: imageData.buffer,
      ContentType: `image/${imageData.info.format || 'jpeg'}`,
      CacheControl: options.cacheControl || 'max-age=31536000', // 1 year
      ACL: 'public-read'
    };

    const result = await this.cdnClient.upload(params).promise();
    
    return {
      url: result.Location,
      key: result.Key,
      etag: result.ETag,
      size: imageData.buffer.length
    };
  }

  async uploadToAzure(imageData, key, options) {
    const containerName = process.env.AZURE_CONTAINER_NAME || 'images';
    const containerClient = this.cdnClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(key);

    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: `image/${imageData.info.format || 'jpeg'}`,
        blobCacheControl: options.cacheControl || 'max-age=31536000'
      }
    };

    const result = await blockBlobClient.upload(imageData.buffer, imageData.buffer.length, uploadOptions);
    
    return {
      url: blockBlobClient.url,
      key: key,
      etag: result.etag,
      size: imageData.buffer.length
    };
  }

  async uploadToGCP(imageData, key, options) {
    const bucketName = process.env.GOOGLE_CLOUD_STORAGE_BUCKET;
    const bucket = this.cdnClient.bucket(bucketName);
    const file = bucket.file(key);

    const stream = file.createWriteStream({
      metadata: {
        contentType: `image/${imageData.info.format || 'jpeg'}`,
        cacheControl: options.cacheControl || 'max-age=31536000'
      },
      public: true
    });

    return new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', () => {
        resolve({
          url: `https://storage.googleapis.com/${bucketName}/${key}`,
          key: key,
          size: imageData.buffer.length
        });
      });
      stream.end(imageData.buffer);
    });
  }

  generateImageKey(filename, options = {}) {
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(`${filename}-${timestamp}`).digest('hex').substring(0, 8);
    const prefix = options.prefix || 'img';
    const folder = options.folder || 'products';
    
    return `${folder}/${prefix}_${hash}_${timestamp}`;
  }

  // Cache management
  async cacheImage(key, imageData) {
    if (!this.cacheEnabled) return;

    try {
      const cacheFile = path.join(this.cacheDir, `${key}.cache`);
      const cacheData = {
        data: imageData,
        timestamp: Date.now(),
        ttl: this.cacheTTL
      };
      
      await fs.writeFile(cacheFile, JSON.stringify(cacheData));
    } catch (error) {
      console.error('❌ Failed to cache image:', error);
    }
  }

  async getCachedImage(key) {
    if (!this.cacheEnabled) return null;

    try {
      const cacheFile = path.join(this.cacheDir, `${key}.cache`);
      const cacheContent = await fs.readFile(cacheFile, 'utf8');
      const cacheData = JSON.parse(cacheContent);
      
      if (Date.now() - cacheData.timestamp > cacheData.ttl) {
        await fs.unlink(cacheFile);
        return null;
      }
      
      return cacheData.data;
    } catch (error) {
      return null;
    }
  }

  async clearCache() {
    if (!this.cacheEnabled) return;

    try {
      const files = await fs.readdir(this.cacheDir);
      const deletePromises = files
        .filter(file => file.endsWith('.cache'))
        .map(file => fs.unlink(path.join(this.cacheDir, file)));
      
      await Promise.all(deletePromises);
      console.log(`✅ Cleared ${deletePromises.length} cached images`);
    } catch (error) {
      console.error('❌ Failed to clear image cache:', error);
    }
  }

  // Validation
  validateImage(file) {
    const errors = [];

    if (!file) {
      errors.push('No file provided');
      return { valid: false, errors };
    }

    if (file.size > this.maxImageSize) {
      errors.push(`File size exceeds maximum limit of ${Math.round(this.maxImageSize / 1024 / 1024)}MB`);
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      errors.push(`File type ${file.mimetype} not allowed. Allowed types: ${this.allowedMimeTypes.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Generate responsive image HTML
  generateResponsiveImageHTML(imageUrls, alt = '', className = '') {
    if (!imageUrls || typeof imageUrls !== 'object') {
      return '';
    }

    const sizes = [
      { suffix: 'xlarge', media: '(min-width: 1200px)' },
      { suffix: 'large', media: '(min-width: 992px)' },
      { suffix: 'medium', media: '(min-width: 768px)' },
      { suffix: 'small', media: '(min-width: 576px)' },
      { suffix: 'thumbnail', media: '(max-width: 575px)' }
    ];

    let sources = '';
    let defaultSrc = imageUrls.medium || imageUrls.large || Object.values(imageUrls)[0];

    sizes.forEach(size => {
      if (imageUrls[size.suffix]) {
        sources += `<source media="${size.media}" srcset="${imageUrls[size.suffix]}">\n`;
      }
    });

    return `
<picture class="${className}">
  ${sources}
  <img src="${defaultSrc}" alt="${alt}" loading="lazy" />
</picture>`.trim();
  }

  // Health check
  async healthCheck() {
    const health = {
      status: 'healthy',
      imageOptimization: {
        enabled: this.enabled,
        localProcessing: this.localOptimization,
        processor: this.imageProcessor ? 
          (this.imageProcessor.name || this.imageProcessor.constructor.name) : null,
        webpSupport: this.webpConversion,
        compressionEnabled: this.compressionEnabled
      },
      cdn: {
        provider: this.cdnProvider,
        connected: false
      },
      cache: {
        enabled: this.cacheEnabled,
        directory: this.cacheDir
      }
    };

    // Test CDN connection
    if (this.enabled && this.cdnClient) {
      try {
        switch (this.cdnProvider.toLowerCase()) {
          case 'cloudinary':
            await this.cdnClient.api.ping();
            health.cdn.connected = true;
            break;
          default:
            // For other providers, assume connected if client exists
            health.cdn.connected = true;
        }
      } catch (error) {
        health.cdn.connected = false;
        health.cdn.error = error.message;
      }
    }

    // Check cache directory
    if (this.cacheEnabled) {
      try {
        await fs.access(this.cacheDir);
        const files = await fs.readdir(this.cacheDir);
        health.cache.fileCount = files.filter(f => f.endsWith('.cache')).length;
      } catch (error) {
        health.cache.accessible = false;
        health.cache.error = error.message;
      }
    }

    health.status = health.cdn.connected && 
                   (health.cache.enabled ? health.cache.accessible !== false : true) ? 
                   'healthy' : 'degraded';

    return health;
  }
}

// Express middleware for image processing and upload
const createImageMiddleware = (optimizationSystem) => {
  return {
    // Single image upload middleware
    uploadSingle: (fieldName = 'image', options = {}) => {
      return async (req, res, next) => {
        try {
          const file = req.files?.[fieldName] || req.file;
          
          if (!file) {
            return res.status(400).json({
              success: false,
              error: 'No image file provided',
              field: fieldName
            });
          }

          // Validate image
          const validation = optimizationSystem.validateImage(file);
          if (!validation.valid) {
            return res.status(400).json({
              success: false,
              error: 'Invalid image file',
              validationErrors: validation.errors
            });
          }

          // Process image
          const imageBuffer = file.buffer || await fs.readFile(file.path);
          const processedImages = await optimizationSystem.processImage(imageBuffer, options);

          // Upload to CDN
          let uploadResults = {};
          if (optimizationSystem.enabled) {
            uploadResults = await optimizationSystem.uploadToCDN(
              processedImages, 
              file.originalname || file.name, 
              options
            );
          }

          // Attach results to request
          req.processedImage = {
            original: file,
            processed: processedImages,
            uploaded: uploadResults
          };

          next();
        } catch (error) {
          console.error('❌ Image middleware error:', error);
          res.status(500).json({
            success: false,
            error: 'Image processing failed',
            message: error.message
          });
        }
      };
    },

    // Multiple images upload middleware
    uploadMultiple: (fieldName = 'images', maxCount = 10, options = {}) => {
      return async (req, res, next) => {
        try {
          const files = req.files?.[fieldName] || req.files || [];
          
          if (!Array.isArray(files) || files.length === 0) {
            return res.status(400).json({
              success: false,
              error: 'No image files provided',
              field: fieldName
            });
          }

          if (files.length > maxCount) {
            return res.status(400).json({
              success: false,
              error: `Too many files. Maximum ${maxCount} allowed`,
              provided: files.length
            });
          }

          const results = [];
          
          for (const file of files) {
            // Validate image
            const validation = optimizationSystem.validateImage(file);
            if (!validation.valid) {
              results.push({
                file: file.originalname || file.name,
                success: false,
                error: 'Invalid image file',
                validationErrors: validation.errors
              });
              continue;
            }

            try {
              // Process image
              const imageBuffer = file.buffer || await fs.readFile(file.path);
              const processedImages = await optimizationSystem.processImage(imageBuffer, options);

              // Upload to CDN
              let uploadResults = {};
              if (optimizationSystem.enabled) {
                uploadResults = await optimizationSystem.uploadToCDN(
                  processedImages, 
                  file.originalname || file.name, 
                  options
                );
              }

              results.push({
                file: file.originalname || file.name,
                success: true,
                processed: processedImages,
                uploaded: uploadResults
              });
            } catch (error) {
              results.push({
                file: file.originalname || file.name,
                success: false,
                error: error.message
              });
            }
          }

          req.processedImages = results;
          next();
        } catch (error) {
          console.error('❌ Multiple images middleware error:', error);
          res.status(500).json({
            success: false,
            error: 'Image processing failed',
            message: error.message
          });
        }
      };
    },

    // Image optimization endpoint
    optimize: async (req, res) => {
      try {
        const { url, width, height, quality, format, webp } = req.query;
        
        if (!url) {
          return res.status(400).json({
            success: false,
            error: 'Image URL required'
          });
        }

        // For now, return optimization instructions
        // In production, you'd fetch the image and process it
        res.json({
          success: true,
          message: 'Image optimization endpoint',
          parameters: {
            url,
            width: parseInt(width) || undefined,
            height: parseInt(height) || undefined,
            quality: parseInt(quality) || 85,
            format: format || 'auto',
            webp: webp === 'true'
          },
          note: 'This endpoint would fetch and optimize the provided image URL'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Optimization failed',
          message: error.message
        });
      }
    }
  };
};

// Routes factory
const createImageRoutes = (optimizationSystem) => {
  const router = require('express').Router();
  const middleware = createImageMiddleware(optimizationSystem);

  // Health check
  router.get('/images/health', async (req, res) => {
    try {
      const health = await optimizationSystem.healthCheck();
      res.json({
        success: true,
        ...health
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Health check failed',
        message: error.message
      });
    }
  });

  // Image optimization endpoint
  router.get('/images/optimize', middleware.optimize);

  // Cache management
  router.delete('/images/cache', async (req, res) => {
    try {
      await optimizationSystem.clearCache();
      res.json({
        success: true,
        message: 'Image cache cleared'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to clear cache',
        message: error.message
      });
    }
  });

  return { router, middleware };
};

// Initialize and export
const cdnImageOptimization = new CDNImageOptimizationSystem();

module.exports = {
  CDNImageOptimizationSystem,
  cdnImageOptimization,
  createImageMiddleware,
  createImageRoutes
};
