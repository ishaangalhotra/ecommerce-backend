const Order = require("../models/Order");

exports.placeOrder = async (req, res) => {
  const { items, totalAmount, shippingAddress } = req.body;

  if (!items || !totalAmount || !shippingAddress) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const order = new Order({
      user: req.user.id,
      items,
      totalAmount,
      shippingAddress
    });

    const savedOrder = await order.save();
    res.status(201).json(savedOrder);

  } catch (err) {
    res.status(500).json({ message: "Server error while placing order" });
  }
};

exports.getUserOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch orders" });
  }
};
