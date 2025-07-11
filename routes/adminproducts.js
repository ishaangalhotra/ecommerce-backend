// backend/routes/adminProducts.js

const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { protect, restrictTo } = require('../middleware/authMiddleware');
const asyncHandler = require('../middleware/asyncHandler');

// Middleware: Protect and restrict to admin only
router.use(protect);
router.use(restrictTo('admin'));

// GET /api/admin/products - List all products with pagination, search, filter
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search = '', category } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (category) {
      query.category = category;
    }

    const products = await Product.find(query)
      .populate('seller', 'name email')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Product.countDocuments(query);

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: Number(page),
      products,
    });
  })
);

// PATCH /api/admin/products/:id/status - Update product status
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ['active', 'inactive', 'pending', 'rejected'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    const product = await Product.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, product });
  })
);

module.exports = router;
