const express = require('express');
const router = express.Router();
const { 
  protect, 
  authorize 
} = require('../middlewares/authMiddleware');
const {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
  getAllOrders
} = require('../controllers/orderController');

// User routes
router.post('/', protect, createOrder);
router.get('/myorders', protect, getMyOrders);
router.get('/:id', protect, getOrderById);
router.put('/:id/pay', protect, updateOrderToPaid);

// Admin routes
router.put('/:id/deliver', protect, authorize('admin'), updateOrderToDelivered);
router.get('/', protect, authorize('admin'), getAllOrders);

module.exports = router;