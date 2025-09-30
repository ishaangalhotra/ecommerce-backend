const { couponLimiter } = require('../middleware/rateLimiters');
const express = require('express');
const mongoose = require('mongoose');
// MODIFIED: Added 'param' for route parameter validation
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
// const { io } = require('../app'); // Assuming io is exported from your main app file

const router = express.Router();

// Enhanced rate limiting
const cartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window (higher for cart operations)
  keyGenerator: (req) => `cart:${req.ip}:${req.user?.id || 'guest'}`,
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
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 add operations per minute
  message: { error: 'Too many add to cart requests, please slow down' }
});

// Validation middleware
const validateCartItem = [
  body('productId')
    .isMongoId()
    .withMessage('Valid product ID required'),
  
  body('quantity')
    .isInt({ min: 1, max: 100 })
    .withMessage('Quantity must be between 1-100')
    .toInt(),
  
  body('selectedVariant')
    .optional()
    .isObject()
    .withMessage('Selected variant must be an object'),
  
  body('customizations')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Maximum 10 customizations allowed'),
  
  body('giftWrap')
    .optional()
    .isBoolean()
    .withMessage('Gift wrap must be boolean'),
  
  body('giftMessage')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Gift message must be under 200 characters')
];

const validateBulkOperation = [
  body('items')
    .isArray({ min: 1, max: 50 })
    .withMessage('Items array required (max 50 items)'),
  
  body('items.*.productId')
    .isMongoId()
    .withMessage('Valid product ID required'),
  
  body('items.*.quantity')
    .isInt({ min: 0, max: 100 })
    .withMessage('Quantity must be between 0-100')
];

const validateCoupon = [
  body('couponCode')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Coupon code must be 3-20 characters')
    .matches(/^[A-Z0-9]+$/)
    .withMessage('Coupon code must contain only uppercase letters and numbers')
];

// ==================== CART MANAGEMENT ROUTES ====================

/**
 * @swagger
 * /cart:
 *   get:
 *     summary: Get user's cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: includeUnavailable
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include unavailable items in response
 *       - in: query
 *         name: deliveryPincode
 *         schema:
 *           type: string
 *         description: Pincode for delivery estimation
 *     responses:
 *       200:
 *         description: Cart details with pricing breakdown
 */
router.get('/',
  hybridProtect,
  cartLimiter,
  async (req, res) => {
    try {
      const { includeUnavailable = false, deliveryPincode } = req.query;

      // Get cart with populated products
      let cart = await Cart.findOne({ user: req.user.id })
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
            pricing: {
              subtotal: 0,
              tax: 0,
              deliveryFee: 0,
              discount: 0,
              total: 0
            },
            appliedCoupons: [],
            estimatedDeliveryTime: null,
            availableItems: [],
            unavailableItems: [],
            isEmpty: true
          }
        });
      }

      // Separate available and unavailable items
      const availableItems = [];
      const unavailableItems = [];
      let hasChanges = false;

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
            totalPrice: item.priceAtAdd * item.quantity // Calculate dynamically
          });
        } else {
          unavailableItems.push({
            ...item,
            product,
            isAvailable: false,
            unavailableReason: !product ? 'Product removed' :
                             product.status !== 'active' ? 'Product inactive' :
                             'Out of stock',
            totalPrice: item.priceAtAdd * item.quantity // Calculate dynamically
          });
        }
      }

      // Calculate pricing for available items
      const pricing = await calculateCartPricing(
        availableItems, 
        cart.appliedCoupons || [],
        deliveryPincode,
        req.user.id
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
      const recommendations = await getCartRecommendations(availableItems, req.user.id);

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
      res.status(500).json({
        success: false,
        message: 'Error retrieving cart'
      });
    }
  }
);

/**
 * @swagger
 * /cart/items:
 *   post:
 *     summary: Add item to cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *               - quantity
 *             properties:
 *               productId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *               selectedVariant:
 *                 type: object
 *               customizations:
 *                 type: array
 *               giftWrap:
 *                 type: boolean
 *               giftMessage:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item added to cart successfully
 */
// FIXED: Changed from '/' to '/items' to avoid conflict with GET /cart
router.post('/items',
  hybridProtect,
  addItemLimiter,
  validateCartItem,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const {
        productId,
        quantity,
        selectedVariant,
        customizations = [],
        giftWrap = false,
        giftMessage = ''
      } = req.body;

      // Validate product availability
      const product = await Product.findById(productId)
        .populate('seller', 'name rating verified')
        .lean();

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

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

      // Check maximum quantity per order
      const maxQuantity = product.maxQuantityPerOrder || 100;
      if (quantity > maxQuantity) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${maxQuantity} items allowed per order`
        });
      }

      // Find or create cart
      let cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        cart = new Cart({ user: req.user.id, items: [] });
      }

      // Check if item already exists in cart
      const existingItemIndex = cart.items.findIndex(item => 
        item.product.toString() === productId &&
        JSON.stringify(item.selectedVariant) === JSON.stringify(selectedVariant)
      );

      if (existingItemIndex > -1) {
        // Update existing item
        const existingItem = cart.items[existingItemIndex];
        const newQuantity = existingItem.quantity + quantity;

        // Check total quantity doesn't exceed stock or max limit
        if (newQuantity > product.stock) {
          return res.status(400).json({
            success: false,
            message: `Cannot add ${quantity} more. Only ${product.stock - existingItem.quantity} items available`
          });
        }

        if (newQuantity > maxQuantity) {
          return res.status(400).json({
            success: false,
            message: `Cannot add ${quantity} more. Maximum ${maxQuantity} items allowed per order`
          });
        }

        // FIXED: Only update quantity and timestamp
        existingItem.quantity = newQuantity;
        existingItem.updatedAt = new Date();
      } else {
        // Add new item - FIXED: Use correct schema fields
        cart.items.push({
          product: productId,
          quantity,
          priceAtAdd: product.price, // Use priceAtAdd as per schema
          selectedVariant,
          customizations,
          giftWrap,
          giftMessage: giftWrap ? giftMessage : '',
          addedAt: new Date()
        });
      }

      // Update cart totals
      cart.updatedAt = new Date();
      await cart.save();

      // Populate for response
      await cart.populate({
        path: 'items.product',
        select: 'name price images stock status discountPercentage',
        populate: {
          path: 'seller',
          select: 'name rating verified'
        }
      });

      // Calculate updated pricing
      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons || []);

      // Emit real-time event
      // io.to(`user-${req.user.id}`).emit('cart-updated', {
      //   action: 'item-added',
      //   productId,
      //   quantity,
      //   itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      //   total: pricing.total
      // });

      // Track analytics
      await trackCartEvent('item_added', req.user.id, productId, quantity);

      logger.info(`Item added to cart: ${product.name}`, {
        userId: req.user.id,
        productId,
        quantity,
        cartItemCount: cart.items.length
      });

      res.json({
        success: true,
        message: 'Item added to cart successfully',
        data: {
          id: cart._id,
          itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
          pricing
        },
        addedItem: {
          productId,
          name: product.name,
          quantity,
          price: product.price
        }
      });

    } catch (error) {
      logger.error('Add to cart error:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding item to cart'
      });
    }
  }
);

/**
 * @swagger
 * /cart/items/{productId}:
 *   patch:
 *     summary: Update cart item quantity
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - quantity
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *     responses:
 *       200:
 *         description: Cart item updated successfully
 */
// FIXED: Changed from '/:productId' to '/items/:productId' to avoid conflicts
router.patch('/items/:productId',
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
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { productId } = req.params;
      const { quantity } = req.body;

      const cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        return res.status(404).json({
          success: false,
          message: 'Cart not found'
        });
      }

      const itemIndex = cart.items.findIndex(item => 
        item.product.toString() === productId
      );

      if (itemIndex === -1) {
        return res.status(404).json({
          success: false,
          message: 'Item not found in cart'
        });
      }

      // If quantity is 0, remove item
      if (quantity === 0) {
        const removedItem = cart.items[itemIndex];
        cart.items.splice(itemIndex, 1);
        
        // Track removal
        await trackCartEvent('item_removed', req.user.id, productId, removedItem.quantity);
        
        logger.info(`Item removed from cart`, {
          userId: req.user.id,
          productId
        });
      } else {
        // Validate product availability for new quantity
        const product = await Product.findById(productId).select('stock maxQuantityPerOrder status');
        
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

        // Update item - FIXED: Don't store totalPrice
        const item = cart.items[itemIndex];
        const oldQuantity = item.quantity;
        item.quantity = quantity;
        item.updatedAt = new Date();

        // Track update
        await trackCartEvent('item_updated', req.user.id, productId, quantity - oldQuantity);
      }

      cart.updatedAt = new Date();
      await cart.save();

      // Calculate updated pricing
      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons || []);

      // Emit real-time event
      // io.to(`user-${req.user.id}`).emit('cart-updated', {
      //   action: quantity === 0 ? 'item-removed' : 'item-updated',
      //   productId,
      //   quantity,
      //   itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      //   total: pricing.total
      // });

      res.json({
        success: true,
        message: quantity === 0 ? 'Item removed from cart' : 'Cart updated successfully',
        data: {
          id: cart._id,
          itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
          pricing
        }
      });

    } catch (error) {
      logger.error('Update cart error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating cart'
      });
    }
  }
);

/**
 * @swagger
 * /cart/items/{productId}:
 *   delete:
 *     summary: Remove item from cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item removed from cart successfully
 */
// FIXED: Changed from '/:productId' to '/items/:productId' to avoid conflicts
router.delete('/items/:productId',
  hybridProtect,
  cartLimiter,
  async (req, res) => {
    try {
      const { productId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid product ID'
        });
      }

      const cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        return res.status(404).json({
          success: false,
          message: 'Cart not found'
        });
      }

      const itemIndex = cart.items.findIndex(item => 
        item.product.toString() === productId
      );

      if (itemIndex === -1) {
        return res.status(404).json({
          success: false,
          message: 'Item not found in cart'
        });
      }

      const removedItem = cart.items[itemIndex];
      cart.items.splice(itemIndex, 1);
      cart.updatedAt = new Date();
      await cart.save();

      // Calculate updated pricing
      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons || []);

      // Emit real-time event
      // io.to(`user-${req.user.id}`).emit('cart-updated', {
      //   action: 'item-removed',
      //   productId,
      //   itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      //   total: pricing.total
      // });

      // Track analytics
      await trackCartEvent('item_removed', req.user.id, productId, removedItem.quantity);

      logger.info(`Item removed from cart`, {
        userId: req.user.id,
        productId
      });

      res.json({
        success: true,
        message: 'Item removed from cart successfully',
        data: {
          id: cart._id,
          itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
          pricing
        },
        removedItem: {
          productId,
          quantity: removedItem.quantity
        }
      });

    } catch (error) {
      logger.error('Remove from cart error:', error);
      res.status(500).json({
        success: false,
        message: 'Error removing item from cart'
      });
    }
  }
);

/**
 * @swagger
 * /cart/clear:
 *   delete:
 *     summary: Clear entire cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart cleared successfully
 */
// FIXED: Changed from '/' to '/clear' to avoid conflict with other DELETE routes
router.delete('/clear',
  hybridProtect,
  cartLimiter,
  async (req, res) => {
    try {
      const cart = await Cart.findOne({ user: req.user.id });
      
      if (!cart || cart.items.length === 0) {
        return res.json({
          success: true,
          message: 'Cart is already empty'
        });
      }

      const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
      
      cart.items = [];
      cart.appliedCoupons = [];
      cart.updatedAt = new Date();
      await cart.save();

      // Emit real-time event
      // io.to(`user-${req.user.id}`).emit('cart-updated', {
      //   action: 'cart-cleared',
      //   itemCount: 0,
      //   total: 0
      // });

      // Track analytics
      await trackCartEvent('cart_cleared', req.user.id, null, itemCount);

      logger.info(`Cart cleared`, {
        userId: req.user.id,
        previousItemCount: itemCount
      });

      res.json({
        success: true,
        message: 'Cart cleared successfully',
        data: {
          id: cart._id,
          itemCount: 0,
          pricing: {
            subtotal: 0,
            tax: 0,
            deliveryFee: 0,
            discount: 0,
            total: 0
          }
        }
      });

    } catch (error) {
      logger.error('Clear cart error:', error);
      res.status(500).json({
        success: false,
        message: 'Error clearing cart'
      });
    }
  }
);

// ==================== BULK OPERATIONS ====================

/**
 * @swagger
 * /cart/bulk:
 *   post:
 *     summary: Add multiple items to cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Items added to cart successfully
 */
router.post('/bulk',
  hybridProtect,
  cartLimiter,
  validateBulkOperation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { items } = req.body;
      
      // Validate all products exist and are available
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

      // Find or create cart
      let cart = await Cart.findOne({ user: req.user.id });
      if (!cart) {
        cart = new Cart({ user: req.user.id, items: [] });
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

          // Check if item already exists
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

            // FIXED: Only update quantity
            existingItem.quantity = newQuantity;
            existingItem.updatedAt = new Date();
          } else {
            // FIXED: Use correct schema fields
            cart.items.push({
              product: item.productId,
              quantity: item.quantity,
              priceAtAdd: product.price,
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

      // Calculate updated pricing
      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons || []);

      // Emit real-time event
      // io.to(`user-${req.user.id}`).emit('cart-updated', {
      //   action: 'bulk-add',
      //   addedCount: addedItems.length,
      //   itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      //   total: pricing.total
      // });

      logger.info(`Bulk add to cart completed`, {
        userId: req.user.id,
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
 * @swagger
 * /cart/coupons:
 *   post:
 *     summary: Apply coupon to cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - couponCode
 *             properties:
 *               couponCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Coupon applied successfully
 */
// FIXED: Changed from '/coupon' to '/coupons' for better REST structure
router.post('/coupons',
  hybridProtect,
  cartLimiter,
  validateCoupon,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { couponCode } = req.body;

      const cart = await Cart.findOne({ user: req.user.id })
        .populate('items.product', 'price category seller');

      if (!cart || cart.items.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cart is empty'
        });
      }

      // Check if coupon is already applied
      const alreadyApplied = cart.appliedCoupons?.some(coupon => 
        coupon.code.toUpperCase() === couponCode.toUpperCase()
      );

      if (alreadyApplied) {
        return res.status(400).json({
          success: false,
          message: 'Coupon is already applied'
        });
      }

      // Validate and apply coupon
      const couponResult = await validateAndApplyCoupon(
        couponCode,
        cart.items,
        req.user.id
      );

      if (!couponResult.success) {
        return res.status(400).json({
          success: false,
          message: couponResult.message
        });
      }

      // Add coupon to cart
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

      // Calculate updated pricing with coupon
      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons);

      // Emit real-time event
      // io.to(`user-${req.user.id}`).emit('cart-updated', {
      //   action: 'coupon-applied',
      //   couponCode: couponCode.toUpperCase(),
      //   discountAmount: couponResult.discountAmount,
      //   total: pricing.total
      // });

      logger.info(`Coupon applied: ${couponCode}`, {
        userId: req.user.id,
        couponCode,
        discountAmount: couponResult.discountAmount
      });

      res.json({
        success: true,
        message: `Coupon ${couponCode.toUpperCase()} applied successfully`,
        coupon: {
          code: couponCode.toUpperCase(),
          discountAmount: couponResult.discountAmount,
          type: couponResult.coupon.type,
          value: couponResult.coupon.value
        },
        pricing
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
 * @swagger
 * /cart/coupons:
 *   delete:
 *     summary: Remove coupon from cart
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - couponCode
 *             properties:
 *               couponCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Coupon removed successfully
 */
// FIXED: Changed from '/coupon' to '/coupons' for consistency
router.delete('/coupons',
  hybridProtect,
  cartLimiter,
  validateCoupon,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { couponCode } = req.body;

      const cart = await Cart.findOne({ user: req.user.id });
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
        return res.status(400).json({
          success: false,
          message: 'Coupon not found in cart'
        });
      }

      const removedCoupon = cart.appliedCoupons[couponIndex];
      cart.appliedCoupons.splice(couponIndex, 1);
      cart.updatedAt = new Date();
      await cart.save();

      // Calculate updated pricing without coupon
      const pricing = await calculateCartPricing(cart.items, cart.appliedCoupons);

      // Emit real-time event
      // io.to(`user-${req.user.id}`).emit('cart-updated', {
      //   action: 'coupon-removed',
      //   couponCode: couponCode.toUpperCase(),
      //   total: pricing.total
      // });

      logger.info(`Coupon removed: ${couponCode}`, {
        userId: req.user.id,
        couponCode
      });

      res.json({
        success: true,
        message: `Coupon ${couponCode.toUpperCase()} removed successfully`,
        removedCoupon: {
          code: removedCoupon.code,
          discountAmount: removedCoupon.discountAmount
        },
        pricing
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

// ==================== CART ANALYSIS & RECOMMENDATIONS ====================

/**
 * @swagger
 * /cart/analysis:
 *   get:
 *     summary: Get cart analysis and recommendations
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cart analysis with recommendations
 */
router.get('/analysis',
  hybridProtect,
  cartLimiter,
  async (req, res) => {
    try {
      const cart = await Cart.findOne({ user: req.user.id })
        .populate('items.product', 'name price category seller tags averageRating');

      if (!cart || cart.items.length === 0) {
        return res.json({
          success: true,
          data: {
            isEmpty: true,
            message: 'Your cart is empty. Start shopping to see recommendations!'
          }
        });
      }

      // Analyze cart composition
      const analysis = await analyzeCart(cart.items, req.user.id);

      // Get personalized recommendations
      const recommendations = await getCartRecommendations(cart.items, req.user.id);

      // Check for potential savings
      const savingsOpportunities = await findSavingsOpportunities(cart.items);

      // Calculate delivery optimization suggestions
      const deliveryOptimization = await getDeliveryOptimization(cart.items);

      res.json({
        success: true,
        data: {
          ...analysis,
          recommendations,
          savingsOpportunities,
          deliveryOptimization
        }
      });

    } catch (error) {
      logger.error('Cart analysis error:', error);
      res.status(500).json({
        success: false,
        message: 'Error analyzing cart'
      });
    }
  }
);

// ==================== HELPER FUNCTIONS ====================

async function calculateCartPricing(items, appliedCoupons = [], deliveryPincode = null, userId = null) {
  // FIXED: Calculate subtotal using priceAtAdd
  const subtotal = items.reduce((sum, item) => {
    const itemPrice = item.priceAtAdd || item.price || (item.product && item.product.price) || 0;
    return sum + (itemPrice * item.quantity);
  }, 0);
  
  // Calculate tax
  const taxAmount = await calculateTax(subtotal, items);
  
  // Calculate delivery fee
  let deliveryFee = 0;
  if (deliveryPincode) {
    deliveryFee = await calculateDeliveryFee({ pincode: deliveryPincode }, subtotal);
  }
  
  // Apply coupons
  const totalDiscount = appliedCoupons.reduce((sum, coupon) => sum + coupon.discountAmount, 0);
  
  const total = subtotal + taxAmount + deliveryFee - totalDiscount;
  
  return {
    subtotal,
    tax: taxAmount,
    deliveryFee,
    discount: totalDiscount,
    total: Math.max(total, 0),
    breakdown: {
      itemsTotal: subtotal,
      taxes: taxAmount,
      delivery: deliveryFee,
      coupons: -totalDiscount,
      finalTotal: Math.max(total, 0)
    }
  };
}

function groupItemsBySeller(items) {
  const grouped = {};
  
  items.forEach(item => {
    const sellerId = item.product?.seller?._id || item.product?.seller || 'unknown';
    const sellerName = item.product?.seller?.name || 'Unknown Seller';
    
    if (!grouped[sellerId]) {
      grouped[sellerId] = {
        sellerId,
        sellerName,
        items: [],
        subtotal: 0,
        itemCount: 0
      };
    }
    
    grouped[sellerId].items.push(item);
    const itemPrice = item.priceAtAdd || item.price || (item.product && item.product.price) || 0;
    grouped[sellerId].subtotal += itemPrice * item.quantity;
    grouped[sellerId].itemCount += item.quantity;
  });
  
  return Object.values(grouped);
}

async function getSellerOffers(items) {
  // Mock implementation - replace with real offers logic
  const offers = [];
  
  const sellerGroups = groupItemsBySeller(items);
  
  for (const group of sellerGroups) {
    if (group.subtotal >= 500) {
      offers.push({
        sellerId: group.sellerId,
        sellerName: group.sellerName,
        type: 'free_delivery',
        message: 'Free delivery on orders above ₹500',
        savings: 25
      });
    }
    
    if (group.itemCount >= 5) {
      offers.push({
        sellerId: group.sellerId,
        sellerName: group.sellerName,
        type: 'bulk_discount',
        message: '5% off on 5+ items',
        savings: Math.round(group.subtotal * 0.05)
      });
    }
  }
  
  return offers;
}

async function getCartRecommendations(items, userId) {
  try {
    // Get categories from cart items
    const categories = [...new Set(items.map(item => item.product?.category).filter(Boolean))];
    
    // Find recommended products
    const recommendations = await Product.find({
      category: { $in: categories },
      _id: { $nin: items.map(item => item.product?._id || item.product).filter(Boolean) },
      status: 'active',
      stock: { $gt: 0 }
    })
    .select('name price images averageRating discountPercentage')
    .sort({ averageRating: -1, totalSales: -1 })
    .limit(8)
    .lean();
    
    return recommendations;
  } catch (error) {
    logger.error('Get cart recommendations error:', error);
    return [];
  }
}

async function estimateCartDeliveryTime(items, pincode) {
  try {
    // Group by seller and estimate delivery time
    const sellerGroups = groupItemsBySeller(items);
    let maxDeliveryTime = 0;
    
    for (const group of sellerGroups) {
      const deliveryTime = await estimateDeliveryTime({ pincode }, group.sellerId);
      maxDeliveryTime = Math.max(maxDeliveryTime, deliveryTime);
    }
    
    const estimatedTime = new Date();
    estimatedTime.setMinutes(estimatedTime.getMinutes() + maxDeliveryTime);
    
    return estimatedTime;
  } catch (error) {
    logger.error('Estimate cart delivery time error:', error);
    return null;
  }
}

async function validateAndApplyCoupon(couponCode, cartItems, userId) {
  try {
    // Mock coupon validation - replace with real coupon system
    const mockCoupons = {
      'SAVE10': { 
        type: 'percentage', 
        value: 10, 
        minOrder: 100, 
        maxDiscount: 100,
        categories: [],
        sellers: [],
        usageLimit: 100,
        userLimit: 5
      },
      'FLAT50': { 
        type: 'fixed', 
        value: 50, 
        minOrder: 200,
        categories: [],
        sellers: [],
        usageLimit: 50,
        userLimit: 3
      },
      'FIRST20': { 
        type: 'percentage', 
        value: 20, 
        minOrder: 0,
        maxDiscount: 200,
        categories: [],
        sellers: [],
        usageLimit: 1000,
        userLimit: 1
      }
    };
    
    const coupon = mockCoupons[couponCode.toUpperCase()];
    if (!coupon) {
      return { success: false, message: 'Invalid coupon code' };
    }
    
    // FIXED: Calculate subtotal using priceAtAdd
    const subtotal = cartItems.reduce((sum, item) => {
      const itemPrice = item.priceAtAdd || item.price || (item.product && item.product.price) || 0;
      return sum + (itemPrice * item.quantity);
    }, 0);
    
    if (subtotal < coupon.minOrder) {
      return { 
        success: false, 
        message: `Minimum order amount ₹${coupon.minOrder} required` 
      };
    }
    
    let discountAmount = 0;
    if (coupon.type === 'percentage') {
      discountAmount = (subtotal * coupon.value) / 100;
      if (coupon.maxDiscount) {
        discountAmount = Math.min(discountAmount, coupon.maxDiscount);
      }
    } else {
      discountAmount = coupon.value;
    }
    
    discountAmount = Math.min(discountAmount, subtotal);
    
    return {
      success: true,
      coupon,
      discountAmount
    };
  } catch (error) {
    logger.error('Validate coupon error:', error);
    return { success: false, message: 'Error validating coupon' };
  }
}

async function analyzeCart(items, userId) {
  const categories = {};
  const sellers = {};
  let totalItems = 0;
  let totalValue = 0;
  
  items.forEach(item => {
    const categoryName = item.product?.category?.name || 'Unknown';
    const sellerName = item.product?.seller?.name || 'Unknown';
    const itemPrice = item.priceAtAdd || item.price || (item.product && item.product.price) || 0;
    const itemTotal = itemPrice * item.quantity;
    
    categories[categoryName] = (categories[categoryName] || 0) + item.quantity;
    sellers[sellerName] = (sellers[sellerName] || 0) + itemTotal;
    totalItems += item.quantity;
    totalValue += itemTotal;
  });
  
  const topCategory = Object.keys(categories).length > 0 
    ? Object.keys(categories).reduce((a, b) => categories[a] > categories[b] ? a : b)
    : 'None';
  
  const avgItemPrice = totalItems > 0 ? totalValue / totalItems : 0;
  
  return {
    totalItems,
    totalValue,
    avgItemPrice,
    categoryBreakdown: categories,
    sellerBreakdown: sellers,
    topCategory,
    insights: {
      isLargeOrder: totalItems > 10,
      isHighValue: totalValue > 1000,
      categoryDiversity: Object.keys(categories).length,
      sellerDiversity: Object.keys(sellers).length
    }
  };
}

async function findSavingsOpportunities(items) {
  const opportunities = [];
  
  // Check for bulk discount opportunities
  const itemCounts = {};
  items.forEach(item => {
    const productId = item.product?._id || item.product;
    if (productId) {
      itemCounts[productId] = (itemCounts[productId] || 0) + item.quantity;
    }
  });
  
  Object.entries(itemCounts).forEach(([productId, count]) => {
    if (count >= 5) {
      opportunities.push({
        type: 'bulk_discount',
        message: `Buy 2 more of this item for 10% bulk discount`,
        potentialSavings: 50
      });
    }
  });
  
  // Check for free delivery threshold
  const totalValue = items.reduce((sum, item) => {
    const itemPrice = item.priceAtAdd || item.price || (item.product && item.product.price) || 0;
    return sum + (itemPrice * item.quantity);
  }, 0);
  
  if (totalValue >= 400 && totalValue < 500) {
    opportunities.push({
      type: 'free_delivery',
      message: `Add ₹${500 - totalValue} more for free delivery`,
      potentialSavings: 25
    });
  }
  
  return opportunities;
}

async function getDeliveryOptimization(items) {
  const sellerGroups = groupItemsBySeller(items);
  
  if (sellerGroups.length > 3) {
    return {
      suggestion: 'consolidate_sellers',
      message: `You have items from ${sellerGroups.length} sellers. Consider ordering from fewer sellers to reduce delivery time.`,
      benefit: 'Faster delivery and lower delivery fees'
    };
  }
  
  return null;
}

async function trackCartEvent(eventType, userId, productId, quantity) {
  try {
    // Track cart analytics
    const eventData = {
      eventType,
      userId,
      productId,
      quantity,
      timestamp: new Date()
    };
    
    // Save to analytics collection or send to analytics service
    logger.info(`Cart event tracked: ${eventType}`, eventData);
    
    // Update Redis for real-time analytics
    if (redis) {
      await redis.lpush('cart_events', JSON.stringify(eventData));
      await redis.ltrim('cart_events', 0, 999); // Keep last 1000 events
    }
  } catch (error) {
    logger.error('Track cart event error:', error);
  }
}

module.exports = router;