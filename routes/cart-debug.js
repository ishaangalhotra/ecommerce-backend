const express = require('express');
const mongoose = require('mongoose');
const { hybridProtect } = require('../middleware/hybridAuth');
const logger = require('../utils/logger');

// Import cart model with explicit error handling
let Cart;
try {
  Cart = require('../models/cart');
  console.log('✅ Cart model loaded for debug routes');
} catch (error) {
  console.error('❌ Cart model failed to load:', error.message);
  // Fallback: Try to find the model in mongoose models
  Cart = mongoose.models.Cart;
}

const router = express.Router();

// Debug route - test if cart routes are reachable
router.get('/debug', (req, res) => {
  res.json({
    success: true,
    message: 'Cart debug route is working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    cartModelAvailable: !!Cart
  });
});

// Simplified cart GET route with extensive debugging
router.get('/', hybridProtect, async (req, res) => {
  try {
    console.log('🛒 Cart GET route hit by user:', req.user?.email || req.user?.id);
    
    if (!Cart) {
      console.error('❌ Cart model is not available');
      return res.status(500).json({
        success: false,
        message: 'Cart model not available'
      });
    }
    
    let cart;
    try {
      cart = await Cart.findOne({ user: req.user.id }).lean();
      console.log('✅ Cart query completed, found cart:', !!cart);
    } catch (dbError) {
      console.error('❌ Database error in cart query:', dbError.message);
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: dbError.message
      });
    }
    
    if (!cart) {
      console.log('📭 No cart found for user, returning empty cart');
      return res.json({
        success: true,
        data: {
          id: null,
          items: [],
          itemCount: 0,
          pricing: { subtotal: 0, tax: 0, deliveryFee: 0, discount: 0, total: 0 },
          appliedCoupons: [],
          isEmpty: true
        }
      });
    }
    
    console.log('📦 Cart found with', cart.items?.length || 0, 'items');
    
    res.json({
      success: true,
      data: {
        id: cart._id,
        items: cart.items || [],
        itemCount: cart.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0,
        pricing: { subtotal: 0, tax: 0, deliveryFee: 0, discount: 0, total: 0 },
        appliedCoupons: cart.appliedCoupons || [],
        isEmpty: !cart.items || cart.items.length === 0,
        lastUpdated: cart.updatedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Cart GET route error:', error);
    logger.error('Cart GET route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error retrieving cart',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Simplified add to cart route
router.post('/items', hybridProtect, async (req, res) => {
  try {
    console.log('🛒 Add to cart route hit by user:', req.user?.email || req.user?.id);
    console.log('🛒 Request body:', JSON.stringify(req.body, null, 2));
    
    const { productId, quantity = 1 } = req.body;
    
    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID'
      });
    }
    
    if (!Cart) {
      return res.status(500).json({
        success: false,
        message: 'Cart model not available'
      });
    }
    
    // For now, just return success to test the route
    res.json({
      success: true,
      message: 'Add to cart debug - route working',
      data: {
        productId,
        quantity,
        userInContext: !!req.user,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Add to cart route error:', error);
    logger.error('Add to cart route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error adding item to cart',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
