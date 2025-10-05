const express = require('express');
const router = express.Router();

const {
  createOrder,
  getUserOrders,
  getOrder,
  updateOrderStatus
} = require('../controllers/ordercontroller');

// 🔐 Auth middleware - CHANGED to use the modern hybridAuth file
const { hybridProtect } = require('../middleware/hybridAuth');

// 🧾 Create a new order - CHANGED to use hybridProtect
router.post('/', hybridProtect, createOrder);

// 📋 Get all orders of logged-in user (with pagination) - CHANGED
router.get('/', hybridProtect, getUserOrders);

// 🔍 Get a specific order by ID - CHANGED
router.get('/:id', hybridProtect, getOrder);

// ⚙️ Update order status (for sellers/admins) - CHANGED
router.put('/:id/status', hybridProtect, updateOrderStatus);

module.exports = router;