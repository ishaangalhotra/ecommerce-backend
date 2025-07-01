const express = require('express');
const router = express.Router();
const { getProducts, getProductById } = require('../controllers/productController'); // Import controller functions

// GET all products
router.get('/', getProducts);

// GET product by ID (if you need to fetch single products)
router.get('/:id', getProductById);

module.exports = router;