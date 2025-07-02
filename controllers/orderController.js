const Order = require('../models/Order');
const Product = require('../models/Product'); // Needed to check product stock/details
const asyncHandler = require('express-async-handler'); // For handling async errors

// @desc    Create new order
// @route   POST /api/orders
// @access  Private (requires authentication)
exports.createOrder = asyncHandler(async (req, res) => {
  const {
    orderItems,
    shippingAddress,
    paymentMethod,
    itemsPrice, // Frontend calculated price, should be re-validated
    taxPrice,
    shippingPrice,
    totalPrice,
  } = req.body;

  if (orderItems && orderItems.length === 0) {
    res.status(400);
    throw new Error('No order items');
  } else {
    // Validate order items and calculate prices on the server-side to prevent tampering
    const itemsFromDB = await Product.find({
      _id: {
        $in: orderItems.map(x => x.product) // Get product IDs from the order items
      }
    });

    const validatedOrderItems = orderItems.map(item => {
      const dbItem = itemsFromDB.find(p => p._id.toString() === item.product.toString());
      if (!dbItem) {
        res.status(404);
        throw new Error(`Product not found: ${item.name}`); // Use item.name for error message
      }
      // You might also want to check dbItem.countInStock here and decrement it
      return {
        name: dbItem.name,
        qty: item.qty,
        imageUrl: dbItem.imageUrl,
        price: dbItem.price,
        product: dbItem._id,
      };
    });

    // Recalculate itemsPrice on the backend for security
    const calculatedItemsPrice = validatedOrderItems.reduce(
      (acc, item) => acc + item.price * item.qty,
      0
    );

    // You would typically recalculate taxPrice, shippingPrice, totalPrice based on your business logic here
    // For simplicity, using frontend provided values for now, but ideally recalculate all prices.

    const order = new Order({
      user: req.user._id, // User ID comes from the 'protect' middleware
      orderItems: validatedOrderItems,
      shippingAddress,
      paymentMethod,
      itemsPrice: calculatedItemsPrice, // Use server-calculated price
      taxPrice, // Use frontend provided or recalculate
      shippingPrice, // Use frontend provided or recalculate
      totalPrice, // Use frontend provided or recalculate
    });

    const createdOrder = await order.save();
    res.status(201).json(createdOrder);
  }
});

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private (requires authentication)
exports.getMyOrders = asyncHandler(async (req, res) => {
  // Find orders where the 'user' field matches the ID of the logged-in user
  const orders = await Order.find({ user: req.user._id }).populate('user', 'username email');
  res.json(orders);
});

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private (requires authentication, or admin)
exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    'user',
    'username email'
  );

  if (order) {
    // Ensure only the order owner or an admin can view the order
    if (order.user._id.toString() === req.user._id.toString() || req.user.role === 'admin') {
      res.json(order);
    } else {
      res.status(401);
      throw new Error('Not authorized to view this order');
    }
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private (requires authentication)
exports.updateOrderToPaid = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.isPaid = true;
    order.paidAt = Date.now();
    // You would typically get paymentResult details from a payment gateway callback
    order.paymentResult = {
      id: req.body.id,
      status: req.body.status,
      update_time: req.body.update_time,
      email_address: req.body.email_address,
    };

    const updatedOrder = await order.save();
    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Update order to delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
exports.updateOrderToDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.isDelivered = true;
    order.deliveredAt = Date.now();

    const updatedOrder = await order.save();
    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Get all orders (for admin)
// @route   GET /api/orders/all
// @access  Private/Admin
exports.getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate('user', 'id username');
  res.json(orders);
});