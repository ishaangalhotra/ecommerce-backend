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
  getAllOrders,
  cancelOrder
} = require('../controllers/orderController');

// User routes
router.route('/')
  .post(protect, createOrder);

router.route('/myorders')
  .get(protect, getMyOrders);

router.route('/:id')
  .get(protect, getOrderById)
  .put(protect, cancelOrder); // New cancel order route

router.route('/:id/pay')
  .put(protect, updateOrderToPaid);

// Admin routes
router.route('/')
  .get(protect, authorize('admin'), getAllOrders);

router.route('/:id/deliver')
  .put(protect, authorize('admin'), updateOrderToDelivered);

module.exports = router;