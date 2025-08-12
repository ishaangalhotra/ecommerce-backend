const Order = require('../models/Order');
const Product = require('../models/Product');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/asyncHandlerHandler');

// @desc    Create order
// @route   POST /api/orders
// @access  Private
exports.createOrder = asyncHandler(async (req, res, next) => {
  const { orderItems, shippingAddress, paymentMethod } = req.body;

  if (!orderItems || orderItems.length === 0) {
    return next(new ErrorResponse('No order items', 400));
  }

  // Calculate prices
  const items = await Promise.all(
    orderItems.map(async item => {
      const product = await Product.findById(item.product);
      return {
        ...item,
        price: product.price
      };
    })
  );

  const itemsPrice = items.reduce((acc, item) => acc + (item.price * item.qty), 0);
  const shippingPrice = itemsPrice > 500 ? 0 : 50;
  const taxPrice = Number((0.15 * itemsPrice).toFixed(2));
  const totalPrice = itemsPrice + shippingPrice + taxPrice;

  const order = new Order({
    user: req.user.id,
    orderItems: items,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    shippingPrice,
    taxPrice,
    totalPrice
  });

  // Update stock
  await Promise.all(
    orderItems.map(async item => {
      const product = await Product.findById(item.product);
      product.countInStock -= item.qty;
      await product.save();
    })
  );

  await order.save();
  res.status(201).json({
    success: true,
    data: order
  });
});

// [Other order methods remain the same as your existing file]