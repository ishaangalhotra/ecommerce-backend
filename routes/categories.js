const express = require('express');
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const { protect, authorize } = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const router = express.Router();

// ==================== GET ALL CATEGORIES ====================
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search, 
      parent,
      featured,
      active = true 
    } = req.query;

    const filters = {};
    
    if (active === 'true') {
      filters.isActive = true;
    }
    
    if (featured === 'true') {
      filters.isFeatured = true;
    }
    
    if (parent) {
      if (parent === 'null' || parent === 'root') {
        filters.parent = null;
      } else if (mongoose.isValidObjectId(parent)) {
        filters.parent = parent;
      }
    }

    let query = Category.find(filters);

    if (search) {
      query = query.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { slug: { $regex: search, $options: 'i' } }
        ]
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [categories, totalCategories] = await Promise.all([
      query
        .populate('parentCategory', 'name slug')
        .populate('children', 'name slug isActive')
        .sort({ order: 1, name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Category.countDocuments(filters)
    ]);

    // Add product counts to each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        const productCount = await Product.countDocuments({ 
          category: category._id, 
          status: 'active' 
        });
        
        return {
          ...category,
          productCount,
          id: category._id
        };
      })
    );

    res.json({
      success: true,
      message: 'Categories retrieved successfully',
      data: {
        categories: categoriesWithCounts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCategories,
          pages: Math.ceil(totalCategories / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
      message: error.message
    });
  }
});

// ==================== GET SINGLE CATEGORY ====================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { includeProducts = 'false', limit = 10 } = req.query;

    let category;
    
    if (mongoose.isValidObjectId(id)) {
      category = await Category.findById(id)
        .populate('parent', 'name slug')
        .populate('children', 'name slug isActive')
        .lean();
    } else {
      category = await Category.findOne({ slug: id })
        .populate('parentCategory', 'name slug')
        .populate('children', 'name slug isActive')
        .lean();
    }

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Get product count
    const productCount = await Product.countDocuments({ 
      category: category._id, 
      status: 'active' 
    });

    const result = {
      ...category,
      productCount,
      id: category._id
    };

    // Include products if requested
    if (includeProducts === 'true') {
      const products = await Product.find({ 
        category: category._id, 
        status: 'active' 
      })
        .select('name price images stock averageRating totalReviews slug')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .lean();

      result.products = products.map(product => ({
        id: product._id,
        name: product.name,
        price: product.price,
        finalPrice: product.discountPercentage > 0 
          ? product.price - (product.price * product.discountPercentage / 100)
          : product.price,
        discountPercentage: product.discountPercentage,
        isOnSale: product.discountPercentage > 0,
        images: product.images.slice(0, 1),
        stock: product.stock,
        isInStock: product.stock > 0,
        averageRating: product.averageRating,
        totalReviews: product.totalReviews,
        slug: product.slug
      }));
    }

    res.json({
      success: true,
      message: 'Category retrieved successfully',
      data: result
    });

  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category',
      message: error.message
    });
  }
});

// ==================== CREATE CATEGORY (ADMIN ONLY) ====================
router.post('/', [
  protect,
  authorize('admin'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be 2-100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  body('slug')
    .optional()
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('parent')
    .optional()
    .isMongoId()
    .withMessage('Invalid parent category ID'),
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Order must be a positive integer'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  body('isFeatured')
    .optional()
    .isBoolean()
    .withMessage('isFeatured must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      name,
      description,
      slug,
      parent,
      order = 0,
      isActive = true,
      isFeatured = false,
      image
    } = req.body;

    // Generate slug if not provided
    let categorySlug = slug;
    if (!categorySlug) {
      categorySlug = name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim('-');
    }

    // Check if slug already exists
    const existingCategory = await Category.findOne({ slug: categorySlug });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        error: 'Category with this slug already exists'
      });
    }

    // Validate parent category if provided
    if (parent) {
      const parentCategory = await Category.findById(parent);
      if (!parentCategory) {
        return res.status(400).json({
          success: false,
          error: 'Parent category not found'
        });
      }
    }

    const category = new Category({
      name,
      description,
      slug: categorySlug,
      parent: parent || null,
      order,
      isActive,
      isFeatured,
      image
    });

    await category.save();

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: {
        id: category._id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        parent: category.parent,
        order: category.order,
        isActive: category.isActive,
        isFeatured: category.isFeatured,
        image: category.image,
        createdAt: category.createdAt
      }
    });

  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create category',
      message: error.message
    });
  }
});

// ==================== UPDATE CATEGORY (ADMIN ONLY) ====================
router.put('/:id', [
  protect,
  authorize('admin'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be 2-100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  body('slug')
    .optional()
    .trim()
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
  body('parent')
    .optional()
    .isMongoId()
    .withMessage('Invalid parent category ID'),
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Order must be a positive integer'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  body('isFeatured')
    .optional()
    .isBoolean()
    .withMessage('isFeatured must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const updateData = req.body;

    // Check if category exists
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Check slug uniqueness if being updated
    if (updateData.slug && updateData.slug !== category.slug) {
      const existingCategory = await Category.findOne({ slug: updateData.slug });
      if (existingCategory) {
        return res.status(400).json({
          success: false,
          error: 'Category with this slug already exists'
        });
      }
    }

    // Validate parent category if being updated
    if (updateData.parent && updateData.parent !== category.parent?.toString()) {
      if (updateData.parent === 'null') {
        updateData.parent = null;
      } else {
        const parentCategory = await Category.findById(updateData.parent);
        if (!parentCategory) {
          return res.status(400).json({
            success: false,
            error: 'Parent category not found'
          });
        }
      }
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('parent', 'name slug');

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: {
        id: updatedCategory._id,
        name: updatedCategory.name,
        slug: updatedCategory.slug,
        description: updatedCategory.description,
        parent: updatedCategory.parent,
        order: updatedCategory.order,
        isActive: updatedCategory.isActive,
        isFeatured: updatedCategory.isFeatured,
        image: updatedCategory.image,
        updatedAt: updatedCategory.updatedAt
      }
    });

  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update category',
      message: error.message
    });
  }
});

// ==================== DELETE CATEGORY (ADMIN ONLY) ====================
router.delete('/:id', [protect, authorize('admin')], async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Check if category has products
    const productCount = await Product.countDocuments({ category: id });
    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete category with existing products',
        message: `This category has ${productCount} products. Please move or delete them first.`
      });
    }

    // Check if category has children
    const childrenCount = await Category.countDocuments({ parent: id });
    if (childrenCount > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete category with subcategories',
        message: `This category has ${childrenCount} subcategories. Please delete them first.`
      });
    }

    await Category.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete category',
      message: error.message
    });
  }
});

// ==================== GET CATEGORY TREE ====================
router.get('/tree/hierarchy', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .populate('children', 'name slug isActive')
      .sort({ order: 1, name: 1 })
      .lean();

    // Build tree structure
    const buildTree = (items, parentId = null) => {
      return items
        .filter(item => 
          parentId === null 
            ? !item.parent 
            : item.parent && item.parent.toString() === parentId
        )
        .map(item => ({
          id: item._id,
          name: item.name,
          slug: item.slug,
          description: item.description,
          image: item.image,
          isFeatured: item.isFeatured,
          children: buildTree(items, item._id.toString())
        }));
    };

    const categoryTree = buildTree(categories);

    res.json({
      success: true,
      message: 'Category tree retrieved successfully',
      data: categoryTree
    });

  } catch (error) {
    console.error('Error fetching category tree:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category tree',
      message: error.message
    });
  }
});

// ==================== GET FEATURED CATEGORIES ====================
router.get('/featured/list', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const categories = await Category.find({ 
      isActive: true, 
      isFeatured: true 
    })
      .populate('parent', 'name slug')
      .sort({ order: 1, name: 1 })
      .limit(parseInt(limit))
      .lean();

    // Add product counts
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        const productCount = await Product.countDocuments({ 
          category: category._id, 
          status: 'active' 
        });
        
        return {
          id: category._id,
          name: category.name,
          slug: category.slug,
          description: category.description,
          image: category.image,
          parent: category.parent,
          productCount
        };
      })
    );

    res.json({
      success: true,
      message: 'Featured categories retrieved successfully',
      data: categoriesWithCounts
    });

  } catch (error) {
    console.error('Error fetching featured categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch featured categories',
      message: error.message
    });
  }
});

module.exports = router;
