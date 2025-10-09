const Order = require('../models/Order');
const Product = require('../models/Product');
const Cart = require('../models/cart');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/asyncHandler');
const mongoose = require('mongoose');
const { AbortController } = require('node-abort-controller');
const logger = require('../utils/logger');
const orderProcessingEngine = require('../services/orderProcessingEngine');
const orderStatusManager = require('../services/orderStatusManager');

// @desc    Create order (OPTIMIZED & RENDER-SAFE VERSION)
// @route   POST /api/v1/orders
// @access  Private
exports.createOrder = asyncHandler(async (req, res, next) => {
  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutMs = 20000; // 20 seconds max per order

  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Move Read-Only Queries Outside Transactions
  const orderCount = await Order.countDocuments({
    createdAt: {
      $gte: new Date(new Date().setHours(0, 0, 0, 0)),
      $lt: new Date(new Date().setHours(23, 59, 59, 999))
    }
  });

  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    logger.info('Starting order creation process', { userId: req.user.id });
    
    const { 
      items, 
      orderItems, 
      shippingAddress, 
      paymentMethod, 
      saveAddress = true 
    } = req.body;

    const itemsToProcess = items || orderItems;
    
    if (!itemsToProcess || !Array.isArray(itemsToProcess) || itemsToProcess.length === 0) {
      await session.abortTransaction();
      return next(new ErrorResponse('No order items', 400));
    }

    if (!shippingAddress) {
      await session.abortTransaction();
      return next(new ErrorResponse('Shipping address required', 400));
    }

    logger.info(`Processing items for order`, { itemCount: itemsToProcess.length, userId: req.user.id });

    const productIds = itemsToProcess.map(item => item.product);
    const products = await Product.find({
      _id: { $in: productIds },
      status: 'active',
      isDeleted: { $ne: true }
    }, null, { signal }).session(session).select('name price stock seller images').lean();

    if (products.length !== productIds.length) {
      await session.abortTransaction();
      return next(new ErrorResponse('Some products not found or unavailable', 404));
    }
    
    const productMap = new Map(products.map(p => [p._id.toString(), p]));
    products.length = 0; // Clean memory

    const orderItemsWithDetails = [];
    let itemsPrice = 0;
    
    for (const item of itemsToProcess) {
      const product = productMap.get(item.product.toString());
      if (!product) {
        await session.abortTransaction();
        return next(new ErrorResponse(`Product not found: ${item.product}`, 404));
      }

      const quantity = item.quantity || item.qty || 1;
      
      if (product.stock < quantity) {
        await session.abortTransaction();
        return next(new ErrorResponse(
          `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${quantity}`,
          400
        ));
      }

      const itemTotal = product.price * quantity;
      itemsPrice += itemTotal;

      orderItemsWithDetails.push({
        product: product._id,
        name: product.name,
        unitPrice: product.price,
        qty: quantity,
        totalPrice: itemTotal,
        seller: product.seller,
        image: product.images && product.images[0] ? 
               (typeof product.images[0] === 'string' ? product.images[0] : product.images[0].url) :
               ''
      });
    }

    const shippingPrice = itemsPrice > 500 ? 0 : 25;
    const taxPrice = Number((0.05 * itemsPrice).toFixed(2));
    const totalPrice = itemsPrice + shippingPrice + taxPrice;

    const orderNumber = `QL${new Date().getFullYear().toString().slice(-2)}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}${(orderCount + 1).toString().padStart(4, '0')}`;

    const order = new Order({
      orderNumber,
      user: req.user.id,
      customerInfo: {
        name: shippingAddress.name || req.user.name,
        email: shippingAddress.email || req.user.email,
        phone: shippingAddress.phone || req.user.phone
      },
      orderItems: orderItemsWithDetails,
      shippingAddress: {
        fullName: shippingAddress.name,
        address: shippingAddress.address,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: shippingAddress.pincode || shippingAddress.postalCode,
        country: shippingAddress.country || 'India',
        phoneNumber: shippingAddress.phone
      },
      pricing: {
        itemsPrice,
        shippingPrice,
        taxPrice,
        totalPrice,
        discountAmount: 0
      },
      paymentMethod: paymentMethod === 'card' ? 'credit_card' : paymentMethod,
      status: 'pending',
      isPaid: paymentMethod !== 'cod',
      statusHistory: [{
        status: 'pending',
        timestamp: new Date(),
        description: 'Order placed successfully'
      }]
    });

    // ⚡ CRITICAL FIX: Single bulkWrite with atomic stock validation
    const bulkOps = orderItemsWithDetails.map(item => ({
      updateOne: {
        filter: { 
          _id: item.product, 
          stock: { $gte: item.qty } // ✅ Atomic stock check
        },
        update: { 
          $inc: { 
            stock: -item.qty,
            totalSales: item.qty,
            totalRevenue: item.totalPrice
          },
          $set: { updatedAt: new Date() }
        }
      }
    }));

    const bulkResult = await Product.bulkWrite(bulkOps, { session });

    // ✅ Verify all products were updated (none went out of stock)
    if (bulkResult.modifiedCount !== orderItemsWithDetails.length) {
      await session.abortTransaction();
      return next(new ErrorResponse(
        'One or more items went out of stock. Please refresh and try again.', 
        409
      ));
    }

    // Save order and clear cart in parallel
    await Promise.all([
      order.save({ session }),
      Cart.findOneAndDelete({ user: req.user.id }, { session })
    ]);

    await session.commitTransaction();
    
    logger.info('Order created successfully', { orderId: order._id, orderNumber: order.orderNumber, userId: req.user.id });

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.pricing.totalPrice,
        items: order.orderItems.map(item => ({
          product: item.product,
          name: item.name,
          qty: item.qty,
          price: item.unitPrice,
          totalPrice: item.totalPrice
        }))
      }
    });

    // Use setImmediate() for background notifications
    setImmediate(async () => {
      try {
        await sendOrderNotifications(order, 'created');
        logger.info('Notifications sent for order', { orderNumber });
      } catch (notificationError) {
        logger.error('Notification sending failed', { error: notificationError.message, orderNumber });
      }
    });

  } catch (error) {
    await session.abortTransaction();
    
    if (error.name === 'AbortError') {
      logger.error('Order creation timeout - system under load', { userId: req.user.id });
      return next(new ErrorResponse('Server is busy. Please retry.', 503));
    }
    
    logger.error('Order creation failed', { error: error.message, stack: error.stack, userId: req.user.id });
    
    if (error.name === 'ValidationError') {
      return next(new ErrorResponse('Invalid order data', 400));
    }
    if (error.code === 11000) {
      return next(new ErrorResponse('Duplicate order detected', 409));
    }
    
    next(new ErrorResponse(error.message || 'Order creation failed', 500));
  } finally {
    clearTimeout(timeout);
    session.endSession();
  }
});

async function sendOrderNotifications(order, type) {
  try {
    logger.info(`Would send ${type} notification for order`, { orderNumber: order.orderNumber });
  } catch (error) {
    logger.error('Notification sending failed:', { error: error.message, orderNumber: order.orderNumber });
  }
}

// @desc    Get user orders
// @route   GET /api/v1/orders
// @access  Private
exports.getUserOrders = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const orders = await Order.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select('orderNumber status pricing.totalPrice createdAt')
    .lean();

  const totalOrders = await Order.countDocuments({ user: req.user.id });

  res.json({
    success: true,
    orders,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      hasNext: page * limit < totalOrders,
      hasPrev: page > 1
    }
  });
});

// @desc    Get single order
// @route   GET /api/v1/orders/:id
// @access  Private
exports.getOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user.id
  })
  .populate('orderItems.product', 'name images')
  .lean();

  if (!order) {
    return next(new ErrorResponse('Order not found', 404));
  }

  res.json({
    success: true,
    order
  });
});

// @desc    Update order status
// @route   PUT /api/v1/orders/:id/status
// @access  Private/Seller
exports.updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return next(new ErrorResponse('Invalid status', 400));
  }

  const order = await Order.findOne({
    _id: req.params.id,
    $or: [
      { user: req.user.id },
      { 'orderItems.seller': req.user.id }
    ]
  });

  if (!order) {
    return next(new ErrorResponse('Order not found', 404));
  }

  order.status = status;
  order.statusHistory.push({
    status,
    timestamp: new Date(),
    description: `Status updated to ${status}`
  });

  await order.save();
  
  logger.info('Order status updated', { orderId: order._id, newStatus: status, userId: req.user.id });

  res.json({
    success: true,
    message: 'Order status updated successfully',
    order: {
      id: order._id,
      status: order.status,
      orderNumber: order.orderNumber
    }
  });
});