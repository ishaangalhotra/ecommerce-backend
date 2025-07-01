const express = require('express');
const router = express.Router();
const { getOrders, createOrder } = require('../controllers/orderController'); // Import controller functions

// GET all orders
router.get('/', getOrders); // Example, you might want authentication for this later

// POST create new order
router.post('/', createOrder); // Example, requires user to be logged in later

module.exports = router;