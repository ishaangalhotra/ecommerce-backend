const Cart = require('../models/Cart');
const Product = require('../models/Product');
const asyncHandler = require('../middleware/asyncHandlerHandlerHandler');
const ErrorResponse = require('../utils/errorResponse');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const { createAuditLog } = require('../services/auditService');

// Configuration Constants
const CART_CONFIG = {
  MAX_ITEMS: 50,
  MAX_QUANTITY_PER_ITEM: 100,
  CACHE_TTL: 300, // 5 minutes
  PRICE_PRECISION: 2
};

/**
 * @desc    Get user's cart with comprehensive data
 * @route   GET /api/v1/cart
 * @access  Private
 */
exports.getCart = asyncHandler(async (req, res) => {
  try {
    // Check cache first
    const cacheKey = `cart:${req.user.id}`;
    const cachedCart = await getCachedData(cacheKey);
    
    if (cachedCart) {
      return res.status(200).json(cachedCart);
    }

    const cart = await Cart.findOne({ user: req.user.id })
      .populate({
        path: 'items.product',
        select: 'name price images stock status seller discountPercentage',
        populate: {
          path: 'seller',
          select: 'name rating verified'
        }
      })
      .lean();

    if (!cart) {
      const response = {
        success: true,
        data: {
          items: [],
          itemCount: 0,
          subtotal: 0,
          total: 0,
          isEmpty: true
        }
      };
      return res.status(200).json(response);
    }

    // Filter out unavailable products and calculate totals
    const availableItems = [];
    const unavailableItems = [];
    let subtotal = 0;

    cart.items.forEach(item => {
      if (item.product && item.product.status === 'active' && item.product.stock >= item.quantity) {
        const itemTotal = item.product.price * item.quantity;
        const discountAmount = item.product.discountPercentage > 0 
          ? (itemTotal * item.product.discountPercentage / 100) 
          : 0;
        
        availableItems.push({
          ...item,
          itemTotal,
          discountAmount,
          finalPrice: itemTotal - discountAmount
        });
        
        subtotal += itemTotal - discountAmount;
      } else {
        unavailableItems.push({
          ...item,
          unavailableReason: !item.product ? 'Product removed' :
                           item.product.status !== 'active' ? 'Product inactive' :
                           'Insufficient stock'
        });
      }
    });

    // Calculate delivery and tax
    const deliveryFee = calculateDeliveryFee(subtotal);
    const tax = calculateTax(subtotal);
    const total = subtotal + deliveryFee + tax;

    const response = {
      success: true,
      data: {
        items: availableItems,
        unavailableItems,
        itemCount: availableItems.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: parseFloat(subtotal.toFixed(CART_CONFIG.PRICE_PRECISION)),
        deliveryFee: parseFloat(deliveryFee.toFixed(CART_CONFIG.PRICE_PRECISION)),
        tax: parseFloat(tax.toFixed(CART_CONFIG.PRICE_PRECISION)),
        total: parseFloat(total.toFixed(CART_CONFIG.PRICE_PRECISION)),
        isEmpty: availableItems.length === 0,
        hasUnavailableItems: unavailableItems.length > 0
      }
    };

    // Cache the result
    await setCachedData(cacheKey, response, CART_CONFIG.CACHE_TTL);

    res.status(200).json(response);

  } catch (error) {
    logger.error('Get cart error', {
      userId: req.user.id,
      error: error.message
    });
    throw error;
  }
});

/**
 * @desc    Add item to cart with validation
 * @route   POST /api/v1/cart
 * @access  Private
 */
exports.addToCart = asyncHandler(async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { productId, quantity = 1 } = req.body;

    // Validate quantity
    if (quantity > CART_CONFIG.MAX_QUANTITY_PER_ITEM) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${CART_CONFIG.MAX_QUANTITY_PER_ITEM} items allowed per product`
      });
    }

    // Get product details
    const product = await Product.findById(productId).lean();
    if (!product) {
      return next(new ErrorResponse(`Product not found with id of ${productId}`, 404));
    }

    // Check product availability
    if (product.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Product is not available for purchase'
      });
    }

    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} items available in stock`
      });
    }

    // Find or create cart
    let cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      cart = await Cart.create({ user: req.user.id, items: [] });
    }

    // Check cart item limit
    if (cart.items.length >= CART_CONFIG.MAX_ITEMS) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${CART_CONFIG.MAX_ITEMS} different items allowed in cart`
      });
    }

    // Check if item already exists
    const itemIndex = cart.items.findIndex(item =>
      item.product.toString() === productId
    );

    if (itemIndex >= 0) {
      const newQuantity = cart.items[itemIndex].quantity + quantity;
      
      if (newQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Cannot add ${quantity} more. Only ${product.stock - cart.items[itemIndex].quantity} items available`
        });
      }

      cart.items[itemIndex].quantity = newQuantity;
      cart.items[itemIndex].updatedAt = new Date();
    } else {
      cart.items.push({
        product: productId,
        quantity,
        price: product.price,
        addedAt: new Date()
      });
    }

    cart.updatedAt = new Date();
    await cart.save();

    // Clear cache
    await clearCartCache(req.user.id);

    // Track analytics
    await trackCartEvent('item_added', req.user.id, productId, quantity);

    logger.info('Item added to cart', {
      userId: req.user.id,
      productId,
      quantity,
      productName: product.name
    });

    res.status(200).json({
      success: true,
      message: 'Item added to cart successfully',
      data: {
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      }
    });

  } catch (error) {
    logger.error('Add to cart error', {
      userId: req.user.id,
      productId: req.body.productId,
      error: error.message
    });
    throw error;
  }
});

/**
 * @desc    Update cart item quantity with validation
 * @route   PUT /api/v1/cart/:productId
 * @access  Private
 */
exports.updateCartItem = asyncHandler(async (req, res, next) => {
  try {
    const { quantity } = req.body;
    const { productId } = req.params;

    // Validate quantity
    if (quantity < 0 || quantity > CART_CONFIG.MAX_QUANTITY_PER_ITEM) {
      return res.status(400).json({
        success: false,
        message: `Quantity must be between 0 and ${CART_CONFIG.MAX_QUANTITY_PER_ITEM}`
      });
    }

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return next(new ErrorResponse('Cart not found', 404));
    }

    const itemIndex = cart.items.findIndex(
      item => item.product.toString() === productId
    );

    if (itemIndex === -1) {
      return next(new ErrorResponse('Item not found in cart', 404));
    }

    // If quantity is 0, remove item
    if (quantity === 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      // Validate stock availability
      const product = await Product.findById(productId).select('stock status').lean();
      if (!product || product.status !== 'active') {
        return res.status(400).json({
          success: false,
          message: 'Product is no longer available'
        });
      }

      if (product.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} items available in stock`
        });
      }

      cart.items[itemIndex].quantity = quantity;
      cart.items[itemIndex].updatedAt = new Date();
    }

    cart.updatedAt = new Date();
    await cart.save();

    // Clear cache
    await clearCartCache(req.user.id);

    // Track analytics
    await trackCartEvent(quantity === 0 ? 'item_removed' : 'item_updated', req.user.id, productId, quantity);

    logger.info('Cart item updated', {
      userId: req.user.id,
      productId,
      quantity,
      action: quantity === 0 ? 'removed' : 'updated'
    });

    res.status(200).json({
      success: true,
      message: quantity === 0 ? 'Item removed from cart' : 'Cart item updated successfully',
      data: {
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      }
    });

  } catch (error) {
    logger.error('Update cart item error', {
      userId: req.user.id,
      productId: req.params.productId,
      error: error.message
    });
    throw error;
  }
});

/**
 * @desc    Remove item from cart
 * @route   DELETE /api/v1/cart/:productId
 * @access  Private
 */
exports.removeFromCart = asyncHandler(async (req, res, next) => {
  try {
    const { productId } = req.params;

    const cart = await Cart.findOne({ user: req.user.id });
    if (!cart) {
      return next(new ErrorResponse('Cart not found', 404));
    }

    const initialLength = cart.items.length;
    cart.items = cart.items.filter(
      item => item.product.toString() !== productId
    );

    if (cart.items.length === initialLength) {
      return next(new ErrorResponse('Item not found in cart', 404));
    }

    cart.updatedAt = new Date();
    await cart.save();

    // Clear cache
    await clearCartCache(req.user.id);

    // Track analytics
    await trackCartEvent('item_removed', req.user.id, productId, 0);

    logger.info('Item removed from cart', {
      userId: req.user.id,
      productId
    });

    res.status(200).json({
      success: true,
      message: 'Item removed from cart successfully',
      data: {
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
      }
    });

  } catch (error) {
    logger.error('Remove from cart error', {
      userId: req.user.id,
      productId: req.params.productId,
      error: error.message
    });
    throw error;
  }
});

/**
 * @desc    Clear entire cart
 * @route   DELETE /api/v1/cart
 * @access  Private
 */
exports.clearCart = asyncHandler(async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id });
    
    if (!cart) {
      return res.status(200).json({
        success: true,
        message: 'Cart is already empty',
        data: {}
      });
    }

    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    
    await Cart.findOneAndDelete({ user: req.user.id });

    // Clear cache
    await clearCartCache(req.user.id);

    // Track analytics
    await trackCartEvent('cart_cleared', req.user.id, null, itemCount);

    logger.info('Cart cleared', {
      userId: req.user.id,
      itemsCleared: itemCount
    });

    res.status(200).json({
      success: true,
      message: 'Cart cleared successfully',
      data: {}
    });

  } catch (error) {
    logger.error('Clear cart error', {
      userId: req.user.id,
      error: error.message
    });
    throw error;
  }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate delivery fee based on cart total
 */
const calculateDeliveryFee = (subtotal) => {
  if (subtotal >= 500) return 0; // Free delivery above ₹500
  return 25; // Standard delivery fee
};

/**
 * Calculate tax (18% GST)
 */
const calculateTax = (subtotal) => {
  return subtotal * 0.18;
};

/**
 * Cache management functions
 */
const getCachedData = async (key) => {
  if (!redis) return null;
  try {
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.warn('Cache get failed', { error: error.message });
    return null;
  }
};

const setCachedData = async (key, data, ttl) => {
  if (!redis) return;
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
  } catch (error) {
    logger.warn('Cache set failed', { error: error.message });
  }
};

const clearCartCache = async (userId) => {
  if (!redis) return;
  try {
    await redis.del(`cart:${userId}`);
  } catch (error) {
    logger.warn('Cache clear failed', { error: error.message });
  }
};

/**
 * Track cart analytics
 */
const trackCartEvent = async (action, userId, productId, quantity) => {
  try {
    const event = {
      action,
      userId,
      productId,
      quantity,
      timestamp: new Date()
    };

    if (redis) {
      await redis.lpush('cart_events', JSON.stringify(event));
      await redis.ltrim('cart_events', 0, 9999); // Keep last 10k events
    }
  } catch (error) {
    logger.warn('Failed to track cart event', { error: error.message });
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart
};
