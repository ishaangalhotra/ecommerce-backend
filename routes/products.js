const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { createProduct, getProducts } = require('../controllers/productController');

// GET all products
router.get('/', getProducts);

// POST a new product (protected route)
router.post('/', protect, createProduct);

module.exports = router;