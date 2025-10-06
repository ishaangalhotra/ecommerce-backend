const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const Product = require('../models/Product');
const Category = require('../models/Category');
const ImageKit = require('imagekit');
const upload = require('../utils/multer'); // centralized diskStorage
const router = express.Router();

// ImageKit configuration
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/phea4zmjs'
});

// ==================== PRODUCT CREATION WITH IMAGE UPLOAD ====================

router.post('/', upload.array('images', 5), async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      discountPercentage = 0,
      category,
      stock,
      unit = 'piece',
      weight,
      brand,
      tags,
      specifications,
      deliveryInfo,
      seller
    } = req.body;

    // Validate required fields
    if (!name || !description || !price || !category || !stock) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, description, price, category, stock',
        requestId: req.requestId
      });
    }

    // 🔥 FIX: Handle category - if it's not a valid ObjectId, try to find by name
    let categoryId = category;
    let categoryDoc; // 🚨 CRITICAL FIX: Define categoryDoc here
    
    if (!mongoose.Types.ObjectId.isValid(category)) {
      console.log('Category is not a valid ObjectId, searching by name:', category);
      
      categoryDoc = await Category.findOne({ 
        name: { $regex: new RegExp(`^${category}$`, 'i') } 
      });
      
      if (!categoryDoc) {
        return res.status(400).json({
          success: false,
          message: `Category "${category}" not found. Available categories must be selected from the dropdown.`
        });
      }
      
      categoryId = categoryDoc._id;
      console.log('Found category by name:', categoryDoc);
    } else {
      // 🚨 CRITICAL FIX: Get category document for later use
      categoryDoc = await Category.findById(categoryId);
      if (!categoryDoc) {
        return res.status(400).json({
          success: false,
          message: 'Category not found'
        });
      }
    }

    let imageUrls = [];

    // Upload images to ImageKit if provided
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} images to ImageKit...`);
      
      const uploadPromises = req.files.map(async (file, index) => {
        try {
          // Generate a unique filename
          const fileName = `products/${Date.now()}_${index}_${name.replace(/[^a-zA-Z0-9]/g, '_')}.${file.mimetype.split('/')[1]}`;
          
          // 🚨 CRITICAL FIX: Use file.buffer fallback for Render compatibility
          const uploadResponse = await imagekit.upload({
            file: file.buffer ? file.buffer.toString('base64') : fs.createReadStream(file.path),  // ✅ FIXED: Works with memory & disk storage
            fileName: fileName,
            folder: '/products/',
            useUniqueFileName: true,
            tags: ['product', brand || 'unknown', categoryDoc.name.toLowerCase()].filter(Boolean) // ✅ FIXED: categoryDoc now defined
          });

          // Delete temp file after successful upload (if using disk storage)
          if (!file.buffer && file.path) {
            try { await fs.promises.unlink(file.path); } catch (e) {}
          }

          return {
            url: uploadResponse.url,
            alt: `${name} - Image ${index + 1}`,
            imagekitFileId: uploadResponse.fileId,
            thumbnail: uploadResponse.thumbnailUrl
          };
        } catch (uploadError) {
          console.error(`Failed to upload image ${index}:`, uploadError);
          // Clean up temp file on error too (if using disk storage)
          if (!file.buffer && file.path) {
            try { await fs.promises.unlink(file.path); } catch (e) {}
          }
          throw new Error(`Image upload failed: ${uploadError.message}`);
        }
      });

      try {
        imageUrls = await Promise.all(uploadPromises);
        console.log(`✅ Successfully uploaded ${imageUrls.length} images to ImageKit`);
      } catch (uploadError) {
        // Clean up any remaining temp files (if using disk storage)
        if (req.files) {
          req.files.forEach(async (file) => {
            if (!file.buffer && file.path) {
              try { await fs.promises.unlink(file.path); } catch (e) {}
            }
          });
        }
        return res.status(400).json({
          success: false,
          message: 'Image upload failed',
          error: uploadError.message,
          requestId: req.requestId
        });
      }
    }

    // Parse tags if string
    let parsedTags = [];
    if (tags) {
      parsedTags = typeof tags === 'string' ? tags.split(',').map(tag => tag.trim()) : tags;
    }

    // Parse specifications if string
    let parsedSpecs = new Map();
    if (specifications) {
      if (typeof specifications === 'string') {
        try {
          const specsObj = JSON.parse(specifications);
          parsedSpecs = new Map(Object.entries(specsObj));
        } catch (e) {
          console.warn('Failed to parse specifications:', e);
        }
      } else if (typeof specifications === 'object') {
        parsedSpecs = new Map(Object.entries(specifications));
      }
    }

    // Create product - USE THE VALIDATED CATEGORY ID
    const productData = {
      name: name.trim(),
      description: description.trim(),
      price: parseFloat(price),
      discountPercentage: parseFloat(discountPercentage) || 0,
      images: imageUrls,
      category: categoryId, // 🔥 USE THE VALIDATED CATEGORY ID
      seller: seller || new mongoose.Types.ObjectId(), // Use provided seller or generate one
      stock: parseInt(stock),
      unit: unit,
      weight: weight ? parseFloat(weight) : undefined,
      brand: brand?.trim(),
      tags: parsedTags,
      specifications: parsedSpecs,
      deliveryInfo: deliveryInfo ? JSON.parse(deliveryInfo) : undefined,
      status: 'active',
      averageRating: 0,
      totalReviews: 0,
      views: 0,
      totalSales: 0
    };

    const product = new Product(productData);
    await product.save();

    // Populate the response
    await product.populate([
      { path: 'category', select: 'name slug description' },
      { path: 'seller', select: 'name rating verified' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Product created successfully with images!',
      data: {
        product: {
          id: product._id,
          name: product.name,
          description: product.description,
          price: product.price,
          finalPrice: product.discountPercentage > 0 
            ? product.price - (product.price * product.discountPercentage / 100)
            : product.price,
          discountPercentage: product.discountPercentage,
          images: product.images,
          category: product.category,
          seller: product.seller,
          stock: product.stock,
          brand: product.brand,
          slug: product.slug,
          status: product.status,
          createdAt: product.createdAt
        },
        imagesUploaded: imageUrls.length,
        imagekitUrls: imageUrls.map(img => img.url)
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Create product error:', error);
    // Clean up any remaining temp files on error (if using disk storage)
    if (req.files) {
      req.files.forEach(async (file) => {
        if (!file.buffer && file.path) {
          try { await fs.promises.unlink(file.path); } catch (e) {}
        }
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error creating product',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== UPDATE PRODUCT WITH IMAGE SUPPORT ====================

router.put('/:productId', upload.array('newImages', 5), async (req, res) => {
  try {
    const { productId } = req.params;
    const updateData = { ...req.body };

    // Find existing product
    const existingProduct = await Product.findById(productId);
    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        requestId: req.requestId
      });
    }

    // Handle new image uploads
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} new images for product update...`);
      
      const uploadPromises = req.files.map(async (file, index) => {
        try {
          const fileName = `products/${Date.now()}_${index}_${existingProduct.name.replace(/[^a-zA-Z0-9]/g, '_')}.${file.mimetype.split('/')[1]}`;
          
          // 🚨 CRITICAL FIX: Use file.buffer fallback for Render compatibility
          const uploadResponse = await imagekit.upload({
            file: file.buffer ? file.buffer.toString('base64') : fs.createReadStream(file.path),  // ✅ FIXED: Works with memory & disk storage
            fileName: fileName,
            folder: '/products/',
            useUniqueFileName: true,
            tags: ['product', existingProduct.brand || 'unknown', 'updated'].filter(Boolean)
          });

          // Delete temp file after successful upload (if using disk storage)
          if (!file.buffer && file.path) {
            try { await fs.promises.unlink(file.path); } catch (e) {}
          }

          return {
            url: uploadResponse.url,
            alt: `${existingProduct.name} - Updated Image ${index + 1}`,
            imagekitFileId: uploadResponse.fileId,
            thumbnail: uploadResponse.thumbnailUrl
          };
        } catch (uploadError) {
          console.error(`Failed to upload image ${index}:`, uploadError);
          // Clean up temp file on error too (if using disk storage)
          if (!file.buffer && file.path) {
            try { await fs.promises.unlink(file.path); } catch (e) {}
          }
          throw uploadError;
        }
      });

      try {
        const newImageUrls = await Promise.all(uploadPromises);
        
        // Combine existing images with new ones (or replace based on your logic)
        updateData.images = [...(existingProduct.images || []), ...newImageUrls];
        console.log(`✅ Successfully uploaded ${newImageUrls.length} new images`);
      } catch (uploadError) {
        // Clean up any remaining temp files (if using disk storage)
        if (req.files) {
          req.files.forEach(async (file) => {
            if (!file.buffer && file.path) {
              try { await fs.promises.unlink(file.path); } catch (e) {}
            }
          });
        }
        return res.status(400).json({
          success: false,
          message: 'Image upload failed',
          error: uploadError.message,
          requestId: req.requestId
        });
      }
    }

    // Parse tags if provided
    if (updateData.tags && typeof updateData.tags === 'string') {
      updateData.tags = updateData.tags.split(',').map(tag => tag.trim());
    }

    // Parse specifications if provided
    if (updateData.specifications) {
      if (typeof updateData.specifications === 'string') {
        try {
          const specsObj = JSON.parse(updateData.specifications);
          updateData.specifications = new Map(Object.entries(specsObj));
        } catch (e) {
          delete updateData.specifications;
        }
      } else if (typeof updateData.specifications === 'object') {
        updateData.specifications = new Map(Object.entries(updateData.specifications));
      }
    }

    // Update the product
    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).populate([
      { path: 'category', select: 'name slug description' },
      { path: 'seller', select: 'name rating verified' }
    ]);

    res.json({
      success: true,
      message: 'Product updated successfully!',
      data: {
        product: {
          id: updatedProduct._id,
          name: updatedProduct.name,
          description: updatedProduct.description,
          price: updatedProduct.price,
          finalPrice: updatedProduct.discountPercentage > 0 
            ? updatedProduct.price - (updatedProduct.price * updatedProduct.discountPercentage / 100)
            : updatedProduct.price,
          discountPercentage: updatedProduct.discountPercentage,
          images: updatedProduct.images,
          category: updatedProduct.category,
          seller: updatedProduct.seller,
          stock: updatedProduct.stock,
          brand: updatedProduct.brand,
          slug: updatedProduct.slug,
          status: updatedProduct.status,
          updatedAt: updatedProduct.updatedAt
        },
        newImagesAdded: req.files ? req.files.length : 0
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Update product error:', error);
    // Clean up any remaining temp files on error (if using disk storage)
    if (req.files) {
      req.files.forEach(async (file) => {
        if (!file.buffer && file.path) {
          try { await fs.promises.unlink(file.path); } catch (e) {}
        }
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== DELETE PRODUCT IMAGE ====================

router.delete('/:productId/images/:imageIndex', async (req, res) => {
  try {
    const { productId, imageIndex } = req.params;
    const index = parseInt(imageIndex);

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        requestId: req.requestId
      });
    }

    if (index < 0 || index >= product.images.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image index',
        requestId: req.requestId
      });
    }

    const imageToDelete = product.images[index];
    
    // Delete from ImageKit if it has imagekitFileId
    if (imageToDelete.imagekitFileId) {
      try {
        await imagekit.deleteFile(imageToDelete.imagekitFileId);
        console.log(`🗑️ Deleted image from ImageKit: ${imageToDelete.imagekitFileId}`);
      } catch (deleteError) {
        console.warn('Failed to delete image from ImageKit:', deleteError);
        // Continue anyway - we'll remove it from the database
      }
    }

    // Remove image from product
    product.images.splice(index, 1);
    await product.save();

    res.json({
      success: true,
      message: 'Image deleted successfully',
      data: {
        productId: product._id,
        remainingImages: product.images.length,
        deletedImage: imageToDelete.url
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Delete product image error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting product image',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== CREATE SAMPLE DATA WITH IMAGEKIT URLS ====================

router.post('/create-sample-data-with-imagekit', async (req, res) => {
  try {
    const existingProducts = await Product.countDocuments();
    if (existingProducts > 5) {
      return res.json({
        success: true,
        message: 'Sample data already exists',
        count: existingProducts
      });
    }

    const categories = await Category.insertMany([
      { name: 'Electronics', description: 'Electronic devices and gadgets' },
      { name: 'Clothing', description: 'Fashion and apparel' },
      { name: 'Home & Garden', description: 'Home and garden essentials' },
      { name: 'Sports & Fitness', description: 'Sports equipment and fitness gear' }
    ]);

    const sampleSellerId = new mongoose.Types.ObjectId();

    // Sample products with realistic ImageKit URLs
    const sampleProducts = [
      {
        name: 'iPhone 15 Pro Max',
        description: 'Latest iPhone with A17 Pro chip, titanium design, and advanced camera system',
        price: 134900,
        discountPercentage: 5,
        images: [
          { 
            url: 'https://ik.imagekit.io/phea4zmjs/products/iphone-15-pro-max-front.jpg',
            alt: 'iPhone 15 Pro Max front view',
            thumbnail: 'https://ik.imagekit.io/phea4zmjs/products/iphone-15-pro-max-front.jpg?tr=w-300,h-300'
          },
          { 
            url: 'https://ik.imagekit.io/phea4zmjs/products/iphone-15-pro-max-back.jpg',
            alt: 'iPhone 15 Pro Max back view',
            thumbnail: 'https://ik.imagekit.io/phea4zmjs/products/iphone-15-pro-max-back.jpg?tr=w-300,h-300'
          }
        ],
        category: categories[0]._id,
        seller: sampleSellerId,
        stock: 25,
        unit: 'piece',
        weight: 0.221,
        brand: 'Apple',
        tags: ['smartphone', 'iphone', 'apple', 'premium', '5g', 'camera'],
        status: 'active',
        averageRating: 4.8,
        totalReviews: 342,
        specifications: new Map([
          ['Display', '6.7-inch Super Retina XDR'],
          ['Chip', 'A17 Pro'],
          ['Storage', '256GB'],
          ['Camera', '48MP Main + 12MP Ultra Wide + 12MP Telephoto'],
          ['Battery', 'Up to 29 hours video playback'],
          ['Material', 'Titanium'],
          ['5G', 'Yes'],
          ['Water Resistance', 'IP68']
        ]),
        deliveryInfo: {
          preparationTime: 1,
          deliveryTime: 2,
          freeDelivery: true,
          returnPolicy: 14
        }
      },
      {
        name: 'Samsung Galaxy S24 Ultra',
        description: 'Premium Android flagship with S Pen, AI features, and pro-grade camera',
        price: 129999,
        discountPercentage: 8,
        images: [
          { 
            url: 'https://ik.imagekit.io/phea4zmjs/products/galaxy-s24-ultra.jpg',
            alt: 'Samsung Galaxy S24 Ultra',
            thumbnail: 'https://ik.imagekit.io/phea4zmjs/products/galaxy-s24-ultra.jpg?tr=w-300,h-300'
          }
        ],
        category: categories[0]._id,
        seller: sampleSellerId,
        stock: 30,
        unit: 'piece',
        weight: 0.232,
        brand: 'Samsung',
        tags: ['smartphone', 'android', 'samsung', 'spen', 'ai', 'camera'],
        status: 'active',
        averageRating: 4.6,
        totalReviews: 189,
        specifications: new Map([
          ['Display', '6.8-inch Dynamic AMOLED 2X'],
          ['Processor', 'Snapdragon 8 Gen 3'],
          ['RAM', '12GB'],
          ['Storage', '256GB'],
          ['Camera', '200MP Main + 50MP Periscope + 50MP Telephoto + 12MP Ultra Wide'],
          ['S Pen', 'Included'],
          ['Battery', '5000mAh']
        ])
      },
      {
        name: 'Nike Air Jordan 1 High',
        description: 'Classic basketball sneakers with premium leather and iconic design',
        price: 12995,
        discountPercentage: 15,
        images: [
          { 
            url: 'https://ik.imagekit.io/phea4zmjs/products/jordan-1-high.jpg',
            alt: 'Nike Air Jordan 1 High',
            thumbnail: 'https://ik.imagekit.io/phea4zmjs/products/jordan-1-high.jpg?tr=w-300,h-300'
          }
        ],
        category: categories[1]._id,
        seller: sampleSellerId,
        stock: 50,
        unit: 'pair',
        weight: 0.8,
        brand: 'Nike',
        tags: ['sneakers', 'jordan', 'nike', 'basketball', 'fashion', 'streetwear'],
        status: 'active',
        averageRating: 4.7,
        totalReviews: 523,
        specifications: new Map([
          ['Material', 'Premium Leather'],
          ['Sole', 'Rubber'],
          ['Style', 'High Top'],
          ['Closure', 'Lace-up'],
          ['Color', 'Black/Red/White']
        ])
      },
      {
        name: 'MacBook Air M2',
        description: 'Ultra-thin laptop with M2 chip, all-day battery, and stunning Retina display',
        price: 114900,
        discountPercentage: 3,
        images: [
          { 
            url: 'https://ik.imagekit.io/phea4zmjs/products/macbook-air-m2.jpg',
            alt: 'MacBook Air M2',
            thumbnail: 'https://ik.imagekit.io/phea4zmjs/products/macbook-air-m2.jpg?tr=w-300,h-300'
          }
        ],
        category: categories[0]._id,
        seller: sampleSellerId,
        stock: 15,
        unit: 'piece',
        weight: 1.24,
        brand: 'Apple',
        tags: ['laptop', 'macbook', 'apple', 'm2', 'ultrabook', 'professional'],
        status: 'active',
        averageRating: 4.9,
        totalReviews: 167,
        specifications: new Map([
          ['Chip', 'Apple M2'],
          ['Display', '13.6-inch Liquid Retina'],
          ['Memory', '8GB Unified Memory'],
          ['Storage', '256GB SSD'],
          ['Battery', 'Up to 18 hours'],
          ['Weight', '1.24 kg'],
          ['Thickness', '11.3 mm']
        ])
      }
    ];

    const products = await Product.insertMany(sampleProducts);

    res.status(201).json({
      success: true,
      message: 'Enhanced sample data created with ImageKit URLs!',
      data: {
        categoriesCreated: categories.length,
        productsCreated: products.length,
        categories: categories.map(c => ({ 
          id: c._id, 
          name: c.name, 
          slug: c.slug 
        })),
        products: products.map(p => ({
          id: p._id,
          name: p.name,
          price: p.price,
          images: p.images.map(img => img.url),
          slug: p.slug
        })),
        note: 'All products now use ImageKit URLs for optimized image delivery!',
        imagekitEndpoint: 'https://ik.imagekit.io/phea4zmjs',
        nextSteps: [
          'Try GET /api/products to see the products',
          'Use POST /api/products with image upload to create new products',
          'Upload real images and they will be stored in ImageKit automatically'
        ]
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Create enhanced sample data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating enhanced sample data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// ==================== KEEP YOUR EXISTING ROUTES ====================
// (Add all your existing GET routes here - I'll keep them as they are good)

// GET all products route (keep your existing implementation)
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      search,
      minPrice,
      maxPrice,
      sort = 'newest',
      inStock
    } = req.query;

    // Build query filters
    const filters = { status: 'active' };
    
    if (category) {
      if (mongoose.isValidObjectId(category)) {
        filters.category = category;
      } else {
        const categoryDoc = await Category.findOne({ slug: category });
        if (categoryDoc) {
          filters.category = categoryDoc._id;
        }
      }
    }
    
    if (minPrice || maxPrice) {
      filters.price = {};
      if (minPrice) filters.price.$gte = parseFloat(minPrice);
      if (maxPrice) filters.price.$lte = parseFloat(maxPrice);
    }
    
    if (inStock === 'true') {
      filters.stock = { $gt: 0 };
    }

    // Build sort query
    let sortQuery = {};
    switch (sort) {
      case 'price_low': sortQuery = { price: 1 }; break;
      case 'price_high': sortQuery = { price: -1 }; break;
      case 'rating': sortQuery = { averageRating: -1 }; break;
      case 'popular': sortQuery = { totalSales: -1 }; break;
      case 'newest':
      default: sortQuery = { createdAt: -1 }; break;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let productsQuery;
    if (search) {
      productsQuery = Product.searchProducts(search, filters);
    } else {
      productsQuery = Product.find(filters);
    }

    const [products, totalProducts] = await Promise.all([
      productsQuery
        .populate('category', 'name slug')
        .populate('seller', 'name rating verified')
        .sort(sortQuery)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Product.countDocuments(search ? { ...filters, $text: { $search: search } } : filters)
    ]);

    const totalPages = Math.ceil(totalProducts / parseInt(limit));

    res.json({
      success: true,
      message: 'Products retrieved successfully',
      data: {
        products: products.map(product => ({
          // Essential fields for product list/cards (memory optimized)
          id: product._id,
          name: product.name,
          shortDescription: product.shortDescription,
          price: product.price,
          finalPrice: product.discountPercentage > 0 
            ? Math.round((product.price * (1 - product.discountPercentage / 100)) * 100) / 100
            : product.price,
          discountPercentage: product.discountPercentage,
          isOnSale: product.discountPercentage > 0,
          image: product.images && product.images.length > 0 ? product.images[0].url : null,
          images: product.images || [],
          stockStatus: product.stockStatus,
          isInStock: product.stock > 0,
          averageRating: product.averageRating,
          totalReviews: product.totalReviews,
          category: product.category,
          seller: product.seller,
          slug: product.slug,
          brand: product.brand,
          
          // Key features for display (minimal)
          isFeatured: product.isFeatured,
          isNewArrival: product.isNewArrival,
          isBestSeller: product.isBestSeller,
          
          // Essential delivery info
          deliveryTime: product.deliveryConfig?.preparationTime || 10,
          deliveryFee: product.deliveryConfig?.deliveryFee || 0,
          
          // Location (minimal)
          city: product.sellerLocation?.city,
          
          createdAt: product.createdAt
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalProducts,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1,
          limit: parseInt(limit)
        }
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving products',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId: req.requestId
    });
  }
});

// Keep all your other existing GET routes (search, category, individual product, etc.)
// ... (add your existing routes here)

// Enhanced product search route
router.get('/search', async (req, res) => {
  try {
    const { 
      q, 
      category, 
      priceRange, 
      availability, 
      page = 1, 
      limit = 20,
      sortBy = 'relevance'
    } = req.query;

    let query = { status: 'active' };
    
    // Text search
    if (q && q.trim()) {
      query.$or = [
        { name: { $regex: q.trim(), $options: 'i' } },
        { description: { $regex: q.trim(), $options: 'i' } },
        { brand: { $regex: q.trim(), $options: 'i' } },
        { tags: { $in: [new RegExp(q.trim(), 'i')] } }
      ];
    }

    // Category filter
    if (category && category !== '') {
      const categoryDoc = await Category.findOne({ 
        $or: [
          { name: new RegExp(category, 'i') },
          { slug: category.toLowerCase() }
        ]
      });
      if (categoryDoc) {
        query.category = categoryDoc._id;
      }
    }

    // Price range filter
    if (priceRange && priceRange !== '') {
      if (priceRange === '500+') {
        query.price = { $gte: 500 };
      } else if (priceRange.includes('-')) {
        const [min, max] = priceRange.split('-').map(Number);
        query.price = { $gte: min, $lte: max };
      }
    }

    // Availability filter
    if (availability && availability !== '') {
      if (availability === 'instock') {
        query.stock = { $gt: 0 };
      } else if (availability === 'fastdelivery') {
        query.fastDelivery = true;
      }
    }

    // Sorting
    let sortOptions = {};
    switch (sortBy) {
      case 'price-low':
        sortOptions.price = 1;
        break;
      case 'price-high':
        sortOptions.price = -1;
        break;
      case 'newest':
        sortOptions.createdAt = -1;
        break;
      case 'rating':
        sortOptions.averageRating = -1;
        break;
      case 'name':
        sortOptions.name = 1;
        break;
      default:
        sortOptions.createdAt = -1;
    }

    // Execute search with pagination
    const skip = (page - 1) * limit;
    
    const products = await Product.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('category', 'name slug')
      .populate('seller', 'name storeName rating')
      .lean();

    // Get total count for pagination
    const totalProducts = await Product.countDocuments(query);

    res.json({
      success: true,
      products,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalProducts / limit),
        totalProducts,
        hasNext: skip + products.length < totalProducts,
        hasPrev: page > 1
      },
      searchQuery: q,
      appliedFilters: {
        category,
        priceRange,
        availability,
        sortBy
      }
    });

  } catch (error) {
    console.error('Product search error:', error);
    res.status(500).json({
      success: false,
      message: 'Product search failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Search error'
    });
  }
});

// Quick search suggestions route (for autocomplete)
router.get('/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        suggestions: []
      });
    }

    const suggestions = await Product.aggregate([
      {
        $match: {
          status: 'active',
          $or: [
            { name: { $regex: q.trim(), $options: 'i' } },
            { brand: { $regex: q.trim(), $options: 'i' } },
            { tags: { $in: [new RegExp(q.trim(), 'i')] } }
          ]
        }
      },
      {
        $project: {
          name: 1,
          images: { $arrayElemAt: ['$images', 0] },
          price: 1,
          brand: 1
        }
      },
      { $limit: 8 }
    ]);

    res.json({
      success: true,
      suggestions
    });

  } catch (error) {
    console.error('Search suggestions error:', error);
    res.json({
      success: true,
      suggestions: []
    });
  }
});

module.exports = router;