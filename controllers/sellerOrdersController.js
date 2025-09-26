// controllers/sellerOrdersController.js
const mongoose = require('mongoose');
const Order = require('../models/Order');     // assumes you already have this
const Product = require('../models/Product'); // for lookups/ownership checks

/**
 * GET /api/v1/seller/orders
 * Supports: ?status=pending|processing|shipped|delivered|cancelled, ?page=1, ?limit=20, ?q=<search>
 * Returns only the items in each order that belong to the logged-in seller.
 */
exports.listSellerOrders = async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user.id);
  const { status, page = 1, limit = 10, q } = req.query;

  const matchStatus = status && status !== 'all' ? { 'items.status': status } : {};
  const search = q
    ? {
        $or: [
          { 'shipping.fullName': { $regex: q, $options: 'i' } },
          { 'shipping.phone': { $regex: q, $options: 'i' } },
          { orderNumber: { $regex: q, $options: 'i' } },
        ],
      }
    : {};

  const pipeline = [
    { $match: search },
    { $unwind: '$items' },
    // Attach product to each item to check seller ownership
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'prod',
      },
    },
    { $unwind: '$prod' },
    // keep only items that belong to this seller
    { $match: { 'prod.seller': sellerId } },
    // optional status filter
    ...(status && status !== 'all' ? [{ $match: { 'items.status': status } }] : []),
    // group back by order
    {
      $group: {
        _id: '$_id',
        orderId: { $first: '$_id' },
        orderNumber: { $first: '$orderNumber' },
        user: { $first: '$user' },
        shipping: { $first: '$shipping' },
        payment: { $first: '$payment' },
        createdAt: { $first: '$createdAt' },
        updatedAt: { $first: '$updatedAt' },
        // only the seller's items
        items: {
          $push: {
            _id: '$items._id',
            product: '$items.product',
            name: '$items.name',
            price: '$items.price',
            quantity: '$items.quantity',
            status: '$items.status',
            image: '$items.image',
          },
        },
        subtotal: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
      },
    },
    { $sort: { createdAt: -1 } },
  ];

  // Count documents using $count with a separate pipeline tail
  const countPipeline = [...pipeline, { $count: 'total' }];

  const [rows, countArr] = await Promise.all([
    Order.aggregate(pipeline)
      .skip((+page - 1) * +limit)
      .limit(+limit),
    Order.aggregate(countPipeline),
  ]);

  const total = countArr?.[0]?.total || 0;

  res.json({
    success: true,
    data: rows,
    pagination: {
      total,
      page: +page,
      limit: +limit,
      pages: Math.ceil(total / +limit) || 1,
    },
  });
};

/**
 * PATCH /api/v1/seller/orders/:id/status
 * Body: { newStatus: "processing"|"shipped"|"delivered"|"cancelled" }
 * Updates ONLY the items within the order that belong to this seller.
 */
exports.updateOrderStatusForSeller = async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user.id);
  const orderId = new mongoose.Types.ObjectId(req.params.id);
  const { newStatus } = req.body;

  const allowed = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!allowed.includes(newStatus)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  // Find the order with items owned by the seller
  const order = await Order.findById(orderId).lean();
  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  // Find which item indexes belong to this seller
  const productIds = order.items.map(i => i.product).filter(Boolean);
  const sellerProducts = await Product.find({ _id: { $in: productIds }, seller: sellerId }).select('_id');
  const ownedSet = new Set(sellerProducts.map(p => String(p._id)));

  // Build positional updates for items that belong to seller
  let modified = 0;
  const newItems = order.items.map(it => {
    if (ownedSet.has(String(it.product))) {
      if (it.status !== newStatus) modified += 1;
      return { ...it, status: newStatus };
    }
    return it;
  });

  if (!modified) {
    return res.json({ success: true, message: 'No items to update for this seller', data: { modified: 0 } });
  }

  await Order.updateOne({ _id: orderId }, { $set: { items: newItems, updatedAt: new Date() } });

  res.json({ success: true, message: 'Order item status updated', data: { modified } });
};

/**
 * GET /api/v1/seller/customers
 * Returns customers who bought from this seller + basic stats
 */
exports.listSellerCustomers = async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user.id);

  const pipeline = [
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'prod',
      },
    },
    { $unwind: '$prod' },
    { $match: { 'prod.seller': sellerId } },
    {
      $group: {
        _id: '$user',
        user: { $first: '$user' },
        orders: { $addToSet: '$_id' },
        lastOrderAt: { $max: '$createdAt' },
        totalSpent: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
      },
    },
    { $sort: { lastOrderAt: -1 } },
  ];

  const rows = await Order.aggregate(pipeline);

  // Optionally populate user basic info
  // If your Order schema stores user ref to 'User' model, you can post-process populate here as needed.

  res.json({
    success: true,
    data: rows.map(r => ({
      userId: r.user,
      totalOrders: r.orders.length,
      lastOrderAt: r.lastOrderAt,
      totalSpent: r.totalSpent,
    })),
  });
};
