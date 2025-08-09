// routes/advanced-analytics.js - Advanced Analytics & Business Intelligence Routes

const express = require('express');
const router = express.Router();
const analyticsService = require('../services/analyticsService');
const { auth, authorize } = require('../middleware/auth');

/**
 * @route   GET /api/analytics/dashboard
 * @desc    Get comprehensive dashboard analytics
 * @access  Private
 */
router.get('/dashboard', auth, async (req, res) => {
  try {
    const {
      dateRange = 'last_30_days',
      format = 'json'
    } = req.query;

    const options = {
      dateRange,
      userId: req.user.role === 'customer' ? req.user.id : null,
      sellerId: req.user.role === 'seller' ? req.user.sellerId : null,
      isAdmin: req.user.role === 'admin'
    };

    const analytics = await analyticsService.getDashboardAnalytics(options);

    if (format === 'csv') {
      // Convert to CSV format
      const csv = await convertToCSV(analytics);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');
      return res.send(csv);
    }

    res.json({
      success: true,
      data: analytics,
      generatedAt: new Date().toISOString(),
      dateRange
    });

  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get analytics',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/sales
 * @desc    Get detailed sales analytics
 * @access  Private (Seller/Admin)
 */
router.get('/sales', [auth, authorize('seller', 'admin')], async (req, res) => {
  try {
    const {
      dateRange = 'last_30_days',
      groupBy = 'day',
      sellerId = req.user.role === 'seller' ? req.user.sellerId : null
    } = req.query;

    const dateFilter = getDateFilter(dateRange);
    let salesQuery = { ...dateFilter, paymentStatus: 'paid' };

    if (sellerId) {
      salesQuery['items.seller'] = sellerId;
    }

    const salesAnalytics = await Order.aggregate([
      { $match: salesQuery },
      {
        $group: {
          _id: getGroupByExpression(groupBy),
          totalRevenue: { $sum: '$totalAmount' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' },
          totalItems: { $sum: { $size: '$items' } }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Get top products for the period
    const topProducts = await Order.aggregate([
      { $match: salesQuery },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          totalSold: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'productadvanceds',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        timeSeries: salesAnalytics,
        topProducts,
        summary: {
          totalRevenue: salesAnalytics.reduce((sum, item) => sum + item.totalRevenue, 0),
          totalOrders: salesAnalytics.reduce((sum, item) => sum + item.totalOrders, 0),
          averageOrderValue: salesAnalytics.length > 0 
            ? salesAnalytics.reduce((sum, item) => sum + item.averageOrderValue, 0) / salesAnalytics.length
            : 0
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get sales analytics',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/customers
 * @desc    Get customer analytics
 * @access  Private (Admin)
 */
router.get('/customers', [auth, authorize('admin')], async (req, res) => {
  try {
    const { dateRange = 'last_30_days' } = req.query;
    const dateFilter = getDateFilter(dateRange);

    const customerAnalytics = await User.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          newCustomers: { $sum: 1 },
          activeCustomers: {
            $sum: { $cond: [{ $gte: ['$lastLoginAt', dateFilter.createdAt.$gte] }, 1, 0] }
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Customer lifetime value analysis
    const clvAnalysis = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      {
        $group: {
          _id: '$user',
          totalSpent: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 },
          firstOrder: { $min: '$createdAt' },
          lastOrder: { $max: '$createdAt' }
        }
      },
      {
        $group: {
          _id: null,
          averageLifetimeValue: { $avg: '$totalSpent' },
          averageOrderCount: { $avg: '$orderCount' },
          totalCustomers: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        acquisitionTrend: customerAnalytics,
        lifetimeValue: clvAnalysis[0] || {},
        segments: await getCustomerSegments(dateFilter)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get customer analytics',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/products
 * @desc    Get product performance analytics
 * @access  Private (Seller/Admin)
 */
router.get('/products', [auth, authorize('seller', 'admin')], async (req, res) => {
  try {
    const {
      dateRange = 'last_30_days',
      sellerId = req.user.role === 'seller' ? req.user.sellerId : null
    } = req.query;

    let productQuery = { status: 'active', isDeleted: false };
    if (sellerId) {
      productQuery.seller = sellerId;
    }

    const productAnalytics = await ProductAdvanced.aggregate([
      { $match: productQuery },
      {
        $project: {
          title: 1,
          'analytics.views': 1,
          'analytics.purchases': 1,
          'analytics.revenue': 1,
          'analytics.conversionRate': 1,
          'reviews.averageRating': 1,
          'reviews.totalReviews': 1,
          'inventory.quantity': 1,
          category: 1
        }
      },
      { $sort: { 'analytics.revenue': -1 } },
      { $limit: 100 }
    ]);

    // Category performance
    const categoryPerformance = await ProductAdvanced.aggregate([
      { $match: productQuery },
      {
        $group: {
          _id: '$category',
          totalProducts: { $sum: 1 },
          totalRevenue: { $sum: '$analytics.revenue' },
          totalViews: { $sum: '$analytics.views' },
          averageRating: { $avg: '$reviews.averageRating' }
        }
      },
      { $sort: { totalRevenue: -1 } },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'category'
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        products: productAnalytics,
        categories: categoryPerformance,
        summary: {
          totalProducts: productAnalytics.length,
          totalRevenue: productAnalytics.reduce((sum, p) => sum + (p.analytics.revenue || 0), 0),
          averageRating: productAnalytics.reduce((sum, p) => sum + (p.reviews.averageRating || 0), 0) / productAnalytics.length
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get product analytics',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/revenue
 * @desc    Get detailed revenue analysis
 * @access  Private (Admin/Seller)
 */
router.get('/revenue', [auth, authorize('seller', 'admin')], async (req, res) => {
  try {
    const {
      dateRange = 'last_30_days',
      sellerId = req.user.role === 'seller' ? req.user.sellerId : null
    } = req.query;

    const dateFilter = getDateFilter(dateRange);
    let revenueQuery = { ...dateFilter, paymentStatus: 'paid' };

    if (sellerId) {
      revenueQuery['items.seller'] = sellerId;
    }

    const revenueAnalysis = await Order.aggregate([
      { $match: revenueQuery },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          totalRevenue: { $sum: '$totalAmount' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Payment method breakdown
    const paymentBreakdown = await Order.aggregate([
      { $match: revenueQuery },
      {
        $group: {
          _id: '$paymentDetails.gateway',
          totalRevenue: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        timeSeries: revenueAnalysis,
        paymentMethods: paymentBreakdown,
        growth: calculateGrowthRate(revenueAnalysis),
        forecasting: await generateSimpleForecast(revenueAnalysis)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get revenue analytics',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/geographic
 * @desc    Get geographic analytics
 * @access  Private (Admin)
 */
router.get('/geographic', [auth, authorize('admin')], async (req, res) => {
  try {
    const { dateRange = 'last_30_days' } = req.query;
    const dateFilter = getDateFilter(dateRange);

    const geoAnalytics = await Order.aggregate([
      { $match: { ...dateFilter, paymentStatus: 'paid' } },
      {
        $group: {
          _id: {
            state: '$shippingAddress.state',
            city: '$shippingAddress.city'
          },
          totalRevenue: { $sum: '$totalAmount' },
          orderCount: { $sum: 1 },
          uniqueCustomers: { $addToSet: '$user' }
        }
      },
      {
        $project: {
          state: '$_id.state',
          city: '$_id.city',
          totalRevenue: 1,
          orderCount: 1,
          customerCount: { $size: '$uniqueCustomers' },
          averageOrderValue: { $divide: ['$totalRevenue', '$orderCount'] }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        locations: geoAnalytics,
        topStates: groupByState(geoAnalytics),
        heatmapData: generateHeatmapData(geoAnalytics)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get geographic analytics',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/analytics/custom-report
 * @desc    Generate custom analytics report
 * @access  Private (Admin)
 */
router.post('/custom-report', [auth, authorize('admin')], async (req, res) => {
  try {
    const {
      metrics,
      dimensions,
      filters,
      dateRange,
      format = 'json'
    } = req.body;

    const report = await generateCustomReport({
      metrics,
      dimensions,
      filters,
      dateRange
    });

    if (format === 'csv') {
      const csv = await convertToCSV(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="custom-report.csv"');
      return res.send(csv);
    }

    res.json({
      success: true,
      data: report,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate custom report',
      error: error.message
    });
  }
});

// Helper Functions
function getDateFilter(dateRange) {
  const now = new Date();
  let startDate;

  switch (dateRange) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'last_7_days':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'last_30_days':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'last_90_days':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return {
    createdAt: { $gte: startDate, $lte: now }
  };
}

function getGroupByExpression(groupBy) {
  switch (groupBy) {
    case 'hour':
      return {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' },
        day: { $dayOfMonth: '$createdAt' },
        hour: { $hour: '$createdAt' }
      };
    case 'day':
      return {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' },
        day: { $dayOfMonth: '$createdAt' }
      };
    case 'month':
      return {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' }
      };
    default:
      return {
        year: { $year: '$createdAt' },
        month: { $month: '$createdAt' },
        day: { $dayOfMonth: '$createdAt' }
      };
  }
}

function calculateGrowthRate(data) {
  if (data.length < 2) return 0;
  
  const latest = data[data.length - 1];
  const previous = data[data.length - 2];
  
  if (previous.totalRevenue === 0) return 0;
  
  return ((latest.totalRevenue - previous.totalRevenue) / previous.totalRevenue * 100).toFixed(2);
}

async function generateSimpleForecast(historicalData) {
  // Simple linear regression forecast
  if (historicalData.length < 3) return [];
  
  const forecast = [];
  const trend = calculateTrend(historicalData);
  const lastValue = historicalData[historicalData.length - 1].totalRevenue;
  
  for (let i = 1; i <= 7; i++) {
    forecast.push({
      date: new Date(Date.now() + i * 24 * 60 * 60 * 1000),
      predictedRevenue: Math.max(0, lastValue + (trend * i)),
      confidence: Math.max(0.5, 0.9 - (i * 0.05))
    });
  }
  
  return forecast;
}

function calculateTrend(data) {
  if (data.length < 2) return 0;
  
  const values = data.map(d => d.totalRevenue);
  const n = values.length;
  const sumX = n * (n + 1) / 2;
  const sumY = values.reduce((sum, val) => sum + val, 0);
  const sumXY = values.reduce((sum, val, idx) => sum + val * (idx + 1), 0);
  const sumX2 = n * (n + 1) * (2 * n + 1) / 6;
  
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}

function groupByState(geoData) {
  const stateMap = {};
  
  geoData.forEach(item => {
    if (!stateMap[item.state]) {
      stateMap[item.state] = {
        state: item.state,
        totalRevenue: 0,
        orderCount: 0,
        customerCount: 0
      };
    }
    
    stateMap[item.state].totalRevenue += item.totalRevenue;
    stateMap[item.state].orderCount += item.orderCount;
    stateMap[item.state].customerCount += item.customerCount;
  });
  
  return Object.values(stateMap)
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 10);
}

function generateHeatmapData(geoData) {
  return geoData.map(item => ({
    location: `${item.city}, ${item.state}`,
    value: item.totalRevenue,
    intensity: Math.min(item.totalRevenue / 100000, 1) // Normalize to 0-1
  }));
}

async function convertToCSV(data) {
  // Simple CSV conversion - in production, use a proper CSV library
  const headers = Object.keys(data[0] || {});
  const rows = Array.isArray(data) ? data : [data];
  
  const csv = [
    headers.join(','),
    ...rows.map(row => 
      headers.map(header => 
        JSON.stringify(row[header] || '')
      ).join(',')
    )
  ].join('\n');
  
  return csv;
}

module.exports = router;
