/**
 * Advanced Order Analytics & Reporting System
 * Comprehensive business intelligence for order management
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

class OrderAnalytics {
  constructor() {
    this.aggregationCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get comprehensive order statistics for dashboard
   */
  async getOrderStatistics(filters = {}) {
    const cacheKey = `order_stats_${JSON.stringify(filters)}`;
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    try {
      const Order = mongoose.model('Order');
      const today = new Date();
      const startOfToday = new Date(today.setHours(0, 0, 0, 0));
      const startOfWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startOfYear = new Date(today.getFullYear(), 0, 1);

      const baseMatch = { ...filters };
      if (baseMatch.dateFrom || baseMatch.dateTo) {
        baseMatch.createdAt = {};
        if (baseMatch.dateFrom) baseMatch.createdAt.$gte = new Date(baseMatch.dateFrom);
        if (baseMatch.dateTo) baseMatch.createdAt.$lte = new Date(baseMatch.dateTo);
        delete baseMatch.dateFrom;
        delete baseMatch.dateTo;
      }

      const [
        overallStats,
        todayStats,
        weekStats,
        monthStats,
        yearStats,
        statusBreakdown,
        paymentMethodBreakdown,
        revenueByDay,
        topProducts,
        customerSegmentation
      ] = await Promise.all([
        this.getOverallStatistics(baseMatch),
        this.getPeriodStatistics({ ...baseMatch, createdAt: { $gte: startOfToday } }),
        this.getPeriodStatistics({ ...baseMatch, createdAt: { $gte: startOfWeek } }),
        this.getPeriodStatistics({ ...baseMatch, createdAt: { $gte: startOfMonth } }),
        this.getPeriodStatistics({ ...baseMatch, createdAt: { $gte: startOfYear } }),
        this.getStatusBreakdown(baseMatch),
        this.getPaymentMethodBreakdown(baseMatch),
        this.getRevenueByDay(baseMatch, 30), // Last 30 days
        this.getTopProducts(baseMatch, 10),
        this.getCustomerSegmentation(baseMatch)
      ]);

      const result = {
        overall: overallStats,
        periods: {
          today: todayStats,
          week: weekStats,
          month: monthStats,
          year: yearStats
        },
        breakdowns: {
          status: statusBreakdown,
          paymentMethods: paymentMethodBreakdown
        },
        trends: {
          revenueByDay
        },
        insights: {
          topProducts,
          customerSegmentation
        },
        generatedAt: new Date()
      };

      this.setCachedResult(cacheKey, result);
      return result;

    } catch (error) {
      logger.error('Order statistics generation failed', { error: error.message, filters });
      throw error;
    }
  }

  /**
   * Get overall statistics
   */
  async getOverallStatistics(match) {
    const Order = mongoose.model('Order');
    
    const result = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.totalPrice' },
          averageOrderValue: { $avg: '$pricing.totalPrice' },
          totalItems: { $sum: { $sum: '$orderItems.qty' } },
          averageItemsPerOrder: { $avg: { $sum: '$orderItems.qty' } },
          totalShippingRevenue: { $sum: '$pricing.shippingPrice' },
          totalTaxRevenue: { $sum: '$pricing.taxPrice' },
          totalDiscounts: { $sum: '$pricing.discountAmount' },
          uniqueCustomers: { $addToSet: '$user' }
        }
      },
      {
        $project: {
          totalOrders: 1,
          totalRevenue: { $round: ['$totalRevenue', 2] },
          averageOrderValue: { $round: ['$averageOrderValue', 2] },
          totalItems: 1,
          averageItemsPerOrder: { $round: ['$averageItemsPerOrder', 2] },
          totalShippingRevenue: { $round: ['$totalShippingRevenue', 2] },
          totalTaxRevenue: { $round: ['$totalTaxRevenue', 2] },
          totalDiscounts: { $round: ['$totalDiscounts', 2] },
          uniqueCustomers: { $size: '$uniqueCustomers' }
        }
      }
    ]);

    return result[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      averageOrderValue: 0,
      totalItems: 0,
      averageItemsPerOrder: 0,
      totalShippingRevenue: 0,
      totalTaxRevenue: 0,
      totalDiscounts: 0,
      uniqueCustomers: 0
    };
  }

  /**
   * Get period-specific statistics
   */
  async getPeriodStatistics(match) {
    const Order = mongoose.model('Order');
    
    const result = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.totalPrice' },
          averageValue: { $avg: '$pricing.totalPrice' }
        }
      },
      {
        $project: {
          orders: 1,
          revenue: { $round: ['$revenue', 2] },
          averageValue: { $round: ['$averageValue', 2] }
        }
      }
    ]);

    return result[0] || { orders: 0, revenue: 0, averageValue: 0 };
  }

  /**
   * Get status breakdown
   */
  async getStatusBreakdown(match) {
    const Order = mongoose.model('Order');
    
    const result = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          revenue: { $sum: '$pricing.totalPrice' }
        }
      },
      {
        $project: {
          status: '$_id',
          count: 1,
          revenue: { $round: ['$revenue', 2] }
        }
      },
      { $sort: { count: -1 } }
    ]);

    return result;
  }

  /**
   * Get payment method breakdown
   */
  async getPaymentMethodBreakdown(match) {
    const Order = mongoose.model('Order');
    
    const result = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          revenue: { $sum: '$pricing.totalPrice' },
          averageValue: { $avg: '$pricing.totalPrice' }
        }
      },
      {
        $project: {
          paymentMethod: '$_id',
          count: 1,
          revenue: { $round: ['$revenue', 2] },
          averageValue: { $round: ['$averageValue', 2] }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    return result;
  }

  /**
   * Get revenue by day for trend analysis
   */
  async getRevenueByDay(match, days = 30) {
    const Order = mongoose.model('Order');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const result = await Order.aggregate([
      { 
        $match: { 
          ...match, 
          createdAt: { $gte: startDate },
          status: { $nin: ['cancelled', 'refunded'] }
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          date: { $first: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
          orders: { $sum: 1 },
          revenue: { $sum: '$pricing.totalPrice' },
          averageOrderValue: { $avg: '$pricing.totalPrice' }
        }
      },
      {
        $project: {
          date: 1,
          orders: 1,
          revenue: { $round: ['$revenue', 2] },
          averageOrderValue: { $round: ['$averageOrderValue', 2] }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    return result;
  }

  /**
   * Get top products by sales
   */
  async getTopProducts(match, limit = 10) {
    const Order = mongoose.model('Order');
    
    const result = await Order.aggregate([
      { $match: { ...match, status: { $nin: ['cancelled', 'refunded'] } } },
      { $unwind: '$orderItems' },
      {
        $group: {
          _id: '$orderItems.product',
          productName: { $first: '$orderItems.name' },
          totalQuantity: { $sum: '$orderItems.qty' },
          totalRevenue: { $sum: '$orderItems.totalPrice' },
          averagePrice: { $avg: '$orderItems.unitPrice' },
          orderCount: { $sum: 1 }
        }
      },
      {
        $project: {
          productId: '$_id',
          productName: 1,
          totalQuantity: 1,
          totalRevenue: { $round: ['$totalRevenue', 2] },
          averagePrice: { $round: ['$averagePrice', 2] },
          orderCount: 1
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: limit }
    ]);

    return result;
  }

  /**
   * Get customer segmentation
   */
  async getCustomerSegmentation(match) {
    const Order = mongoose.model('Order');
    
    const result = await Order.aggregate([
      { $match: { ...match, status: { $nin: ['cancelled', 'refunded'] } } },
      {
        $group: {
          _id: '$user',
          orderCount: { $sum: 1 },
          totalSpent: { $sum: '$pricing.totalPrice' },
          averageOrderValue: { $avg: '$pricing.totalPrice' },
          firstOrder: { $min: '$createdAt' },
          lastOrder: { $max: '$createdAt' }
        }
      },
      {
        $project: {
          userId: '$_id',
          orderCount: 1,
          totalSpent: { $round: ['$totalSpent', 2] },
          averageOrderValue: { $round: ['$averageOrderValue', 2] },
          firstOrder: 1,
          lastOrder: 1,
          daysSinceFirstOrder: {
            $ceil: {
              $divide: [
                { $subtract: [new Date(), '$firstOrder'] },
                86400000 // milliseconds in a day
              ]
            }
          },
          segment: {
            $switch: {
              branches: [
                { case: { $gte: ['$totalSpent', 10000] }, then: 'VIP' },
                { case: { $and: [{ $gte: ['$totalSpent', 5000] }, { $gte: ['$orderCount', 5] }] }, then: 'Loyal' },
                { case: { $and: [{ $gte: ['$totalSpent', 1000] }, { $gte: ['$orderCount', 2] }] }, then: 'Regular' },
                { case: { $eq: ['$orderCount', 1] }, then: 'New' }
              ],
              default: 'Occasional'
            }
          }
        }
      },
      {
        $group: {
          _id: '$segment',
          customerCount: { $sum: 1 },
          totalRevenue: { $sum: '$totalSpent' },
          averageOrderValue: { $avg: '$averageOrderValue' },
          averageOrders: { $avg: '$orderCount' }
        }
      },
      {
        $project: {
          segment: '$_id',
          customerCount: 1,
          totalRevenue: { $round: ['$totalRevenue', 2] },
          averageOrderValue: { $round: ['$averageOrderValue', 2] },
          averageOrders: { $round: ['$averageOrders', 2] }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    return result;
  }

  /**
   * Get seller performance analytics
   */
  async getSellerPerformance(sellerId = null, period = 30) {
    const Order = mongoose.model('Order');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);

    const match = {
      createdAt: { $gte: startDate },
      status: { $nin: ['cancelled', 'refunded'] }
    };

    if (sellerId) {
      match['orderItems.seller'] = new mongoose.Types.ObjectId(sellerId);
    }

    const result = await Order.aggregate([
      { $match: match },
      { $unwind: '$orderItems' },
      ...(sellerId ? [{ $match: { 'orderItems.seller': new mongoose.Types.ObjectId(sellerId) } }] : []),
      {
        $group: {
          _id: '$orderItems.seller',
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$orderItems.totalPrice' },
          averageOrderValue: { $avg: '$orderItems.totalPrice' },
          totalItems: { $sum: '$orderItems.qty' },
          uniqueProducts: { $addToSet: '$orderItems.product' },
          commission: { $sum: { $multiply: ['$orderItems.totalPrice', 0.05] } } // 5% commission
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'sellerInfo'
        }
      },
      {
        $project: {
          sellerId: '$_id',
          sellerName: { $arrayElemAt: ['$sellerInfo.businessName', 0] },
          totalOrders: 1,
          totalRevenue: { $round: ['$totalRevenue', 2] },
          averageOrderValue: { $round: ['$averageOrderValue', 2] },
          totalItems: 1,
          uniqueProducts: { $size: '$uniqueProducts' },
          commission: { $round: ['$commission', 2] }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    return sellerId ? result[0] || null : result;
  }

  /**
   * Get order fulfillment metrics
   */
  async getFulfillmentMetrics(filters = {}) {
    const Order = mongoose.model('Order');
    
    const result = await Order.aggregate([
      { $match: { ...filters, deliveryTracking: { $exists: true } } },
      {
        $project: {
          orderNumber: 1,
          status: 1,
          createdAt: 1,
          deliveredAt: '$deliveryTracking.deliveredAt',
          estimatedDeliveryDate: '$deliveryTracking.estimatedDeliveryDate',
          processingTime: {
            $cond: {
              if: { $and: ['$deliveryTracking.deliveredAt', '$createdAt'] },
              then: {
                $divide: [
                  { $subtract: ['$deliveryTracking.deliveredAt', '$createdAt'] },
                  3600000 // Convert to hours
                ]
              },
              else: null
            }
          },
          isOnTime: {
            $cond: {
              if: { $and: ['$deliveryTracking.deliveredAt', '$deliveryTracking.estimatedDeliveryDate'] },
              then: { $lte: ['$deliveryTracking.deliveredAt', '$deliveryTracking.estimatedDeliveryDate'] },
              else: null
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          totalDelivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
          averageProcessingTime: { $avg: '$processingTime' },
          onTimeDeliveries: { $sum: { $cond: ['$isOnTime', 1, 0] } },
          lateDeliveries: { $sum: { $cond: [{ $eq: ['$isOnTime', false] }, 1, 0] } },
          totalWithDeliveryData: { $sum: { $cond: ['$isOnTime', 1, { $cond: [{ $eq: ['$isOnTime', false] }, 1, 0] }] } }
        }
      },
      {
        $project: {
          totalDelivered: 1,
          averageProcessingTime: { $round: ['$averageProcessingTime', 2] },
          onTimeDeliveries: 1,
          lateDeliveries: 1,
          onTimePercentage: {
            $cond: {
              if: { $gt: ['$totalWithDeliveryData', 0] },
              then: { $round: [{ $multiply: [{ $divide: ['$onTimeDeliveries', '$totalWithDeliveryData'] }, 100] }, 2] },
              else: 0
            }
          }
        }
      }
    ]);

    return result[0] || {
      totalDelivered: 0,
      averageProcessingTime: 0,
      onTimeDeliveries: 0,
      lateDeliveries: 0,
      onTimePercentage: 0
    };
  }

  /**
   * Get return and cancellation metrics
   */
  async getReturnCancellationMetrics(filters = {}) {
    const Order = mongoose.model('Order');
    
    const [returnMetrics, cancellationMetrics] = await Promise.all([
      Order.aggregate([
        { $match: { ...filters, 'returnInfo.returnRequests': { $exists: true, $ne: [] } } },
        { $unwind: '$returnInfo.returnRequests' },
        {
          $group: {
            _id: '$returnInfo.returnRequests.reason',
            count: { $sum: 1 },
            totalRefundAmount: { $sum: '$returnInfo.returnRequests.refundAmount' }
          }
        },
        { $sort: { count: -1 } }
      ]),
      Order.aggregate([
        { $match: { ...filters, status: 'cancelled', cancellationInfo: { $exists: true } } },
        {
          $group: {
            _id: '$cancellationInfo.reason',
            count: { $sum: 1 },
            totalRefundAmount: { $sum: '$cancellationInfo.refundAmount' }
          }
        },
        { $sort: { count: -1 } }
      ])
    ]);

    return {
      returns: returnMetrics,
      cancellations: cancellationMetrics
    };
  }

  /**
   * Generate comprehensive business report
   */
  async generateBusinessReport(filters = {}) {
    try {
      const [
        orderStats,
        sellerPerformance,
        fulfillmentMetrics,
        returnCancellationMetrics,
        geographicDistribution
      ] = await Promise.all([
        this.getOrderStatistics(filters),
        this.getSellerPerformance(null, 30),
        this.getFulfillmentMetrics(filters),
        this.getReturnCancellationMetrics(filters),
        this.getGeographicDistribution(filters)
      ]);

      const report = {
        summary: {
          reportPeriod: filters.dateFrom && filters.dateTo ? 
            `${filters.dateFrom} to ${filters.dateTo}` : 'All time',
          generatedAt: new Date(),
          totalOrders: orderStats.overall.totalOrders,
          totalRevenue: orderStats.overall.totalRevenue,
          averageOrderValue: orderStats.overall.averageOrderValue
        },
        orderAnalytics: orderStats,
        sellerPerformance: {
          topSellers: sellerPerformance.slice(0, 10),
          totalSellers: sellerPerformance.length
        },
        operationalMetrics: {
          fulfillment: fulfillmentMetrics,
          returns: returnCancellationMetrics
        },
        geographic: geographicDistribution,
        recommendations: this.generateRecommendations(orderStats, fulfillmentMetrics, returnCancellationMetrics)
      };

      return report;

    } catch (error) {
      logger.error('Business report generation failed', { error: error.message, filters });
      throw error;
    }
  }

  /**
   * Get geographic distribution of orders
   */
  async getGeographicDistribution(filters = {}) {
    const Order = mongoose.model('Order');
    
    const result = await Order.aggregate([
      { $match: { ...filters, status: { $nin: ['cancelled', 'refunded'] } } },
      {
        $group: {
          _id: {
            state: '$shippingAddress.state',
            city: '$shippingAddress.city'
          },
          orderCount: { $sum: 1 },
          revenue: { $sum: '$pricing.totalPrice' }
        }
      },
      {
        $group: {
          _id: '$_id.state',
          cities: {
            $push: {
              city: '$_id.city',
              orderCount: '$orderCount',
              revenue: '$revenue'
            }
          },
          stateOrderCount: { $sum: '$orderCount' },
          stateRevenue: { $sum: '$revenue' }
        }
      },
      {
        $project: {
          state: '$_id',
          cities: 1,
          orderCount: '$stateOrderCount',
          revenue: { $round: ['$stateRevenue', 2] }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    return result;
  }

  /**
   * Generate business recommendations based on analytics
   */
  generateRecommendations(orderStats, fulfillmentMetrics, returnMetrics) {
    const recommendations = [];

    // Revenue recommendations
    if (orderStats.overall.averageOrderValue < 1000) {
      recommendations.push({
        category: 'Revenue',
        priority: 'high',
        message: 'Consider implementing cross-selling and upselling strategies to increase average order value',
        target: 'Increase AOV by 20%'
      });
    }

    // Fulfillment recommendations
    if (fulfillmentMetrics.onTimePercentage < 90) {
      recommendations.push({
        category: 'Operations',
        priority: 'high',
        message: 'Improve delivery performance - currently only ' + fulfillmentMetrics.onTimePercentage + '% on-time deliveries',
        target: 'Achieve 95% on-time delivery rate'
      });
    }

    // Return rate recommendations
    const returnRate = (returnMetrics.returns.length / orderStats.overall.totalOrders) * 100;
    if (returnRate > 5) {
      recommendations.push({
        category: 'Quality',
        priority: 'medium',
        message: 'High return rate (' + returnRate.toFixed(2) + '%) indicates potential quality issues',
        target: 'Reduce return rate to below 3%'
      });
    }

    // Customer retention recommendations
    const newCustomerRatio = orderStats.insights.customerSegmentation.find(s => s.segment === 'New')?.customerCount || 0;
    const totalCustomers = orderStats.overall.uniqueCustomers;
    if (newCustomerRatio / totalCustomers > 0.7) {
      recommendations.push({
        category: 'Customer Retention',
        priority: 'medium',
        message: 'High percentage of new customers suggests need for better retention strategies',
        target: 'Implement loyalty program and email marketing'
      });
    }

    return recommendations;
  }

  /**
   * Cache management
   */
  getCachedResult(key) {
    const cached = this.aggregationCache.get(key);
    if (cached && cached.timestamp > Date.now() - this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  setCachedResult(key, data) {
    this.aggregationCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Clear analytics cache
   */
  clearCache() {
    this.aggregationCache.clear();
    logger.info('Order analytics cache cleared');
  }

  /**
   * Get real-time metrics for dashboard
   */
  async getRealTimeMetrics() {
    try {
      const Order = mongoose.model('Order');
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [
        lastHourOrders,
        last24HourOrders,
        pendingOrders,
        processingOrders,
        recentHighValueOrders
      ] = await Promise.all([
        Order.countDocuments({ createdAt: { $gte: oneHourAgo } }),
        Order.countDocuments({ createdAt: { $gte: oneDayAgo } }),
        Order.countDocuments({ status: 'pending' }),
        Order.countDocuments({ status: { $in: ['confirmed', 'preparing', 'ready_to_ship'] } }),
        Order.find({
          createdAt: { $gte: oneDayAgo },
          'pricing.totalPrice': { $gte: 5000 }
        }).countDocuments()
      ]);

      return {
        lastHour: {
          orders: lastHourOrders
        },
        last24Hours: {
          orders: last24HourOrders,
          highValueOrders: recentHighValueOrders
        },
        operational: {
          pendingOrders,
          processingOrders,
          alertLevel: pendingOrders > 50 ? 'high' : pendingOrders > 20 ? 'medium' : 'low'
        },
        timestamp: now
      };

    } catch (error) {
      logger.error('Real-time metrics failed', { error: error.message });
      throw error;
    }
  }
}

module.exports = new OrderAnalytics();
