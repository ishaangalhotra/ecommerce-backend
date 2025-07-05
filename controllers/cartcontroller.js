const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { CART } = require('../config');
const mongoose = require('mongoose');
const redis = require('../config/redis'); // Assuming Redis is configured

// 🧠 Helper to format and summarize cart (now with caching)
const buildCartSummary = async (userId, items) => {
  const validItems = items.filter(item => item.productId);

  const subtotal = validItems.reduce((sum, item) => {
    const price = item.productId?.discountedPrice ?? item.productId?.price ?? 0;
    return sum + price * item.quantity;
  }, 0);

  const totalSavings = validItems.reduce((sum, item) => {
    if (item.productId?.discountedPrice && item.productId?.price) {
      return sum + (item.productId.price - item.productId.discountedPrice) * item.quantity;
    }
    return sum;
  }, 0);

  const shippingCost = subtotal >= CART.SHIPPING_THRESHOLD ? 0 : CART.SHIPPING_COST;
  const total = subtotal + shippingCost;

  const result = {
    items: validItems.map(item => ({
      _id: item._id,
      productId: item.productId._id,
      quantity: item.quantity,
      product: {
        name: item.productId.name,
        price: item.productId.price,
        discountedPrice: item.productId.discountedPrice,
        image: item.productId.image,
        description: item.productId.description,
        stock: item.productId.stock // Added stock information
      }
    })),
    summary: {
      subtotal,
      totalSavings,
      shippingCost,
      shippingThreshold: CART.SHIPPING_THRESHOLD,
      total,
      itemCount: validItems.length
    }
  };

  // Cache for 5 minutes
  if (redis) {
    await redis.setex(`cart:${userId}`, 300, JSON.stringify(result));
  }

  return result;
};

// 🛒 GET /api/v1/cart - Get cart with details (now with caching and pagination)
exports.getCartDetails = async (req, res) => {
  try {
    // Check cache first
    if (redis) {
      const cachedCart = await redis.get(`cart:${req.user._id}`);
      if (cachedCart) {
        return res.status(200).json({
          success: true,
          data: JSON.parse(cachedCart),
          cached: true
        });
      }
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [cartItems, totalItems] = await Promise.all([
      Cart.find({ userId: req.user._id })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'productId',
          select: 'name price discountedPrice image description stock'
        }),
      Cart.countDocuments({ userId: req.user._id })
    ]);

    const result = await buildCartSummary(req.user._id, cartItems);

    res.status(200).json({
      success: true,
      data: {
        ...result,
        pagination: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit)
        }
      },
      cached: false
    });
  } catch (err) {
    console.error(`[Cart Error] GET /cart for user ${req.user._id}:`, err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cart details',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// 🛒 PUT /api/v1/cart/:productId - Update quantity (now with stock validation)
exports.updateCartItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { quantity } = req.body;
    const { productId } = req.params;

    // Input validation
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, error: 'Invalid product ID' });
    }

    if (typeof quantity !== 'number' || isNaN(quantity) || quantity < 0) {
      await session.abortTransaction();
      return res.status(400).json({ 
        success: false, 
        error: 'Quantity must be a positive number' 
      });
    }

    if (quantity > CART.MAX_QUANTITY) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: `Maximum allowed quantity is ${CART.MAX_QUANTITY}`,
        maxQuantity: CART.MAX_QUANTITY
      });
    }

    // Check product availability
    const product = await Product.findById(productId).session(session);
    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({ 
        success: false, 
        error: 'Product not found' 
      });
    }

    if (quantity > 0 && quantity > product.stock) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        error: `Only ${product.stock} items available`,
        availableStock: product.stock
      });
    }

    // Find or create cart item
    let cartItem = await Cart.findOne({ 
      userId: req.user._id, 
      productId 
    }).session(session);

    // Remove if quantity is 0
    if (quantity <= 0) {
      if (cartItem) {
        await Cart.findByIdAndDelete(cartItem._id).session(session);
      }
      await session.commitTransaction();
      
      // Clear cache
      if (redis) await redis.del(`cart:${req.user._id}`);
      
      return res.status(200).json({
        success: true,
        data: null,
        message: 'Item removed from cart'
      });
    }

    // Update or create
    if (cartItem) {
      cartItem.quantity = quantity;
      await cartItem.save({ session });
    } else {
      cartItem = await Cart.create([{
        userId: req.user._id,
        productId,
        quantity
      }], { session });
    }

    await session.commitTransaction();
    
    // Clear cache
    if (redis) await redis.del(`cart:${req.user._id}`);

    res.status(200).json({
      success: true,
      data: {
        _id: cartItem._id,
        productId: cartItem.productId,
        quantity: cartItem.quantity,
        availableStock: product.stock - quantity
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error(`[Cart Error] PUT /cart/${req.params.productId} for user ${req.user._id}:`, err);
    res.status(500).json({
      success: false,
      error: 'Failed to update cart item',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    session.endSession();
  }
};

// 🛒 DELETE /api/v1/cart/:productId - Remove item (optimized)
exports.removeCartItem = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid product ID' 
      });
    }

    const result = await Cart.findOneAndDelete({
      userId: req.user._id,
      productId
    });

    if (!result) {
      return res.status(404).json({ 
        success: false, 
        error: 'Item not found in cart' 
      });
    }

    // Clear cache
    if (redis) await redis.del(`cart:${req.user._id}`);

    res.status(200).json({
      success: true,
      data: null,
      message: 'Item successfully removed'
    });

  } catch (err) {
    console.error(`[Cart Error] DELETE /cart/${req.params.productId} for user ${req.user._id}:`, err);
    res.status(500).json({
      success: false,
      error: 'Failed to remove item from cart',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};