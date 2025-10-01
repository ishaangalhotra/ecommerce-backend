const express = require('express');
const mongoose = require('mongoose');
const { body, query, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const Cart = require('../models/cart');
const Product = require('../models/Product');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const { hybridProtect } = require('../middleware/hybridAuth');
const { calculateDeliveryFee, estimateDeliveryTime } = require('../utils/delivery');
const { calculateTax } = require('../utils/tax');
const logger = require('../utils/logger');
const redis = require('../config/redis');

// ==================== ROUTERS ====================
// Main cart router
const router = express.Router();
// Sub-router for cart items
const itemsRouter = express.Router({ mergeParams: true });

// ==================== RATE LIMITERS ====================
const cartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: (req) => `cart:${req.ip}:${req.user?.id || req.user?._id || 'guest'}`,
  handler: (req, res) => {
    logger.warn(`Cart rate limit exceeded for ${req.ip}`);
    res.status(429).json({
      success: false,
      error: 'Too many cart requests, please try again later',
      retryAfter: 15 * 60
    });
  }
});

const addItemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many add to cart requests, please slow down' }
});

// ==================== VALIDATION MIDDLEWARE ====================
const validateCartItem = [
  body('productId').isMongoId().withMessage('Valid product ID required'),
  body('quantity').isInt({ min: 1, max: 100 }).withMessage('Quantity must be between 1-100').toInt(),
  body('selectedVariant').optional().isObject().withMessage('Selected variant must be an object'),
  body('customizations').optional().isArray({ max: 10 }).withMessage('Maximum 10 customizations allowed'),
  body('giftWrap').optional().isBoolean().withMessage('Gift wrap must be boolean'),
  body('giftMessage').optional().trim().isLength({ max: 200 }).withMessage('Gift message must be under 200 characters')
];

const validateBulkOperation = [
  body('items').isArray({ min: 1, max: 50 }).withMessage('Items array required (max 50 items)'),
  body('items.*.productId').isMongoId().withMessage('Valid product ID required'),
  body('items.*.quantity').isInt({ min: 0, max: 100 }).withMessage('Quantity must be between 0-100')
];

const validateCoupon = [
  body('couponCode')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Coupon code must be 3-20 characters')
    .matches(/^[A-Z0-9]+$/)
    .withMessage('Coupon code must contain only uppercase letters and numbers')
];

// ==================== MAIN CART ROUTES ====================

/**
 * GET /api/v1/cart - Get user's cart
 */
router.get('/', hybridProtect, cartLimiter, async (req, res) => {
  try {
    const { includeUnavailable = false, deliveryPincode } = req.query;

    // ✅ FIX: Get user ID with proper fallbacks and an explicit auth check.
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }

    // ✅ FIX: Use the validated userId.
    let cart = await Cart.findOne({ user: userId })
      .populate({
        path: 'items.product',
        select: 'name price images stock status seller category discountPercentage maxQuantityPerOrder',
        populate: {
          path: 'seller',
          select: 'name rating verified shopName'
        }
      })
      .lean();

    if (!cart) {
      return res.json({
        success: true,
        data: {
          id: null,
          items: [],
          itemCount: 0,
          pricing: { subtotal: 0, tax: 0, deliveryFee: 0, discount: 0, total: 0 },
          appliedCoupons: [],
          estimatedDeliveryTime: null,
          availableItems: [],
          unavailableItems: [],
          isEmpty: true
        }
      });
    }

    // Process cart items
    const availableItems = [];
    const unavailableItems = [];

    for (const item of cart.items) {
      const product = item.product;

      // Check product availability
      const isAvailable = product &&
                         product.status === 'active' &&
                         product.stock >= item.quantity;

      if (isAvailable) {
        // Apply current discount
        const discountAmount = product.discountPercentage > 0
          ? (product.price * product.discountPercentage / 100) * item.quantity
          : 0;

        availableItems.push({
          ...item,
          product: {
            ...product,
            currentPrice: product.price,
            originalPrice: product.price,
            discountAmount,
            finalPrice: product.price - (discountAmount / item.quantity)
          },
          isAvailable: true,
          availableStock: product.stock,
          maxQuantityAllowed: Math.min(product.stock, product.maxQuantityPerOrder || 100),
          totalPrice: item.priceAtAdd * item.quantity
        });
      } else {
        unavailableItems.push({
          ...item,
          product,
          isAvailable: false,
          unavailableReason: !product ? 'Product removed' :
                           product.status !== 'active' ? 'Product inactive' :
                           'Out of stock',
          totalPrice: item.priceAtAdd * item.quantity
        });
      }
    }

    // ✅ FIX: Use the validated userId.
    const pricing = await calculateCartPricing(
      availableItems,
      cart.appliedCoupons || [],
      deliveryPincode,
      userId
    );

    // Calculate delivery estimation
    let estimatedDeliveryTime = null;
    if (deliveryPincode && availableItems.length > 0) {
      estimatedDeliveryTime = await estimateCartDeliveryTime(
        availableItems,
        deliveryPincode
      );
    }

    // Group items by seller for better organization
    const itemsBySeller = groupItemsBySeller(availableItems);

    // Check for seller-specific offers
    const sellerOffers = await getSellerOffers(availableItems);

    // Get recommended products
    // ✅ FIX: Use the validated userId.
    const recommendations = await getCartRecommendations(availableItems, userId);

    res.json({
      success: true,
      data: {
        id: cart._id,
        items: includeUnavailable ? [...availableItems, ...unavailableItems] : availableItems,
        itemCount: availableItems.reduce((sum, item) => sum + item.quantity, 0),
        pricing,
        appliedCoupons: cart.appliedCoupons || [],
        estimatedDeliveryTime,
        availableItems,
        unavailableItems: includeUnavailable ? unavailableItems : [],
        itemsBySeller,
        sellerOffers,
        recommendations,
        lastUpdated: cart.updatedAt,
        hasUnavailableItems: unavailableItems.length > 0,
        isEmpty: availableItems.length === 0
      }
    });

  } catch (error) {
    logger.error('Get cart error:', error);
    res.status(500).json({ success: false, message: 'Error retrieving cart' });
  }
});

/**
 * DELETE /api/v1/cart/clear - Clear entire cart
 */
router.delete('/clear', hybridProtect, cartLimiter, async (req, res) => {
  try {
    // ✅ FIX: Get user ID with proper fallbacks and an explicit auth check.
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }

    // ✅ FIX: Use the validated userId.
    const cart = await Cart.findOne({ user: userId });

    if (!cart || cart.items.length === 0) {
      return res.json({ success: true, message: 'Cart is already empty' });
    }

    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    cart.items = [];
    cart.appliedCoupons = [];
    cart.updatedAt = new Date();
    await cart.save();

    // ✅ FIX: Use the validated userId.
    await trackCartEvent('cart_cleared', userId, null, itemCount);

    logger.info('Cart cleared', { userId: userId, previousItemCount: itemCount });

    res.json({
      success: true,
      message: 'Cart cleared successfully',
      data: {
        id: cart._id,
        itemCount: 0,
        pricing: { subtotal: 0, tax: 0, deliveryFee: 0, discount: 0, total: 0 }
      }
    });

  } catch (error) {
    logger.error('Clear cart error:', error);
    res.status(500).json({ success: false, message: 'Error clearing cart' });
  }
});

// ==================== CART ITEMS SUB-ROUTES ====================

/**
 * POST /api/v1/cart/items - Add item to cart
 */
itemsRouter.post('/', hybridProtect, addItemLimiter, validateCartItem, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { productId, quantity, selectedVariant = null, customizations = [], giftWrap = false, giftMessage = '' } = req.body;

    // ✅ FIX: Get user ID with proper fallbacks and an explicit auth check.
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }

    const product = await Product.findById(productId).populate('seller', 'name rating verified').lean();

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (product.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Product is not available for purchase' });
    }

    if (product.stock < quantity) {
      return res.status(400).json({ success: false, message: `Only ${product.stock} items available in stock` });
    }

    // ✅ FIX: Use the validated userId.
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({
        user: userId,
        items: []
      });
    }

    const existingItemIndex = cart.items.findIndex(item => item.product.toString() === productId);

    if (existingItemIndex > -1) {
      const existingItem = cart.items[existingItemIndex];
      const newQuantity = existingItem.quantity + quantity;

      if (newQuantity > product.stock) {
        return res.status(400).json({
          success: false,
          message: `Cannot add ${quantity} more. Only ${product.stock - existingItem.quantity} items available`
        });
      }

      existingItem.quantity = newQuantity;
      existingItem.updatedAt = new Date();
    } else {
      cart.items.push({
        product: productId,
        quantity,
        priceAtAdd: product.price,
        selectedVariant: selectedVariant || null,
        customizations: customizations || [],
        giftWrap: giftWrap || false,
        giftMessage: (giftWrap && giftMessage) ? giftMessage : '',
        addedAt: new Date()
      });
    }

    cart.updatedAt = new Date();
    await cart.save();

    await cart.populate({
      path: 'items.product',
      select: 'name price images stock status'
    });

    const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    res.json({
      success: true,
      message: 'Item added to cart successfully',
      data: {
        id: cart._id,
        itemCount,
        cartItemCount: cart.items.length,
        updatedItem: existingItemIndex > -1 ? {
          product: cart.items[existingItemIndex].product,
          quantity: cart.items[existingItemIndex].quantity
        } : {
          product: cart.items[cart.items.length - 1].product,
          quantity: cart.items[cart.items.length - 1].quantity
        }
      }
    });

  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ success: false, message: 'Error adding item to cart: ' + error.message });
  }
});

/**
 * PATCH /api/v1/cart/items/:productId - Update cart item quantity
 */
itemsRouter.patch('/:productId',
  hybridProtect,
  cartLimiter,
  [
    param('productId').isMongoId().withMessage('Valid product ID required'),
    body('quantity').isInt({ min: 0, max: 100 }).withMessage('Quantity must be 0-100').toInt()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const userId = req.user?.id || req.user?._id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required'
        });
      }

      const { productId } = req.params;
      const { quantity } = req.body;

      // Get cart without population first
      const cart = await Cart.findOne({ user: userId });
      
      if (!cart) {
        return res.status(404).json({ success: false, message: 'Cart not found' });
      }

      // Find item with safe null checking
      const itemIndex = cart.items.findIndex(item => {
        if (!item.product) return false;
        return item.product.toString() === productId;
      });

      if (itemIndex === -1) {
        return res.status(404).json({ success: false, message: 'Item not found in cart' });
      }

      // Handle item removal if quantity is 0
      if (quantity === 0) {
        const removedItem = cart.items[itemIndex];
        cart.items.splice(itemIndex, 1);
        await trackCartEvent('item_removed', userId, productId, removedItem.quantity);
      } else {
        // Validate product separately to avoid virtual property issues
        const product = await Product.findById(productId)
          .select('price stock maxQuantityPerOrder status')
          .lean();

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

        const maxQuantity = product.maxQuantityPerOrder || 100;
        if (quantity > maxQuantity) {
          return res.status(400).json({
            success: false,
            message: `Maximum ${maxQuantity} items allowed per order`
          });
        }

        const item = cart.items[itemIndex];
        const oldQuantity = item.quantity;
        item.quantity = quantity;
        item.updatedAt = new Date();
        await trackCartEvent('item_updated', userId, productId, quantity - oldQuantity);
      }

      cart.updatedAt = new Date();
      await cart.save();

      // ✅ CRITICAL FIX: Get fresh cart data with populated products for accurate pricing
      const updatedCart = await Cart.findOne({ user: userId })
        .populate({
          path: 'items.product',
          select: 'name price images stock status seller category discountPercentage',
          populate: {
            path: 'seller',
            select: 'name rating verified shopName'
          }
        })
        .lean();

      if (!updatedCart) {
        return res.status(404).json({ success: false, message: 'Cart not found after update' });
      }

      // ✅ Calculate fresh pricing with the updated cart
      const pricing = await calculateCartPricing(
        updatedCart.items || [],
        updatedCart.appliedCoupons || [],
        req.query.deliveryPincode,
        userId
      );

      const itemCount = updatedCart.items.reduce((sum, item) => sum + (item.quantity || 0), 0);

      res.json({
        success: true,
        message: quantity === 0 ? 'Item removed from cart' : 'Cart updated successfully',
        data: {
          id: updatedCart._id,
          itemCount,
          pricing, // ✅ This ensures fresh pricing is returned
          items: updatedCart.items,
          lastUpdated: updatedCart.updatedAt
        }
      });

    } catch (error) {
      logger.error('Update cart error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error updating cart: ' + error.message 
      });
    }
  });

/**
 * DELETE /api/v1/cart/items/:productId - Remove item from cart
 */
itemsRouter.delete('/:productId', hybridProtect, cartLimiter, async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    // ✅ FIX: Get user ID with proper fallbacks and an explicit auth check.
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }

    // ✅ FIX: Use the validated userId.
    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res.status(404).json({ success: false, message: 'Cart not found' });
    }

    const itemIndex = cart.items.findIndex(item => item.product.toString() === productId);

    if (itemIndex === -1) {
      return res.status(404).json({ success: false, message: 'Item not found in cart' });
    }

    const removedItem = cart.items[itemIndex];
    cart.items.splice(itemIndex, 1);
    cart.updatedAt = new Date();
    await cart.save();

    const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons || []);

    // ✅ FIX: Use the validated userId.
    await trackCartEvent('item_removed', userId, productId, removedItem.quantity);

    res.json({
      success: true,
      message: 'Item removed from cart successfully',
      data: {
        id: cart._id,
        itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
        pricing
      },
      removedItem: { productId, quantity: removedItem.quantity }
    });

  } catch (error) {
    logger.error('Remove from cart error:', error);
    res.status(500).json({ success: false, message: 'Error removing item from cart' });
  }
});

// ==================== BULK OPERATIONS ====================

/**
 * POST /api/v1/cart/bulk - Add multiple items to cart
 */
router.post('/bulk',
  hybridProtect,
  cartLimiter,
  validateBulkOperation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // ✅ FIX: Get user ID with proper fallbacks and an explicit auth check.
      const userId = req.user?.id || req.user?._id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required'
        });
      }

      const { items } = req.body;

      const productIds = items.map(item => item.productId);
      const products = await Product.find({
        _id: { $in: productIds },
        status: 'active'
      }).lean();

      if (products.length !== productIds.length) {
        return res.status(400).json({
          success: false,
          message: 'Some products are not available'
        });
      }

      // ✅ FIX: Use the validated userId.
      let cart = await Cart.findOne({ user: userId });
      if (!cart) {
        cart = new Cart({
          user: userId,
          items: []
        });
      }

      const addedItems = [];
      const failedItems = [];

      for (const item of items) {
        try {
          const product = products.find(p => p._id.toString() === item.productId);

          if (!product) {
            failedItems.push({ ...item, reason: 'Product not found' });
            continue;
          }

          if (product.stock < item.quantity) {
            failedItems.push({ ...item, reason: `Only ${product.stock} items available` });
            continue;
          }

          const existingItemIndex = cart.items.findIndex(cartItem =>
            cartItem.product.toString() === item.productId
          );

          if (existingItemIndex > -1) {
            const existingItem = cart.items[existingItemIndex];
            const newQuantity = existingItem.quantity + item.quantity;

            if (newQuantity > product.stock) {
              failedItems.push({
                ...item,
                reason: `Cannot add ${item.quantity}. Only ${product.stock - existingItem.quantity} more available`
              });
              continue;
            }

            existingItem.quantity = newQuantity;
            existingItem.updatedAt = new Date();
          } else {
            cart.items.push({
              product: item.productId,
              quantity: item.quantity,
              priceAtAdd: product.price,
              selectedVariant: item.selectedVariant || null,
              customizations: item.customizations || [],
              giftWrap: item.giftWrap || false,
              giftMessage: (item.giftWrap && item.giftMessage) ? item.giftMessage : '',
              addedAt: new Date()
            });
          }

          addedItems.push({
            productId: item.productId,
            name: product.name,
            quantity: item.quantity,
            price: product.price
          });

        } catch (itemError) {
          failedItems.push({ ...item, reason: 'Processing error' });
        }
      }

      if (addedItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No items could be added to cart',
          failedItems
        });
      }

      cart.updatedAt = new Date();
      await cart.save();

      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons || []);

      logger.info(`Bulk add to cart completed`, {
        userId: userId,
        addedCount: addedItems.length,
        failedCount: failedItems.length
      });

      res.json({
        success: true,
        message: `${addedItems.length} items added to cart successfully`,
        data: {
          id: cart._id,
          itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
          pricing
        },
        addedItems,
        failedItems: failedItems.length > 0 ? failedItems : undefined
      });

    } catch (error) {
      logger.error('Bulk add to cart error:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding items to cart'
      });
    }
  }
);

// ==================== COUPON MANAGEMENT ====================

/**
 * POST /api/v1/cart/coupons - Apply coupon to cart
 */
router.post('/coupons',
  hybridProtect,
  cartLimiter,
  validateCoupon,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // ✅ FIX: Get user ID with proper fallbacks and an explicit auth check.
      const userId = req.user?.id || req.user?._id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required'
        });
      }

      const { couponCode } = req.body;

      // ✅ FIX: Use the validated userId.
      const cart = await Cart.findOne({ user: userId })
        .populate('items.product', 'price category seller');

      if (!cart || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cart is empty'
        });
      }

      const alreadyApplied = cart.appliedCoupons?.some(coupon =>
        coupon.code.toUpperCase() === couponCode.toUpperCase()
      );

      if (alreadyApplied) {
        return res.status(400).json({
          success: false,
          message: 'Coupon is already applied'
        });
      }

      // ✅ FIX: Use the validated userId.
      const couponResult = await validateAndApplyCoupon(
        couponCode,
        cart.items,
        userId
      );

      if (!couponResult.success) {
        return res.status(400).json({
          success: false,
          message: couponResult.message
        });
      }

      if (!cart.appliedCoupons) {
        cart.appliedCoupons = [];
      }

      cart.appliedCoupons.push({
        code: couponCode.toUpperCase(),
        type: couponResult.coupon.type,
        value: couponResult.coupon.value,
        discountAmount: couponResult.discountAmount,
        appliedAt: new Date()
      });

      cart.updatedAt = new Date();
      await cart.save();

      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons);

      res.json({
        success: true,
        message: 'Coupon applied successfully',
        data: {
          id: cart._id,
          discountAmount: couponResult.discountAmount,
          coupon: {
            code: couponCode.toUpperCase(),
            type: couponResult.coupon.type,
            value: couponResult.coupon.value
          },
          pricing
        }
      });

    } catch (error) {
      logger.error('Apply coupon error:', error);
      res.status(500).json({
        success: false,
        message: 'Error applying coupon'
      });
    }
  }
);

/**
 * DELETE /api/v1/cart/coupons/:couponCode - Remove coupon from cart
 */
router.delete('/coupons/:couponCode',
  hybridProtect,
  cartLimiter,
  async (req, res) => {
    try {
      const { couponCode } = req.params;

      // ✅ FIX: Get user ID with proper fallbacks and an explicit auth check.
      const userId = req.user?.id || req.user?._id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required'
        });
      }

      // ✅ FIX: Use the validated userId.
      const cart = await Cart.findOne({ user: userId });
      if (!cart) {
        return res.status(404).json({
          success: false,
          message: 'Cart not found'
        });
      }

      if (!cart.appliedCoupons || cart.appliedCoupons.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No coupons applied to cart'
        });
      }

      const couponIndex = cart.appliedCoupons.findIndex(coupon =>
        coupon.code.toUpperCase() === couponCode.toUpperCase()
      );

      if (couponIndex === -1) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found in cart'
        });
      }

      cart.appliedCoupons.splice(couponIndex, 1);
      cart.updatedAt = new Date();
      await cart.save();

      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons);

      res.json({
        success: true,
        message: 'Coupon removed successfully',
        data: {
          id: cart._id,
          pricing
        }
      });

    } catch (error) {
      logger.error('Remove coupon error:', error);
      res.status(500).json({
        success: false,
        message: 'Error removing coupon'
      });
    }
  }
);

// ==================== MOUNT SUB-ROUTER ====================
router.use('/items', itemsRouter);

// ==================== HELPER FUNCTIONS ====================
const calculateCartPricing = async (items, coupons, deliveryPincode, userId) => {
  let subtotal = 0;

  // ✅ Safe calculation with null checks
  items.forEach(item => {
    if (item && item.product && item.product.price) {
      subtotal += item.product.price * (item.quantity || 1);
    } else if (item && item.priceAtAdd) {
      // Fallback to priceAtAdd if product is not populated
      subtotal += item.priceAtAdd * (item.quantity || 1);
    }
  });

  const deliveryFee = await calculateDeliveryFee(items, deliveryPincode, userId) ||
                     (subtotal >= 500 ? 0 : 25);

  const tax = calculateTax(subtotal, items);

  let discount = 0;
  if (coupons && coupons.length > 0) {
    coupons.forEach(coupon => {
      discount += coupon.discountAmount || 0;
    });
  }

  discount = Math.min(discount, subtotal);

  const total = Math.max(0, subtotal + deliveryFee + tax - discount);

  const pricing = {
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    deliveryFee: Math.round(deliveryFee * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    total: Math.round(total * 100) / 100
  };

  console.log('💰 Pricing calculated:', pricing);
  return pricing;
};

const estimateCartDeliveryTime = async (items, deliveryPincode) => {
  try {
    if (!items || items.length === 0) return null;

    const deliveryTimes = await Promise.all(
      items.map(async (item) => {
        if (item.product && item.product.seller) {
          return await estimateDeliveryTime(
            item.product.seller._id || item.product.seller,
            deliveryPincode
          );
        }
        return null;
      })
    );

    const validTimes = deliveryTimes.filter(time => time !== null);
    if (validTimes.length === 0) return null;

    return Math.max(...validTimes);
  } catch (error) {
    logger.warn('Error estimating delivery time:', error);
    return null;
  }
};

const groupItemsBySeller = (items) => {
  const grouped = {};

  items.forEach(item => {
    if (item.product && item.product.seller) {
      const sellerId = item.product.seller._id || item.product.seller;
      const sellerName = item.product.seller.name || 'Unknown Seller';

      if (!grouped[sellerId]) {
        grouped[sellerId] = {
          seller: {
            id: sellerId,
            name: sellerName,
            rating: item.product.seller.rating,
            verified: item.product.seller.verified,
            shopName: item.product.seller.shopName
          },
          items: []
        };
      }

      grouped[sellerId].items.push(item);
    }
  });

  return Object.values(grouped);
};

const getSellerOffers = async (items) => {
  try {
    const sellerIds = [...new Set(items.map(item => {
      // Add comprehensive null checking
      if (!item.product || !item.product.seller) return null;
      return item.product.seller._id || item.product.seller;
    }).filter(id => id && id !== null))];

    if (sellerIds.length === 0) return [];

    return sellerIds.map(sellerId => ({
      sellerId,
      offer: 'Free shipping on orders above ₹499',
      minOrder: 499
    })).filter(offer => offer !== null);

  } catch (error) {
    logger.warn('Error getting seller offers:', error);
    return [];
  }
};

const getCartRecommendations = async (items, userId) => {
  try {
    if (!items || items.length === 0) return [];

    const categories = [...new Set(items.map(item =>
      item.product.category
    ).filter(cat => cat))];

    if (categories.length === 0) return [];

    const recommendations = await Product.find({
      category: { $in: categories },
      status: 'active',
      stock: { $gt: 0 },
      _id: { $nin: items.map(item => item.product._id) }
    })
    .select('name price images category discountPercentage')
    .limit(4)
    .lean();

    return recommendations;

  } catch (error) {
    logger.warn('Error getting cart recommendations:', error);
    return [];
  }
};

const validateAndApplyCoupon = async (couponCode, cartItems, userId) => {
  try {
    const coupon = await Coupon.findOne({
      code: couponCode.toUpperCase(),
      isActive: true,
      startDate: { $lte: new Date() },
      $or: [
        { endDate: { $gte: new Date() } },
        { endDate: null }
      ]
    });

    if (!coupon) {
      return { success: false, message: 'Invalid or expired coupon' };
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return { success: false, message: 'Coupon usage limit reached' };
    }

    if (coupon.onePerUser) {
      const userUsage = await Cart.findOne({
        user: userId,
        'appliedCoupons.code': couponCode.toUpperCase()
      });

      if (userUsage) {
        return { success: false, message: 'You have already used this coupon' };
      }
    }

    const subtotal = cartItems.reduce((sum, item) => {
      if (item.product && item.product.price) {
        return sum + (item.product.price * item.quantity);
      }
      return sum;
    }, 0);

    if (coupon.minOrderValue && subtotal < coupon.minOrderValue) {
      return {
        success: false,
        message: `Minimum order value of ₹${coupon.minOrderValue} required`
      };
    }

    let discountAmount = 0;

    if (coupon.type === 'percentage') {
      discountAmount = (subtotal * coupon.value) / 100;
      if (coupon.maxDiscount) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      }
    } else if (coupon.type === 'fixed') {
      discountAmount = Math.min(coupon.value, subtotal);
    }

    return {
      success: true,
      coupon,
      discountAmount
    };

  } catch (error) {
    logger.error('Coupon validation error:', error);
    return { success: false, message: 'Error validating coupon' };
  }
};

const trackCartEvent = async (action, userId, productId, quantity) => {
  try {
    const event = { action, userId, productId, quantity, timestamp: new Date() };
    
    // Check if redis is properly configured
    if (redis && typeof redis.lpush === 'function') {
      await redis.lpush('cart_events', JSON.stringify(event));
      await redis.ltrim('cart_events', 0, 9999);
    } else {
      // Fallback to logging if Redis is not available
      logger.info('Cart event tracked', { action, userId, productId, quantity });
    }
  } catch (error) {
    logger.warn('Failed to track cart event', { error: error.message });
  }
};

module.exports = router;