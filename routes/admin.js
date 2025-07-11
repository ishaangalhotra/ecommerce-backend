const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');

// Protect all admin routes
router.use(protect);
router.use(authorize('admin'));

// 📊 Admin Dashboard Stats
router.get('/dashboard', async (req, res) => {
  try {
    const [users, products, orders, revenue] = await Promise.all([
      User.countDocuments(),
      Product.countDocuments(),
      Order.countDocuments(),
      Order.aggregate([{ $group: { _id: null, total: { $sum: "$total" } } }])
    ]);

    res.status(200).json({
      success: true,
      stats: {
        users,
        products,
        orders,
        revenue: revenue[0]?.total || 0
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
});

// 🧾 Get All Orders
router.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to get orders' });
  }
});

// ✅ Filter Orders by Status (optional query param: ?status=delivered)
router.get('/orders/filter', async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const orders = await Order.find(query);
    res.status(200).json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error filtering orders' });
  }
});

// ✏️ Update Order Status
router.put('/orders/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

// 👥 Get All Users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.status(200).json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// 🔧 Update User Role
router.put('/users/:id', async (req, res) => {
  try {
    const { role } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    );
    res.status(200).json({ success: true, data: updatedUser });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update user role' });
  }
});

module.exports = router;
