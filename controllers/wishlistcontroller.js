// controllers/wishlistController.js
const asyncHandler = require('express-async-handler');
const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product');
const { validationResult } = require('express-validator');
const crypto = require('crypto');

/**
 * @desc    Get user's wishlist
 * @route   GET /api/v1/wishlist
 * @access  Private
 */
const getWishlist = asyncHandler(async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ userId: req.user.id })
      .populate({
        path: 'items.productId',
        select: 'name price images category seller stock isActive',
        populate: {
          path: 'seller',
          select: 'storeName rating'
        }
      })
      .lean();

    if (!wishlist) {
      return res.status(200).json({
        success: true,
        message: 'Wishlist is empty',
        data: {
          items: [],
          totalItems: 0,
          allowSharing: false
        }
      });
    }

    // Filter out inactive products
    const activeItems = wishlist.items.filter(item => 
      item.productId && item.productId.isActive
    );

    res.status(200).json({
      success: true,
      message: 'Wishlist retrieved successfully',
      data: {
        items: activeItems,
        totalItems: activeItems.length,
        allowSharing: wishlist.allowSharing || false,
        shareId: wishlist.shareId,
        createdAt: wishlist.createdAt,
        updatedAt: wishlist.updatedAt
      }
    });

  } catch (error) {
    console.error('Get wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve wishlist',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @desc    Toggle product in wishlist (add/remove)
 * @route   PUT /api/v1/wishlist/:productId
 * @access  Private
 */
const toggleWishlistItem = asyncHandler(async (req, res) => {
  try {
    const { productId } = req.params;
    const { allowSharing } = req.body;

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (!product.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Product is not available'
      });
    }

    // Find or create wishlist
    let wishlist = await Wishlist.findOne({ userId: req.user.id });
    
    if (!wishlist) {
      wishlist = new Wishlist({
        userId: req.user.id,
        items: [],
        allowSharing: allowSharing || false
      });
    }

    // Check if product already in wishlist
    const existingItemIndex = wishlist.items.findIndex(
      item => item.productId.toString() === productId
    );

    let message;
    let action;

    if (existingItemIndex > -1) {
      // Remove from wishlist
      wishlist.items.splice(existingItemIndex, 1);
      message = 'Product removed from wishlist';
      action = 'removed';
    } else {
      // Add to wishlist
      const newItem = {
        productId: productId,
        addedAt: new Date()
      };
      
      wishlist.items.push(newItem);
      message = 'Product added to wishlist';
      action = 'added';
    }

    // Update sharing preference if provided
    if (typeof allowSharing === 'boolean') {
      wishlist.allowSharing = allowSharing;
    }

    await wishlist.save();

    // Populate the updated wishlist for response
    await wishlist.populate({
      path: 'items.productId',
      select: 'name price images category seller',
      populate: {
        path: 'seller',
        select: 'storeName'
      }
    });

    res.status(200).json({
      success: true,
      message: message,
      data: {
        action: action,
        totalItems: wishlist.items.length,
        product: {
          _id: product._id,
          name: product.name,
          price: product.price,
          images: product.images
        },
        wishlist: {
          items: wishlist.items,
          allowSharing: wishlist.allowSharing
        }
      }
    });

  } catch (error) {
    console.error('Toggle wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update wishlist',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @desc    Remove specific product from wishlist
 * @route   DELETE /api/v1/wishlist/:productId
 * @access  Private
 */
const removeFromWishlist = asyncHandler(async (req, res) => {
  try {
    const { productId } = req.params;

    const wishlist = await Wishlist.findOne({ userId: req.user.id });
    
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    const itemIndex = wishlist.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in wishlist'
      });
    }

    wishlist.items.splice(itemIndex, 1);
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: 'Product removed from wishlist',
      data: {
        totalItems: wishlist.items.length
      }
    });

  } catch (error) {
    console.error('Remove from wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove from wishlist',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @desc    Clear entire wishlist
 * @route   DELETE /api/v1/wishlist
 * @access  Private
 */
const clearWishlist = asyncHandler(async (req, res) => {
  try {
    const result = await Wishlist.findOneAndUpdate(
      { userId: req.user.id },
      { 
        items: [],
        shareId: null,
        allowSharing: false
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Wishlist cleared successfully',
      data: {
        totalItems: 0
      }
    });

  } catch (error) {
    console.error('Clear wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear wishlist',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @desc    Check if product is in wishlist
 * @route   GET /api/v1/wishlist/check/:productId
 * @access  Private
 */
const checkWishlistStatus = asyncHandler(async (req, res) => {
  try {
    const { productId } = req.params;

    const wishlist = await Wishlist.findOne({ userId: req.user.id });
    
    let isInWishlist = false;
    if (wishlist) {
      isInWishlist = wishlist.items.some(
        item => item.productId.toString() === productId
      );
    }

    res.status(200).json({
      success: true,
      data: {
        productId: productId,
        isInWishlist: isInWishlist,
        totalItems: wishlist ? wishlist.items.length : 0
      }
    });

  } catch (error) {
    console.error('Check wishlist status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check wishlist status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @desc    Get wishlist items count
 * @route   GET /api/v1/wishlist/count
 * @access  Private
 */
const getWishlistCount = asyncHandler(async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ userId: req.user.id });
    
    const count = wishlist ? wishlist.items.length : 0;

    res.status(200).json({
      success: true,
      data: {
        count: count
      }
    });

  } catch (error) {
    console.error('Get wishlist count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wishlist count',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @desc    Generate shareable wishlist link
 * @route   POST /api/v1/wishlist/share
 * @access  Private
 */
const shareWishlist = asyncHandler(async (req, res) => {
  try {
    let wishlist = await Wishlist.findOne({ userId: req.user.id });
    
    if (!wishlist || wishlist.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot share empty wishlist'
      });
    }

    // Generate share ID if not exists
    if (!wishlist.shareId) {
      wishlist.shareId = crypto.randomBytes(16).toString('hex');
    }

    wishlist.allowSharing = true;
    await wishlist.save();

    const shareUrl = `${process.env.FRONTEND_URL || 'https://quicklocal.com'}/wishlist/shared/${wishlist.shareId}`;

    res.status(200).json({
      success: true,
      message: 'Wishlist sharing enabled',
      data: {
        shareId: wishlist.shareId,
        shareUrl: shareUrl,
        allowSharing: true
      }
    });

  } catch (error) {
    console.error('Share wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share wishlist',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @desc    Get shared wishlist by share ID
 * @route   GET /api/v1/wishlist/shared/:shareId
 * @access  Public
 */
const getSharedWishlist = asyncHandler(async (req, res) => {
  try {
    const { shareId } = req.params;

    const wishlist = await Wishlist.findOne({ 
      shareId: shareId,
      allowSharing: true 
    })
    .populate({
      path: 'items.productId',
      select: 'name price images category seller stock isActive',
      populate: {
        path: 'seller',
        select: 'storeName rating'
      }
    })
    .populate({
      path: 'userId',
      select: 'firstName lastName'
    });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Shared wishlist not found or sharing is disabled'
      });
    }

    // Filter active products
    const activeItems = wishlist.items.filter(item => 
      item.productId && item.productId.isActive
    );

    res.status(200).json({
      success: true,
      message: 'Shared wishlist retrieved successfully',
      data: {
        shareId: wishlist.shareId,
        owner: wishlist.userId ? {
          firstName: wishlist.userId.firstName,
          lastName: wishlist.userId.lastName
        } : null,
        items: activeItems,
        totalItems: activeItems.length,
        createdAt: wishlist.createdAt
      }
    });

  } catch (error) {
    console.error('Get shared wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve shared wishlist',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = {
  getWishlist,
  toggleWishlistItem,
  removeFromWishlist,
  clearWishlist,
  checkWishlistStatus,
  getWishlistCount,
  shareWishlist,
  getSharedWishlist
};