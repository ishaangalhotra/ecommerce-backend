// routes/orders.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware'); // Ensure this path is correct
const { createOrder, getMyOrders } = require('../controllers/orderController'); // Import controller functions

// Route: POST /api/orders
// Description: Create a new order (protected, requires user to be logged in)
router.post('/', protect, createOrder);

// Route: GET /api/orders/myorders
// Description: Get all orders for the logged-in user (protected)
router.get('/myorders', protect, getMyOrders);

// You can add more routes here, e.g., for getting a single order by ID, updating order status (for admin), etc.

module.exports = router;