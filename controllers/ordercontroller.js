const Order = require('../models/Order');
const Cart = require('../models/Cart');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');

// @desc    Get all orders
// @route   GET /api/v1/orders
// @access  Private
exports.getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user.id });
  res.status(200).json({
    success: true,
    count: orders.length,
    data: orders
  });
});

// @desc    Get single order
// @route   GET /api/v1/orders/:id
// @access  Private
exports.getOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user.id
  });

  if (!order) {
    return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
  }

  res.status(200).json({
    success: true,
    data: order
  });
});

// @desc    Create order from cart
// @route   POST /api/v1/orders
// @access  Private
exports.createOrder = asyncHandler(async (req, res, next) => {
  // Get user's cart
  const cart = await Cart.findOne({ user: req.user.id }).populate('items.product');
  
  if (!cart || cart.items.length === 0) {
    return next(new ErrorResponse('No items in cart', 400));
  }

  // Create order
  const order = await Order.create({
    user: req.user.id,
    items: cart.items.map(item => ({
      product: item.product._id,
      name: item.product.name,
      quantity: item.quantity,
      price: item.price
    })),
    total: cart.total,
    shippingAddress: req.body.shippingAddress,
    paymentMethod: req.body.paymentMethod
  });

  // Clear the cart
  await Cart.findOneAndDelete({ user: req.user.id });

  res.status(201).json({
    success: true,
    data: order
  });
});

// @desc    Update order
// @route   PUT /api/v1/orders/:id
// @access  Private/Admin
exports.updateOrder = asyncHandler(async (req, res, next) => {
  let order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
  }

  // Only admin can update orders
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse(`User ${req.user.id} is not authorized to update this order`, 401));
  }

  order = await Order.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  });

  res.status(200).json({
    success: true,
    data: order
  });
});

// @desc    Delete order
// @route   DELETE /api/v1/orders/:id
// @access  Private/Admin
exports.deleteOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
  }

  // Only admin can delete orders
  if (req.user.role !== 'admin') {
    return next(new ErrorResponse(`User ${req.user.id} is not authorized to delete this order`, 401));
  }

  await order.remove();

  res.status(200).json({
    success: true,
    data: {}
  });
});