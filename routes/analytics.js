const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { hybridProtect, requireRole } = require('../middleware/hybridAuth');
// Old authMiddleware replaced with hybridAuth
const router = express.Router();

// ==================== GET DASHBOARD ANALYTICS ====================
router.get('/dashboard', [hybridProtect, requireRole('admin', 'seller')], async (req, res) => {
  try {
    const { period = '30d', sellerId } = req.query;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    
    // Determine date range
    const now = new Date();
    let startDate;
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Build filters
    const orderFilters = {
      createdAt: { $gte: startDate, $lte: now },
      status: { $nin: ['cancelled'] }
    };

    const productFilters = {
      createdAt: { $gte: startDate, $lte: now }
    };

    if (!isAdmin && sellerId) {
      orderFilters['items.seller'] = sellerId;
      productFilters.seller = sellerId;
    } else if (!isAdmin) {
      orderFilters['items.seller'] = userId;
      productFilters.seller = userId;
    }

    // Get order analytics
    const orderAnalytics = await Order.aggregate([
      { $match: orderFilters },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' },
          totalItems: { $sum: { $sum: '$items.quantity' } }
        }
      }
    ]);

    // Get order status distribution
    const orderStatusDistribution = await Order.aggregate([
      { $match: orderFilters },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get daily revenue trend
    const dailyRevenue = await Order.aggregate([
      { $match: orderFilters },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Get top products
    const topProducts = await Order.aggregate([
      { $match: orderFilters },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          productId: '$_id',
          productName: '$product.name',
          totalSold: 1,
          revenue: 1,
          image: { $arrayElemAt: ['$product.images.url', 0] }
        }
      }
    ]);

    // Get user analytics
    const userAnalytics = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now },
          role: { $ne: 'admin' }
        }
      },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          newUsers: { $sum: 1 }
        }
      }
    ]);

    // Get product analytics
    const productAnalytics = await Product.aggregate([
      { $match: productFilters },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          activeProducts: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          lowStockProducts: { $sum: { $cond: [{ $lte: ['$stock', '$lowStockThreshold'] }, 1, 0] } }
        }
      }
    ]);

    // Calculate growth rates
    const previousPeriodStart = new Date(startDate.getTime() - (now.getTime() - startDate.getTime()));
    const previousOrderAnalytics = await Order.aggregate([
      {
        $match: {
          ...orderFilters,
          createdAt: { $gte: previousPeriodStart, $lt: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' }
        }
      }
    ]);

    const currentData = orderAnalytics[0] || { totalOrders: 0, totalRevenue: 0, averageOrderValue: 0, totalItems: 0 };
    const previousData = previousOrderAnalytics[0] || { totalOrders: 0, totalRevenue: 0 };

    const orderGrowth = previousData.totalOrders > 0 
      ? ((currentData.totalOrders - previousData.totalOrders) / previousData.totalOrders) * 100 
      : 0;
    
    const revenueGrowth = previousData.totalRevenue > 0 
      ? ((currentData.totalRevenue - previousData.totalRevenue) / previousData.totalRevenue) * 100 
      : 0;

    res.json({
      success: true,
      message: 'Dashboard analytics retrieved successfully',
      data: {
        period,
        summary: {
          totalOrders: currentData.totalOrders,
          totalRevenue: currentData.totalRevenue,
          averageOrderValue: currentData.averageOrderValue,
          totalItems: currentData.totalItems,
          orderGrowth,
          revenueGrowth
        },
        orderStatusDistribution,
        dailyRevenue,
        topProducts,
        userAnalytics: userAnalytics[0] || { totalUsers: 0, newUsers: 0 },
        productAnalytics: productAnalytics[0] || { totalProducts: 0, activeProducts: 0, lowStockProducts: 0 }
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard analytics',
      message: error.message
    });
  }
});

// ==================== GET SALES ANALYTICS ====================
router.get('/sales', [hybridProtect, requireRole('admin', 'seller')], async (req, res) => {
  try {
    const { 
      period = '30d', 
      sellerId,
      category,
      startDate: customStartDate,
      endDate: customEndDate
    } = req.query;

    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';

    // Determine date range
    let startDate, endDate;
    if (customStartDate && customEndDate) {
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
    } else {
      const now = new Date();
      switch (period) {
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case '1y':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      endDate = now;
    }

    // Build filters
    const orderFilters = {
      createdAt: { $gte: startDate, $lte: endDate },
      status: { $nin: ['cancelled'] }
    };

    if (!isAdmin && sellerId) {
      orderFilters['items.seller'] = sellerId;
    } else if (!isAdmin) {
      orderFilters['items.seller'] = userId;
    }

    // Get sales by date
    const salesByDate = await Order.aggregate([
      { $match: orderFilters },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 },
          items: { $sum: { $sum: '$items.quantity' } }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Get sales by category
    const salesByCategory = await Order.aggregate([
      { $match: orderFilters },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$category' },
      {
        $group: {
          _id: '$category._id',
          categoryName: { $first: '$category.name' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          orders: { $sum: 1 },
          items: { $sum: '$items.quantity' }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    // Get top selling products
    const topSellingProducts = await Order.aggregate([
      { $match: orderFilters },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $group: {
          _id: '$items.product',
          productName: { $first: '$product.name' },
          category: { $first: '$product.category' },
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          averageRating: { $first: '$product.averageRating' }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: 20 }
    ]);

    // Get customer analytics
    const customerAnalytics = await Order.aggregate([
      { $match: orderFilters },
      {
        $group: {
          _id: '$user',
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          averageCustomerValue: { $avg: '$totalSpent' },
          repeatCustomers: { $sum: { $cond: [{ $gt: ['$totalOrders', 1] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      message: 'Sales analytics retrieved successfully',
      data: {
        period,
        dateRange: { startDate, endDate },
        salesByDate,
        salesByCategory,
        topSellingProducts,
        customerAnalytics: customerAnalytics[0] || {
          totalCustomers: 0,
          averageCustomerValue: 0,
          repeatCustomers: 0
        }
      }
    });

  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sales analytics',
      message: error.message
    });
  }
});

// ==================== GET PRODUCT ANALYTICS ====================
router.get('/products', [hybridProtect, requireRole('admin', 'seller')], async (req, res) => {
  try {
    const { sellerId } = req.query;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';

    // Build filters
    const productFilters = {};
    if (!isAdmin && sellerId) {
      productFilters.seller = sellerId;
    } else if (!isAdmin) {
      productFilters.seller = userId;
    }

    // Get product performance
    const productPerformance = await Product.aggregate([
      { $match: productFilters },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$category' },
      {
        $project: {
          name: 1,
          price: 1,
          stock: 1,
          averageRating: 1,
          totalReviews: 1,
          totalSales: 1,
          status: 1,
          categoryName: '$category.name',
          isLowStock: { $lte: ['$stock', '$lowStockThreshold'] }
        }
      },
      { $sort: { totalSales: -1 } }
    ]);

    // Get stock analytics
    const stockAnalytics = await Product.aggregate([
      { $match: productFilters },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          activeProducts: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          outOfStock: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
          lowStock: { $sum: { $cond: [{ $lte: ['$stock', '$lowStockThreshold'] }, 1, 0] } },
          totalValue: { $sum: { $multiply: ['$price', '$stock'] } }
        }
      }
    ]);

    // Get category performance
    const categoryPerformance = await Product.aggregate([
      { $match: productFilters },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$category' },
      {
        $group: {
          _id: '$category._id',
          categoryName: { $first: '$category.name' },
          productCount: { $sum: 1 },
          averageRating: { $avg: '$averageRating' },
          totalSales: { $sum: '$totalSales' },
          totalValue: { $sum: { $multiply: ['$price', '$stock'] } }
        }
      },
      { $sort: { totalSales: -1 } }
    ]);

    res.json({
      success: true,
      message: 'Product analytics retrieved successfully',
      data: {
        productPerformance,
        stockAnalytics: stockAnalytics[0] || {
          totalProducts: 0,
          activeProducts: 0,
          outOfStock: 0,
          lowStock: 0,
          totalValue: 0
        },
        categoryPerformance
      }
    });

  } catch (error) {
    console.error('Error fetching product analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product analytics',
      message: error.message
    });
  }
});

// ==================== GET CUSTOMER ANALYTICS ====================
router.get('/customers', [hybridProtect, requireRole('admin')], async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    // Determine date range
    const now = new Date();
    let startDate;
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get customer growth
    const customerGrowth = await User.aggregate([
      {
        $match: {
          role: { $ne: 'admin' },
          createdAt: { $gte: startDate, $lte: now }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          newUsers: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Get customer value distribution
    const customerValueDistribution = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now },
          status: { $nin: ['cancelled'] }
        }
      },
      {
        $group: {
          _id: '$user',
          totalSpent: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: null,
          averageCustomerValue: { $avg: '$totalSpent' },
          medianCustomerValue: { $avg: '$totalSpent' },
          topSpenders: { $sum: { $cond: [{ $gte: ['$totalSpent', 1000] }, 1, 0] } },
          repeatCustomers: { $sum: { $cond: [{ $gt: ['$orderCount', 1] }, 1, 0] } }
        }
      }
    ]);

    // Get customer demographics (if available)
    const customerDemographics = await User.aggregate([
      {
        $match: {
          role: { $ne: 'admin' },
          createdAt: { $gte: startDate, $lte: now }
        }
      },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          verifiedUsers: { $sum: { $cond: ['$isVerified', 1, 0] } },
          activeUsers: { $sum: { $cond: [{ $gte: ['$lastLoginAt', startDate] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      message: 'Customer analytics retrieved successfully',
      data: {
        period,
        customerGrowth,
        customerValueDistribution: customerValueDistribution[0] || {
          averageCustomerValue: 0,
          medianCustomerValue: 0,
          topSpenders: 0,
          repeatCustomers: 0
        },
        customerDemographics: customerDemographics[0] || {
          totalUsers: 0,
          verifiedUsers: 0,
          activeUsers: 0
        }
      }
    });

  } catch (error) {
    console.error('Error fetching customer analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch customer analytics',
      message: error.message
    });
  }
});

// ==================== EXPORT ANALYTICS REPORT ====================
router.get('/export', [hybridProtect, requireRole('admin')], async (req, res) => {
  try {
    const { type = 'sales', format = 'json', period = '30d' } = req.query;

    // This would typically generate a CSV or Excel file
    // For now, we'll return JSON data that can be converted
    
    const reportData = {
      type,
      period,
      generatedAt: new Date().toISOString(),
      data: {}
    };

    // Add specific data based on type
    switch (type) {
      case 'sales':
        // Add sales data
        break;
      case 'products':
        // Add product data
        break;
      case 'customers':
        // Add customer data
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid report type'
        });
    }

    if (format === 'csv') {
      // Convert to CSV format
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report-${period}.csv"`);
      // Return CSV data
    } else {
      res.json({
        success: true,
        message: 'Report generated successfully',
        data: reportData
      });
    }

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate report',
      message: error.message
    });
  }
});

module.exports = router;
