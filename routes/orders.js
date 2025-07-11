const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { protect, authorize } = require("../middleware/authMiddleware");
const logger = require("../utils/logger");
const mongoose = require("mongoose");
const { sendOrderConfirmationEmail } = require("../services/emailService");

// Constants
const MAX_QUANTITY = 100;
const ESTIMATED_DELIVERY_DAYS = 3;
const ORDER_STATUSES = ["processing", "shipped", "delivered", "cancelled"];

// 🔄 Utility: Validate product stock
const validateStock = async (products, session = null) => {
  const stockIssues = [];
  
  await Promise.all(products.map(async (item) => {
    const query = Product.findById(item.productId).select("seller name price stock");
    if (session) query.session(session);
    const product = await query;

    if (!product || product.stock < item.qty) {
      stockIssues.push({
        productId: item.productId,
        name: product?.name,
        available: product?.stock || 0,
        requested: item.qty
      });
    }
  }));

  return stockIssues;
};

// ✅ POST /api/orders - Create a new order (with inventory check)
router.post(
  "/",
  protect,
  [
    body("products").isArray({ min: 1 }).withMessage("At least one product is required"),
    body("products.*.productId").isMongoId().withMessage("Invalid product ID format"),
    body("products.*.qty").isInt({ min: 1, max: MAX_QUANTITY }).withMessage(`Quantity must be 1-${MAX_QUANTITY}`),
    body("shipping").isObject().withMessage("Shipping information is required"),
    body("shipping.address").notEmpty().trim().withMessage("Address is required"),
    body("shipping.city").notEmpty().trim().withMessage("City is required"),
    body("shipping.zip").isPostalCode("any").withMessage("Invalid ZIP code"),
    body("paymentMethod").isIn(["COD", "Card", "UPI", "Wallet"]).withMessage("Invalid payment method"),
    body("total").isFloat({ min: 0.01 }).withMessage("Total must be ≥ ₹0.01"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn("Order validation failed", { errors: errors.array() });
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { products, shipping, paymentMethod, total } = req.body;
      const userId = req.user._id;

      // 🛒 Check stock availability
      const stockIssues = await validateStock(products, session);
      if (stockIssues.length > 0) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Some products are unavailable",
          stockIssues
        });
      }

      // 📦 Prepare order with product details
      const enrichedProducts = await Promise.all(
        products.map(async (item) => {
          const product = await Product.findById(item.productId)
            .select("seller name price images")
            .session(session);

          return {
            productId: item.productId,
            name: product.name,
            price: product.price,
            qty: item.qty,
            seller: product.seller,
            image: product.images?.[0]?.url || null
          };
        })
      );

      // ⚡ Update inventory (atomic operation)
      await Promise.all(
        products.map(item =>
          Product.updateOne(
            { _id: item.productId },
            { $inc: { stock: -item.qty } },
            { session }
          )
        )
      );

      // 💾 Create order
      const newOrder = new Order({
        user: userId,
        products: enrichedProducts,
        shipping,
        paymentMethod,
        total,
        status: "processing",
      });

      const savedOrder = await newOrder.save({ session });
      await session.commitTransaction();

      // ✉️ Send confirmation email (fire and forget)
      try {
        await sendOrderConfirmationEmail({
          email: req.user.email,
          orderId: savedOrder._id,
          products: enrichedProducts,
          total,
          shipping,
          estimatedDelivery: new Date(Date.now() + ESTIMATED_DELIVERY_DAYS * 86400000)
        });
      } catch (emailError) {
        logger.error("Failed to send order confirmation email", { error: emailError });
      }

      logger.info(`Order created: ${savedOrder._id}`, { 
        user: userId, 
        total,
        productCount: products.length 
      });

      res.status(201).json({
        success: true,
        orderId: savedOrder._id,
        status: savedOrder.status,
        estimatedDelivery: new Date(Date.now() + ESTIMATED_DELIVERY_DAYS * 86400000),
      });

    } catch (error) {
      await session.abortTransaction();
      logger.error("Order creation failed", { 
        error: error.message,
        stack: error.stack,
        userId: req.user._id
      });
      res.status(500).json({ 
        success: false, 
        message: "Order processing failed. Please try again." 
      });
    } finally {
      session.endSession();
    }
  }
);

// ✅ GET /api/orders/seller - Seller's order dashboard with filters
router.get("/seller", protect, authorize("seller", "admin"), async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { 
      status, 
      page = 1, 
      limit = 10,
      startDate,
      endDate
    } = req.query;

    // Build query
    const query = { 
      "products.seller": sellerId,
      ...(status && ORDER_STATUSES.includes(status) && { status }),
      ...((startDate || endDate) && {
        createdAt: {
          ...(startDate && { $gte: new Date(startDate) }),
          ...(endDate && { $lte: new Date(endDate) })
        }
      })
    };

    const [orders, total, revenue] = await Promise.all([
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Order.countDocuments(query),
      Order.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: "$total" } } }
      ])
    ]);

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      revenue: revenue[0]?.total || 0,
      pages: Math.ceil(total / limit),
      currentPage: Number(page),
      data: orders.map(order => ({
        _id: order._id,
        status: order.status,
        total: order.total,
        createdAt: order.createdAt,
        customer: order.user, // Populated if needed
        products: order.products.filter(p => p.seller.equals(sellerId))
      }))
    });

  } catch (error) {
    logger.error("Seller orders fetch failed", { 
      sellerId: req.user._id,
      error: error.stack 
    });
    res.status(500).json({ 
      success: false, 
      message: "Failed to load orders" 
    });
  }
});

// ✅ GET /api/orders/:id - Get order details
router.get("/:id", protect, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      $or: [
        { user: req.user._id },
        { "products.seller": req.user._id }
      ]
    })
    .populate('user', 'name email')
    .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found or unauthorized"
      });
    }

    // Filter products if seller is viewing
    if (req.user.role === 'seller') {
      order.products = order.products.filter(p => p.seller.equals(req.user._id));
    }

    res.status(200).json({
      success: true,
      order
    });

  } catch (error) {
    logger.error("Order fetch failed", { 
      orderId: req.params.id,
      error: error.message 
    });
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch order details" 
    });
  }
});

// ✅ PATCH /api/orders/:id/status - Update order status
router.patch(
  "/:id/status",
  protect,
  authorize("seller", "admin"),
  [
    body("status")
      .isIn(ORDER_STATUSES)
      .withMessage("Invalid order status")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    try {
      const order = await Order.findOneAndUpdate(
        {
          _id: req.params.id,
          "products.seller": req.user._id
        },
        { status: req.body.status },
        { new: true }
      );

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found or unauthorized"
        });
      }

      res.status(200).json({
        success: true,
        status: order.status
      });

    } catch (error) {
      logger.error("Order status update failed", { 
        orderId: req.params.id,
        error: error.stack 
      });
      res.status(500).json({ 
        success: false, 
        message: "Failed to update order status" 
      });
    }
  }
);

module.exports = router;