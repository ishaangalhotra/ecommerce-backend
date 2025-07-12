const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const asyncHandler = require('../middleware/asyncHandlerHandler');
const ErrorResponse = require('../utils/errorResponse');

// @desc    Get dashboard statistics
// @route   GET /api/v1/admin/dashboard
// @access  Private/Admin
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const [
    totalOrders,
    pendingOrders,
    totalUsers,
    totalProducts,
    recentOrders
  ] = await Promise.all([
    Order.countDocuments(),
    Order.countDocuments({ status: 'Processing' }),
    User.countDocuments(),
    Product.countDocuments(),
    Order.find().sort('-createdAt').limit(5).populate('user', 'name email')
  ]);

  const totalRevenue = await Order.aggregate([
    { $match: { status: 'Delivered' } },
    { $group: { _id: null, total: { $sum: '$totalPrice' } } }
  ]);

  res.status(200).json({
    success: true,
    data: {
      totalOrders,
      pendingOrders,
      totalUsers,
      totalProducts,
      totalRevenue: totalRevenue[0]?.total || 0,
      recentOrders
    }
  });
});

// @desc    Get all orders
// @route   GET /api/v1/admin/orders
// @access  Private/Admin
exports.getAllOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find()
    .populate('user', 'name email')
    .populate('items.product', 'name price image');

  res.status(200).json({
    success: true,
    count: orders.length,
    data: orders
  });
});

// @desc    Filter orders by status
// @route   GET /api/v1/admin/orders/filter
// @access  Private/Admin
exports.filterOrdersByStatus = asyncHandler(async (req, res) => {
  const { status, startDate, endDate } = req.query;
  
  let query = {};
  if (status) query.status = status;
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const orders = await Order.find(query)
    .populate('user', 'name email');

  res.status(200).json({
    success: true,
    count: orders.length,
    data: orders
  });
});

// @desc    Update order status
// @route   PUT /api/v1/admin/orders/:id
// @access  Private/Admin
exports.updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  const validStatuses = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];

  if (!validStatuses.includes(status)) {
    return next(new ErrorResponse(`Invalid status: ${status}`, 400));
  }

  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true, runValidators: true }
  );

  if (!order) {
    return next(new ErrorResponse(`Order not found with id ${req.params.id}`, 404));
  }

  res.status(200).json({ success: true, data: order });
});

// @desc    Get all users
// @route   GET /api/v1/admin/users
// @access  Private/Admin
exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select('-password');

  res.status(200).json({
    success: true,
    count: users.length,
    data: users
  });
});

// @desc    Update user role
// @route   PUT /api/v1/admin/users/:id
// @access  Private/Admin
exports.updateUserRole = asyncHandler(async (req, res, next) => {
  const { role } = req.body;
  const validRoles = ['user', 'seller', 'admin'];

  if (!validRoles.includes(role)) {
    return next(new ErrorResponse(`Invalid role: ${role}`, 400));
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { role },
    { new: true, runValidators: true }
  ).select('-password');

  if (!user) {
    return next(new ErrorResponse(`User not found with id ${req.params.id}`, 404));
  }

  res.status(200).json({ success: true, data: user });
});\// @desc    Get all products
// @route   GET /api/v1/admin/products
// @access  Private/Admin
exports.getAllProducts = asyncHandler(async (req, res) => {
  const products = await Product.find().populate('seller', 'name email');
  res.status(200).json({
    success: true,
    count: products.length,
    products
  });
});

// @desc    Update product status (active/inactive)
// @route   PUT /api/v1/admin/products/:id
// @access  Private/Admin
exports.updateProductStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  const validStatuses = ['active', 'inactive'];

  if (!validStatuses.includes(status)) {
    return next(new ErrorResponse(`Invalid status: ${status}`, 400));
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true, runValidators: true }
  );

  if (!product) {
    return next(new ErrorResponse(`Product not found with id ${req.params.id}`, 404));
  }

  res.status(200).json({ success: true, data: product });
});
