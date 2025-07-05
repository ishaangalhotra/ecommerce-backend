const express = require('express');
const router = express.Router();
const {
  protect,
  authorize
} = require('../middleware/authMiddleware');
const {
  getAllOrders,
  filterOrdersByStatus,
  updateOrderStatus,
  getDashboardStats,
  getAllUsers,
  updateUserRole
} = require('../controllers/adminController');

router.get('/dashboard', protect, authorize('admin'), getDashboardStats);
router.get('/orders', protect, authorize('admin'), getAllOrders);
router.get('/orders/filter', protect, authorize('admin'), filterOrdersByStatus);
router.put('/orders/:id', protect, authorize('admin'), updateOrderStatus);
router.get('/users', protect, authorize('admin'), getAllUsers);
router.put('/users/:id', protect, authorize('admin'), updateUserRole);

module.exports = router;