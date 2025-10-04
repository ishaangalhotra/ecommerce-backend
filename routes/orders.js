const express = require('express');
const router = express.Router();

const {
  createOrder,
  getUserOrders,
  getOrder,
  updateOrderStatus
} = require('../controllers/ordercontroller');

// 🔐 Auth middleware
const { protect } = require('../middlewares/authMiddleware');

// 🧾 Create a new order
router.post('/', protect, createOrder);

// 📋 Get all orders of logged-in user (with pagination)
router.get('/', protect, getUserOrders);

// 🔍 Get a specific order by ID
router.get('/:id', protect, getOrder);

// ⚙️ Update order status (for sellers/admins)
router.put('/:id/status', protect, updateOrderStatus);

module.exports = router;
