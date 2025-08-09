// services/analyticsService.js - Advanced Analytics & Business Intelligence

const mongoose = require('mongoose');
const ProductAdvanced = require('../models/ProductAdvanced');
const Order = require('../models/order');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Review = require('../models/Review');

class AnalyticsService {
  constructor() {
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.cache = new Map();
  }

  /**
   * Get comprehensive dashboard analytics
   */
  async getDashboardAnalytics(options = {}) {
    try {
      const { 
        dateRange = 'last_30_days',
        userId = null,
        sellerId = null,
        isAdmin = false 
      } = options;

      const dateFilter = this.getDateFilter(dateRange);
      const cacheKey = `dashboard_${dateRange}_${userId || sellerId || 'admin'}`;

      // Check cache
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.data;
        }
      }

      let analytics;

      if (isAdmin) {
        analytics = await this.getAdminAnalytics(dateFilter);
      } else if (sellerId) {
        analytics = await this.getSellerAnalytics(sellerId, dateFilter);
      } else if (userId) {
        analytics = await this.getUserAnalytics(userId, dateFilter);
      } else {
        analytics = await this.getPublicAnalytics(dateFilter);
      }

      // Cache results
      this.cache.set(cacheKey, {
        data: analytics,
        timestamp: Date.now()
      });

      return analytics;

    } catch (error) {
      console.error('Error getting dashboard analytics:', error);
      throw error;
    }
  }

  /**
   * Admin Analytics - Platform Overview
   */
  async getAdminAnalytics(dateFilter) {
    try {
      const [
        salesMetrics,
        userMetrics,
        productMetrics,
        orderMetrics,
        sellerMetrics,
        revenueAnalysis,
        geographicData,
        performanceMetrics
      ] = await Promise.all([
        this.getSalesMetrics(dateFilter),
        this.getUserMetrics(dateFilter),
        this.getProductMetrics(dateFilter),
        this.getOrderMetrics(dateFilter),
        this.getSellerMetrics(dateFilter),
        this.getRevenueAnalysis(dateFilter),
        this.getGeographicData(dateFilter),
        this.getPerformanceMetrics(dateFilter)
      ]);

      return {
        overview: {
          totalRevenue: salesMetrics.totalRevenue,
          totalOrders: orderMetrics.totalOrders,
          totalUsers: userMetrics.totalUsers,
          totalSellers: sellerMetrics.totalSellers,
          averageOrderValue: salesMetrics.averageOrderValue,
          conversionRate: salesMetrics.conversionRate,
          customerAcquisitionCost: userMetrics.acquisitionCost,
          customerLifetimeValue: userMetrics.lifetimeValue
        },
        sales: salesMetrics,
        users: userMetrics,
        products: productMetrics,
        orders: orderMetrics,
        sellers: sellerMetrics,
        revenue: revenueAnalysis,
        geographic: geographicData,
        performance: performanceMetrics,
        trends: await this.getTrendAnalysis(dateFilter),
        insights: await this.generateInsights(dateFilter)
      };

    } catch (error) {
      console.error('Error getting admin analytics:', error);
      throw error;
    }
  }

  /**
   * Seller Analytics - Individual Seller Performance
   */
  async getSellerAnalytics(sellerId, dateFilter) {
    try {
      const seller = await Seller.findById(sellerId);
      if (!seller) {
        throw new Error('Seller not found');
      }

      const [
        salesData,
        productData,
        orderData,
        customerData,
        reviewData,
        competitorData
      ] = await Promise.all([
        this.getSellerSalesData(sellerId, dateFilter),
        this.getSellerProductData(sellerId, dateFilter),
        this.getSellerOrderData(sellerId, dateFilter),
        this.getSellerCustomerData(sellerId, dateFilter),
        this.getSellerReviewData(sellerId, dateFilter),
        this.getCompetitorAnalysis(sellerId, dateFilter)
      ]);

      return {
        seller: {
          id: seller._id,
          businessName: seller.businessInfo.businessName,
          rating: seller.performance.rating.average,
          level: seller.sellerLevel,
          joinedDate: seller.createdAt
        },
        performance: {
          totalRevenue: salesData.totalRevenue,
          totalOrders: orderData.totalOrders,
          averageOrderValue: salesData.averageOrderValue,
          conversionRate: salesData.conversionRate,
          customerSatisfaction: reviewData.averageRating,
          onTimeDelivery: seller.performance.fulfillment.onTimeDeliveryRate,
          returnRate: seller.performance.fulfillment.returnRate
        },
        sales: salesData,
        products: productData,
        orders: orderData,
        customers: customerData,
        reviews: reviewData,
        competition: competitorData,
        recommendations: await this.getSellerRecommendations(sellerId)
      };

    } catch (error) {
      console.error('Error getting seller analytics:', error);
      throw error;
    }
  }

  /**
   * User Analytics - Customer Behavior
   */
  async getUserAnalytics(userId, dateFilter) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const [
        purchaseHistory,
        browsingBehavior,
        preferences,
        recommendations,
        savings
      ] = await Promise.all([
        this.getUserPurchaseHistory(userId, dateFilter),
        this.getUserBrowsingBehavior(userId, dateFilter),
        this.getUserPreferences(userId),
        this.getUserRecommendations(userId),
        this.getUserSavings(userId, dateFilter)
      ]);

      return {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          joinedDate: user.createdAt,
          loyaltyPoints: user.loyaltyPoints || 0
        },
        purchases: purchaseHistory,
        behavior: browsingBehavior,
        preferences,
        recommendations,
        savings,
        insights: await this.generateUserInsights(userId, dateFilter)
      };

    } catch (error) {
      console.error('Error getting user analytics:', error);
      throw error;
    }
  }

  /**
   * Sales Metrics Analysis
   */
  async getSalesMetrics(dateFilter) {
    try {
      const salesData = await Order.aggregate([
        { $match: { ...dateFilter, paymentStatus: 'paid' } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalAmount' },
            totalOrders: { $sum: 1 },
            averageOrderValue: { $avg: '$totalAmount' },
            totalItems: { $sum: { $size: '$items' } },
            uniqueCustomers: { $addToSet: '$user' }
          }
        },
        {
          $project: {
            totalRevenue: 1,
            totalOrders: 1,
            averageOrderValue: { $round: ['$averageOrderValue', 2] },
            totalItems: 1,
            uniqueCustomers: { $size: '$uniqueCustomers' }
          }
        }
      ]);

      const result = salesData[0] || {
        totalRevenue: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        totalItems: 0,
        uniqueCustomers: 0
      };

      // Calculate conversion rate
      const totalSessions = await this.getTotalSessions(dateFilter);
      result.conversionRate = totalSessions > 0 
        ? ((result.totalOrders / totalSessions) * 100).toFixed(2)
        : 0;

      // Get daily sales trend
      result.dailyTrend = await this.getDailySalesTrend(dateFilter);

      // Get top selling products
      result.topProducts = await this.getTopSellingProducts(dateFilter, 10);

      return result;

    } catch (error) {
      console.error('Error getting sales metrics:', error);
      throw error;
    }
  }

  /**
   * User Metrics Analysis
   */
  async getUserMetrics(dateFilter) {
    try {
      const userStats = await User.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            newUsers: { $sum: { $cond: [{ $gte: ['$createdAt', dateFilter.createdAt.$gte] }, 1, 0] } },
            activeUsers: { $sum: { $cond: [{ $gte: ['$lastLoginAt', dateFilter.createdAt.$gte] }, 1, 0] } }
          }
        }
      ]);

      const result = userStats[0] || { totalUsers: 0, newUsers: 0, activeUsers: 0 };

      // Calculate user acquisition cost and lifetime value
      result.acquisitionCost = await this.calculateAcquisitionCost(dateFilter);
      result.lifetimeValue = await this.calculateLifetimeValue(dateFilter);
      result.retentionRate = await this.calculateRetentionRate(dateFilter);
      result.churnRate = (100 - result.retentionRate).toFixed(2);

      // Get user demographics
      result.demographics = await this.getUserDemographics(dateFilter);

      return result;

    } catch (error) {
      console.error('Error getting user metrics:', error);
      throw error;
    }
  }

  /**
   * Product Performance Metrics
   */
  async getProductMetrics(dateFilter) {
    try {
      const productStats = await ProductAdvanced.aggregate([
        { $match: { ...dateFilter, status: 'active' } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            averageRating: { $avg: '$reviews.averageRating' },
            totalViews: { $sum: '$analytics.views' },
            totalRevenue: { $sum: '$analytics.revenue' }
          }
        }
      ]);

      const result = productStats[0] || {
        totalProducts: 0,
        averageRating: 0,
        totalViews: 0,
        totalRevenue: 0
      };

      // Get category performance
      result.categoryPerformance = await this.getCategoryPerformance(dateFilter);

      // Get inventory insights
      result.inventory = await this.getInventoryInsights();

      // Get product trends
      result.trends = await this.getProductTrends(dateFilter);

      return result;

    } catch (error) {
      console.error('Error getting product metrics:', error);
      throw error;
    }
  }

  /**
   * Revenue Analysis
   */
  async getRevenueAnalysis(dateFilter) {
    try {
      const revenueBreakdown = await Order.aggregate([
        { $match: { ...dateFilter, paymentStatus: 'paid' } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            revenue: { $sum: '$totalAmount' },
            orders: { $sum: 1 },
            averageOrderValue: { $avg: '$totalAmount' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]);

      // Calculate growth rates
      const growthAnalysis = this.calculateGrowthRates(revenueBreakdown);

      // Get payment method breakdown
      const paymentBreakdown = await this.getPaymentMethodBreakdown(dateFilter);

      // Get refund analysis
      const refundAnalysis = await this.getRefundAnalysis(dateFilter);

      return {
        breakdown: revenueBreakdown,
        growth: growthAnalysis,
        payments: paymentBreakdown,
        refunds: refundAnalysis,
        forecasting: await this.generateRevenueForecast(revenueBreakdown)
      };

    } catch (error) {
      console.error('Error getting revenue analysis:', error);
      throw error;
    }
  }

  /**
   * Geographic Data Analysis
   */
  async getGeographicData(dateFilter) {
    try {
      const geoData = await Order.aggregate([
        { $match: { ...dateFilter, paymentStatus: 'paid' } },
        {
          $group: {
            _id: {
              state: '$shippingAddress.state',
              city: '$shippingAddress.city'
            },
            orders: { $sum: 1 },
            revenue: { $sum: '$totalAmount' },
            customers: { $addToSet: '$user' }
          }
        },
        {
          $project: {
            state: '$_id.state',
            city: '$_id.city',
            orders: 1,
            revenue: 1,
            customers: { $size: '$customers' },
            averageOrderValue: { $divide: ['$revenue', '$orders'] }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 50 }
      ]);

      return {
        topStates: this.groupByState(geoData),
        topCities: geoData.slice(0, 20),
        heatmapData: await this.generateHeatmapData(geoData)
      };

    } catch (error) {
      console.error('Error getting geographic data:', error);
      throw error;
    }
  }

  /**
   * Performance Metrics
   */
  async getPerformanceMetrics(dateFilter) {
    try {
      const [
        pageLoadTimes,
        conversionFunnel,
        customerSatisfaction,
        operationalMetrics
      ] = await Promise.all([
        this.getPageLoadTimes(dateFilter),
        this.getConversionFunnel(dateFilter),
        this.getCustomerSatisfaction(dateFilter),
        this.getOperationalMetrics(dateFilter)
      ]);

      return {
        technical: {
          averagePageLoadTime: pageLoadTimes.average,
          slowestPages: pageLoadTimes.slowest,
          uptimePercentage: 99.9 // Would come from monitoring service
        },
        conversion: conversionFunnel,
        satisfaction: customerSatisfaction,
        operational: operationalMetrics
      };

    } catch (error) {
      console.error('Error getting performance metrics:', error);
      throw error;
    }
  }

  /**
   * Generate Business Insights
   */
  async generateInsights(dateFilter) {
    try {
      const insights = [];

      // Revenue insights
      const revenueGrowth = await this.calculateRevenueGrowth(dateFilter);
      if (revenueGrowth > 10) {
        insights.push({
          type: 'positive',
          category: 'revenue',
          title: 'Strong Revenue Growth',
          description: `Revenue has grown by ${revenueGrowth.toFixed(1)}% compared to the previous period`,
          actionable: true,
          recommendation: 'Consider increasing marketing spend to capitalize on this growth'
        });
      }

      // Customer insights
      const churnRate = await this.calculateChurnRate(dateFilter);
      if (churnRate > 5) {
        insights.push({
          type: 'warning',
          category: 'customers',
          title: 'High Customer Churn',
          description: `Customer churn rate is ${churnRate.toFixed(1)}%, which is above the healthy threshold`,
          actionable: true,
          recommendation: 'Implement customer retention campaigns and improve customer service'
        });
      }

      // Product insights
      const lowStockProducts = await this.getLowStockProducts();
      if (lowStockProducts.length > 0) {
        insights.push({
          type: 'alert',
          category: 'inventory',
          title: 'Low Stock Alert',
          description: `${lowStockProducts.length} products are running low on stock`,
          actionable: true,
          recommendation: 'Reorder inventory for these products to avoid stockouts'
        });
      }

      return insights;

    } catch (error) {
      console.error('Error generating insights:', error);
      return [];
    }
  }

  // Helper Methods

  getDateFilter(dateRange) {
    const now = new Date();
    let startDate;

    switch (dateRange) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'yesterday':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
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
      case 'this_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        break;
      case 'this_year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return {
      createdAt: { $gte: startDate, $lte: now }
    };
  }

  async getDailySalesTrend(dateFilter) {
    const dailyTrend = await Order.aggregate([
      { $match: { ...dateFilter, paymentStatus: 'paid' } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          revenue: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    return dailyTrend.map(day => ({
      date: new Date(day._id.year, day._id.month - 1, day._id.day),
      revenue: day.revenue,
      orders: day.orders
    }));
  }

  async getTopSellingProducts(dateFilter, limit = 10) {
    return await Order.aggregate([
      { $match: { ...dateFilter, paymentStatus: 'paid' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          totalSold: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalSold: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'productadvanceds',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          productId: '$_id',
          productName: '$product.title',
          totalSold: 1,
          totalRevenue: 1
        }
      }
    ]);
  }

  calculateGrowthRates(data) {
    if (data.length < 2) return { daily: 0, weekly: 0, monthly: 0 };

    const latest = data[data.length - 1];
    const previous = data[data.length - 2];

    const dailyGrowth = previous.revenue > 0 
      ? ((latest.revenue - previous.revenue) / previous.revenue * 100).toFixed(2)
      : 0;

    return {
      daily: parseFloat(dailyGrowth),
      trend: latest.revenue > previous.revenue ? 'up' : 'down'
    };
  }

  groupByState(geoData) {
    const stateMap = {};
    
    geoData.forEach(item => {
      if (!stateMap[item.state]) {
        stateMap[item.state] = {
          state: item.state,
          orders: 0,
          revenue: 0,
          customers: 0,
          cities: 0
        };
      }
      
      stateMap[item.state].orders += item.orders;
      stateMap[item.state].revenue += item.revenue;
      stateMap[item.state].customers += item.customers;
      stateMap[item.state].cities++;
    });

    return Object.values(stateMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }

  // Placeholder methods for complex calculations
  async getTotalSessions(dateFilter) { return 10000; }
  async calculateAcquisitionCost(dateFilter) { return 25; }
  async calculateLifetimeValue(dateFilter) { return 500; }
  async calculateRetentionRate(dateFilter) { return 85; }
  async getUserDemographics(dateFilter) { return {}; }
  async getCategoryPerformance(dateFilter) { return []; }
  async getInventoryInsights() { return {}; }
  async getProductTrends(dateFilter) { return []; }
  async getPaymentMethodBreakdown(dateFilter) { return []; }
  async getRefundAnalysis(dateFilter) { return {}; }
  async generateRevenueForecast(data) { return []; }
  async generateHeatmapData(geoData) { return []; }
  async getPageLoadTimes(dateFilter) { return { average: 1.2, slowest: [] }; }
  async getConversionFunnel(dateFilter) { return {}; }
  async getCustomerSatisfaction(dateFilter) { return { score: 4.5, trend: 'up' }; }
  async getOperationalMetrics(dateFilter) { return {}; }
  async calculateRevenueGrowth(dateFilter) { return 15; }
  async calculateChurnRate(dateFilter) { return 3; }
  async getLowStockProducts() { return []; }
}

module.exports = new AnalyticsService();
