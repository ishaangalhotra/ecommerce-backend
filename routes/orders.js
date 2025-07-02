const express = require('express');
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
  getAllOrders
} = require('../controllers/orderController');
const { protect, admin } = require('../middleware/authMiddleware'); // Import middleware

// @route   POST /api/orders - Create a new order (Protected)
router.route('/').post(protect, createOrder);

// @route   GET /api/orders/myorders - Get logged in user's orders (Protected)
router.route('/myorders').get(protect, getMyOrders);

// @route   GET /api/orders/all - Get all orders (Protected, Admin only)
router.route('/all').get(protect, admin, getAllOrders);

// @route   GET /api/orders/:id - Get a specific order by ID (Protected)
// @route   PUT /api/orders/:id/pay - Update order to paid (Protected)
// @route   PUT /api/orders/:id/deliver - Update order to delivered (Protected, Admin only)
router
  .route('/:id')
  .get(protect, getOrderById);

router.route('/:id/pay').put(protect, updateOrderToPaid);
router.route('/:id/deliver').put(protect, admin, updateOrderToDelivered);

module.exports = router;