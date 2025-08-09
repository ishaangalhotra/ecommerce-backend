// routes/advanced-products.js - Advanced Product Management Routes

const express = require('express');
const router = express.Router();
const ProductAdvanced = require('../models/ProductAdvanced');
const searchService = require('../services/searchService');
const recommendationEngine = require('../services/recommendationEngine');
const { auth, authorize } = require('../middleware/auth');
const { validateProduct } = require('../validations/productvalidation');

/**
 * @route   GET /api/products/search
 * @desc    Advanced product search with AI features
 * @access  Public
 */
router.get('/search', async (req, res) => {
  try {
    const {
      q: query,
      page = 1,
      limit = 20,
      sort = 'relevance',
      category,
      brand,
      minPrice,
      maxPrice,
      rating,
      inStock,
      freeShipping,
      location
    } = req.query;

    const filters = {
      ...(category && { category }),
      ...(brand && { brand }),
      ...(minPrice && { minPrice: parseFloat(minPrice) }),
      ...(maxPrice && { maxPrice: parseFloat(maxPrice) }),
      ...(rating && { minRating: parseFloat(rating) }),
      ...(inStock === 'true' && { inStock: true }),
      ...(freeShipping === 'true' && { freeShipping: true }),
      ...(location && { location: JSON.parse(location) })
    };

    const results = await searchService.searchProducts(query, {
      page: parseInt(page),
      limit: parseInt(limit),
      sort,
      filters,
      userId: req.user?.id
    });

    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/products/autocomplete
 * @desc    Search autocomplete suggestions
 * @access  Public
 */
router.get('/autocomplete', async (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query;
    
    if (!query || query.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const suggestions = await searchService.getAutoComplete(query, parseInt(limit));

    res.json({
      success: true,
      data: suggestions
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Autocomplete failed',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/products/trending
 * @desc    Get trending products
 * @access  Public
 */
router.get('/trending', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const trending = await recommendationEngine.getTrendingProducts(parseInt(limit));

    res.json({
      success: true,
      data: trending
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get trending products',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/products/featured
 * @desc    Get featured products
 * @access  Public
 */
router.get('/featured', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const featured = await ProductAdvanced.findFeatured(parseInt(limit));

    res.json({
      success: true,
      data: featured
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get featured products',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/products/:id
 * @desc    Get single product with detailed information
 * @access  Public
 */
router.get('/:id', async (req, res) => {
  try {
    const product = await ProductAdvanced.findById(req.params.id)
      .populate('brand', 'name logo')
      .populate('category', 'name')
      .populate('seller', 'businessInfo.businessName performance.rating');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Update view count
    await product.updateAnalytics('view');

    res.json({
      success: true,
      data: product
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get product',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/products/:id/recommendations
 * @desc    Get product recommendations
 * @access  Public
 */
router.get('/:id/recommendations', async (req, res) => {
  try {
    const { type = 'similar', limit = 20 } = req.query;
    
    let recommendations;

    switch (type) {
      case 'similar':
        recommendations = await recommendationEngine.getSimilarProducts(req.params.id, parseInt(limit));
        break;
      case 'frequently_bought':
        recommendations = await recommendationEngine.getFrequentlyBoughtTogether(req.params.id, parseInt(limit));
        break;
      case 'upsell':
        recommendations = await recommendationEngine.getUpSellRecommendations(req.params.id, parseInt(limit));
        break;
      default:
        recommendations = await recommendationEngine.getSimilarProducts(req.params.id, parseInt(limit));
    }

    res.json({
      success: true,
      data: recommendations
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get recommendations',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/products
 * @desc    Create new product (Seller only)
 * @access  Private (Seller)
 */
router.post('/', [auth, authorize('seller', 'admin')], validateProduct, async (req, res) => {
  try {
    const productData = {
      ...req.body,
      seller: req.user.sellerId || req.user.id,
      audit: {
        createdBy: req.user.id
      }
    };

    const product = new ProductAdvanced(productData);
    await product.save();

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to create product',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/products/:id
 * @desc    Update product (Seller/Admin only)
 * @access  Private
 */
router.put('/:id', [auth, authorize('seller', 'admin')], async (req, res) => {
  try {
    const product = await ProductAdvanced.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check ownership (sellers can only update their products)
    if (req.user.role === 'seller' && product.seller.toString() !== req.user.sellerId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this product'
      });
    }

    // Track changes for audit
    const changes = Object.keys(req.body).map(key => ({
      field: key,
      oldValue: product[key],
      newValue: req.body[key]
    }));

    Object.assign(product, req.body);
    product.audit.lastModifiedBy = req.user.id;
    product.audit.changeHistory.push({
      changes,
      changedBy: req.user.id,
      changedAt: new Date(),
      reason: req.body.changeReason || 'Product update'
    });

    await product.save();

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: product
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to update product',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/products/:id
 * @desc    Delete product (Soft delete)
 * @access  Private (Seller/Admin)
 */
router.delete('/:id', [auth, authorize('seller', 'admin')], async (req, res) => {
  try {
    const product = await ProductAdvanced.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check ownership
    if (req.user.role === 'seller' && product.seller.toString() !== req.user.sellerId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this product'
      });
    }

    // Soft delete
    product.isDeleted = true;
    product.deletedAt = new Date();
    product.deletedBy = req.user.id;
    product.deletionReason = req.body.reason || 'Product discontinued';
    product.status = 'discontinued';

    await product.save();

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/products/:id/variants
 * @desc    Add product variant
 * @access  Private (Seller/Admin)
 */
router.post('/:id/variants', [auth, authorize('seller', 'admin')], async (req, res) => {
  try {
    const product = await ProductAdvanced.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check ownership
    if (req.user.role === 'seller' && product.seller.toString() !== req.user.sellerId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this product'
      });
    }

    const variant = {
      ...req.body,
      sku: req.body.sku || `${product.sku}-${Date.now()}`
    };

    product.variants.push(variant);
    product.productType = 'variable';

    await product.save();

    res.status(201).json({
      success: true,
      message: 'Variant added successfully',
      data: variant
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to add variant',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/products/category/:categoryId
 * @desc    Get products by category
 * @access  Public
 */
router.get('/category/:categoryId', async (req, res) => {
  try {
    const { page = 1, limit = 20, sort = 'popularity' } = req.query;
    
    const products = await ProductAdvanced.findByCategory(req.params.categoryId, {
      page: parseInt(page),
      limit: parseInt(limit),
      sort
    });

    res.json({
      success: true,
      data: products
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get category products',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/products/:id/analytics
 * @desc    Update product analytics
 * @access  Private
 */
router.post('/:id/analytics', auth, async (req, res) => {
  try {
    const { type, value = 1 } = req.body;
    
    const product = await ProductAdvanced.findById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    await product.updateAnalytics(type, value);

    res.json({
      success: true,
      message: 'Analytics updated'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update analytics',
      error: error.message
    });
  }
});

module.exports = router;
