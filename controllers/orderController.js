// controllers/orderController.js
const Order = require('../models/Order'); // Import the Order model

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod, itemsPrice, taxPrice, shippingPrice, totalPrice } = req.body;

  if (orderItems && orderItems.length === 0) {
    res.status(400).json({ message: 'No order items' });
    return;
  } else {
    const order = new Order({
      user: req.user._id, // Assuming req.user is populated by authMiddleware with the user object
      orderItems,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
    });

    try {
      const createdOrder = await order.save();
      res.status(201).json(createdOrder);
    } catch (error) {
      console.error('Error creating order:', error);
      res.status(500).json({ message: 'Server Error: Could not create order' });
    }
  }
};

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = async (req, res) => {
  try {
    // Assuming req.user is populated by authMiddleware with the user object (e.g., req.user._id)
    const orders = await Order.find({ user: req.user._id }).populate('user', 'username email');
    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ message: 'Server Error: Could not fetch orders' });
  }
};

module.exports = {
  createOrder,
  getMyOrders,
};