const Order = require('../models/Order'); // Make sure you have this model

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin (you'll need authentication middleware for this)
exports.getOrders = async (req, res) => {
  try {
    const orders = await Order.find({}).populate('user', 'username email'); // Populates user info
    res.json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err.message);
    res.status(500).json({ message: 'Server error fetching orders' });
  }
};

// @desc    Create new order
// @route   POST /api/orders
// @access  Private (requires user to be logged in)
exports.createOrder = async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod, itemsPrice, taxPrice, shippingPrice, totalPrice } = req.body;

  if (orderItems && orderItems.length === 0) {
    return res.status(400).json({ message: 'No order items' });
  } else {
    try {
      const order = new Order({
        user: req.user._id, // Assuming req.user is set by authentication middleware
        orderItems,
        shippingAddress,
        paymentMethod,
        itemsPrice,
        taxPrice,
        shippingPrice,
        totalPrice
      });
      const createdOrder = await order.save();
      res.status(201).json(createdOrder);
    } catch (err) {
      console.error('Error creating order:', err.message);
      res.status(500).json({ message: 'Server error creating order' });
    }
  }
};