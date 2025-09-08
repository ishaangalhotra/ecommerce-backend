const mongoose = require('mongoose');
const { memoryCache } = require('./database-optimization');

// Performance Monitoring System for E-commerce Platform
class PerformanceMonitoringSystem {
  
  constructor() {
    this.metrics = new Map();
    this.apiMetrics = new Map();
    this.alertThresholds = {
      responseTime: 1000, // ms
      errorRate: 0.05, // 5%
      memoryUsage: 0.85, // 85%
      dbConnections: 80 // percentage of pool
    };
    this.startTime = Date.now();
    this.initialize();
  }

  initialize() {
    this.setupSystemMetrics();
    this.setupApiMetrics();
    this.setupPeriodicReports();
    console.log('📊 Performance Monitoring System initialized');
  }

  // System Performance Metrics
  setupSystemMetrics() {
    setInterval(() => {
      this.collectSystemMetrics();
    }, 10000); // Every 10 seconds
  }

  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    const metrics = {
      timestamp: new Date(),
      memory: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        heapUtilization: (memUsage.heapUsed / memUsage.heapTotal) * 100
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime(),
      connections: mongoose.connection.readyState,
      eventLoop: this.getEventLoopLag()
    };

    this.metrics.set('system', metrics);
    
    // Check for alerts
    this.checkSystemAlerts(metrics);
  }

  getEventLoopLag() {
    const start = process.hrtime.bigint();
    return new Promise(resolve => {
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms
        resolve(lag);
      });
    });
  }

  // API Performance Monitoring Middleware
  createApiMonitoringMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const originalSend = res.send;
      
      // Override res.send to capture response
      res.send = function(data) {
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        // Record API metrics
        this.recordApiMetrics(req, res, responseTime);
        
        return originalSend.call(this, data);
      }.bind(this);
      
      next();
    };
  }

  recordApiMetrics(req, res, responseTime) {
    const endpoint = `${req.method} ${req.route?.path || req.path}`;
    const statusCode = res.statusCode;
    const isError = statusCode >= 400;
    
    if (!this.apiMetrics.has(endpoint)) {
      this.apiMetrics.set(endpoint, {
        totalRequests: 0,
        totalErrors: 0,
        totalResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        statusCodes: {},
        recentRequests: []
      });
    }
    
    const metrics = this.apiMetrics.get(endpoint);
    metrics.totalRequests++;
    
    if (isError) {
      metrics.totalErrors++;
    }
    
    metrics.totalResponseTime += responseTime;
    metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTime);
    metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTime);
    
    // Track status codes
    metrics.statusCodes[statusCode] = (metrics.statusCodes[statusCode] || 0) + 1;
    
    // Keep recent requests for detailed analysis
    metrics.recentRequests.push({
      timestamp: new Date(),
      responseTime,
      statusCode,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    
    // Keep only last 100 requests
    if (metrics.recentRequests.length > 100) {
      metrics.recentRequests.shift();
    }
    
    // Check for performance alerts
    this.checkApiAlerts(endpoint, responseTime, isError);
  }

  // Database Performance Monitoring
  setupDatabaseMetrics() {
    return {
      // MongoDB connection monitoring
      getConnectionMetrics: async () => {
        try {
          const admin = mongoose.connection.db.admin();
          const serverStatus = await admin.serverStatus();
          
          return {
            connections: serverStatus.connections,
            opcounters: serverStatus.opcounters,
            mem: serverStatus.mem,
            network: serverStatus.network,
            uptime: serverStatus.uptime
          };
        } catch (error) {
          console.error('Database metrics error:', error);
          return null;
        }
      },

      // Query performance tracking
      trackSlowQueries: (threshold = 100) => {
        mongoose.set('debug', (collectionName, method, query, doc) => {
          const start = Date.now();
          
          setTimeout(() => {
            const duration = Date.now() - start;
            if (duration > threshold) {
              this.recordSlowQuery({
                collection: collectionName,
                method,
                query,
                duration,
                timestamp: new Date()
              });
            }
          }, 0);
        });
      }
    };
  }

  recordSlowQuery(queryData) {
    if (!this.metrics.has('slowQueries')) {
      this.metrics.set('slowQueries', []);
    }
    
    const slowQueries = this.metrics.get('slowQueries');
    slowQueries.push(queryData);
    
    // Keep only last 50 slow queries
    if (slowQueries.length > 50) {
      slowQueries.shift();
    }
    
    console.warn(`🐌 Slow query detected: ${queryData.collection}.${queryData.method} (${queryData.duration}ms)`);
  }

  // Real-time Analytics Dashboard
  getAnalyticsDashboard() {
    const systemMetrics = this.metrics.get('system');
    const dbMetrics = this.metrics.get('database');
    const slowQueries = this.metrics.get('slowQueries') || [];
    
    // API metrics summary
    const apiSummary = {};
    for (const [endpoint, metrics] of this.apiMetrics) {
      apiSummary[endpoint] = {
        totalRequests: metrics.totalRequests,
        errorRate: (metrics.totalErrors / metrics.totalRequests) * 100,
        avgResponseTime: metrics.totalResponseTime / metrics.totalRequests,
        minResponseTime: metrics.minResponseTime === Infinity ? 0 : metrics.minResponseTime,
        maxResponseTime: metrics.maxResponseTime,
        statusCodes: metrics.statusCodes,
        recentActivity: metrics.recentRequests.slice(-10)
      };
    }
    
    return {
      overview: {
        uptime: process.uptime(),
        startTime: this.startTime,
        totalMemoryUsage: systemMetrics?.memory?.heapUtilization || 0,
        totalApiRequests: Array.from(this.apiMetrics.values()).reduce((sum, m) => sum + m.totalRequests, 0),
        totalApiErrors: Array.from(this.apiMetrics.values()).reduce((sum, m) => sum + m.totalErrors, 0),
        cacheStats: memoryCache.getStats(),
        timestamp: new Date()
      },
      system: systemMetrics,
      api: apiSummary,
      database: dbMetrics,
      slowQueries: slowQueries.slice(-10),
      alerts: this.getActiveAlerts()
    };
  }

  // Business Analytics
  async getBusinessAnalytics(timeframe = '24h') {
    try {
      const startDate = new Date();
      const endDate = new Date();
      
      switch (timeframe) {
        case '1h':
          startDate.setHours(startDate.getHours() - 1);
          break;
        case '24h':
          startDate.setHours(startDate.getHours() - 24);
          break;
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
      }

      // Get models
      const Order = mongoose.model('Order');
      const User = mongoose.model('User');
      const Product = mongoose.model('Product');
      
      const [
        orderStats,
        userStats,
        productStats,
        revenueStats
      ] = await Promise.all([
        this.getOrderAnalytics(startDate, endDate),
        this.getUserAnalytics(startDate, endDate),
        this.getProductAnalytics(startDate, endDate),
        this.getRevenueAnalytics(startDate, endDate)
      ]);

      return {
        timeframe,
        period: { startDate, endDate },
        orders: orderStats,
        users: userStats,
        products: productStats,
        revenue: revenueStats,
        timestamp: new Date()
      };

    } catch (error) {
      console.error('Business analytics error:', error);
      return null;
    }
  }

  async getOrderAnalytics(startDate, endDate) {
    const Order = mongoose.model('Order');
    
    const pipeline = [
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$total' },
          avgOrderValue: { $avg: '$total' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          }
        }
      }
    ];

    const [stats] = await Order.aggregate(pipeline);
    
    return stats || {
      totalOrders: 0,
      totalRevenue: 0,
      avgOrderValue: 0,
      completedOrders: 0,
      cancelledOrders: 0
    };
  }

  async getUserAnalytics(startDate, endDate) {
    const User = mongoose.model('User');
    
    const [totalUsers, newUsers, activeUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate }
      }),
      User.countDocuments({
        lastLogin: { $gte: startDate, $lte: endDate }
      })
    ]);

    return {
      totalUsers,
      newUsers,
      activeUsers,
      retentionRate: totalUsers > 0 ? (activeUsers / totalUsers * 100).toFixed(2) : 0
    };
  }

  async getProductAnalytics(startDate, endDate) {
    const Product = mongoose.model('Product');
    
    const [
      totalProducts,
      newProducts,
      topProducts
    ] = await Promise.all([
      Product.countDocuments({ status: 'active' }),
      Product.countDocuments({
        createdAt: { $gte: startDate, $lte: endDate }
      }),
      Product.find({ status: 'active' })
        .sort({ views: -1, totalSales: -1 })
        .limit(10)
        .select('name views totalSales averageRating')
        .lean()
    ]);

    return {
      totalProducts,
      newProducts,
      topProducts
    };
  }

  async getRevenueAnalytics(startDate, endDate) {
    const Order = mongoose.model('Order');
    
    const pipeline = [
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: { $in: ['delivered', 'shipped'] }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          dailyRevenue: { $sum: '$total' },
          dailyOrders: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ];

    const dailyStats = await Order.aggregate(pipeline);
    
    const totalRevenue = dailyStats.reduce((sum, day) => sum + day.dailyRevenue, 0);
    const totalOrders = dailyStats.reduce((sum, day) => sum + day.dailyOrders, 0);

    return {
      totalRevenue,
      totalOrders,
      avgDailyRevenue: dailyStats.length > 0 ? totalRevenue / dailyStats.length : 0,
      dailyBreakdown: dailyStats
    };
  }

  // Alert System
  checkSystemAlerts(metrics) {
    const alerts = [];
    
    // Memory usage alert
    if (metrics.memory.heapUtilization > this.alertThresholds.memoryUsage * 100) {
      alerts.push({
        type: 'memory',
        severity: 'warning',
        message: `High memory usage: ${metrics.memory.heapUtilization.toFixed(2)}%`,
        threshold: this.alertThresholds.memoryUsage * 100,
        actual: metrics.memory.heapUtilization,
        timestamp: new Date()
      });
    }
    
    if (alerts.length > 0) {
      this.handleAlerts(alerts);
    }
  }

  checkApiAlerts(endpoint, responseTime, isError) {
    const alerts = [];
    const metrics = this.apiMetrics.get(endpoint);
    const errorRate = metrics.totalErrors / metrics.totalRequests;
    
    // Response time alert
    if (responseTime > this.alertThresholds.responseTime) {
      alerts.push({
        type: 'response_time',
        severity: 'warning',
        endpoint,
        message: `Slow response time: ${responseTime}ms`,
        threshold: this.alertThresholds.responseTime,
        actual: responseTime,
        timestamp: new Date()
      });
    }
    
    // Error rate alert
    if (errorRate > this.alertThresholds.errorRate && metrics.totalRequests > 10) {
      alerts.push({
        type: 'error_rate',
        severity: 'critical',
        endpoint,
        message: `High error rate: ${(errorRate * 100).toFixed(2)}%`,
        threshold: this.alertThresholds.errorRate * 100,
        actual: errorRate * 100,
        timestamp: new Date()
      });
    }
    
    if (alerts.length > 0) {
      this.handleAlerts(alerts);
    }
  }

  handleAlerts(alerts) {
    if (!this.metrics.has('alerts')) {
      this.metrics.set('alerts', []);
    }
    
    const alertsArray = this.metrics.get('alerts');
    alerts.forEach(alert => {
      alertsArray.push(alert);
      console.warn(`🚨 Alert: ${alert.message}`);
    });
    
    // Keep only last 100 alerts
    if (alertsArray.length > 100) {
      alertsArray.splice(0, alertsArray.length - 100);
    }
  }

  getActiveAlerts() {
    const alerts = this.metrics.get('alerts') || [];
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    return alerts.filter(alert => alert.timestamp > oneHourAgo);
  }

  // Periodic Reports
  setupPeriodicReports() {
    // Generate hourly performance report
    setInterval(() => {
      this.generatePerformanceReport();
    }, 3600000); // Every hour
    
    // Generate daily business report
    setInterval(() => {
      this.generateBusinessReport();
    }, 86400000); // Every 24 hours
  }

  async generatePerformanceReport() {
    const dashboard = this.getAnalyticsDashboard();
    const report = {
      type: 'performance',
      timestamp: new Date(),
      period: 'last_hour',
      ...dashboard
    };
    
    // Store in memory cache
    memoryCache.set('performance_report_hourly', report, 7200000); // 2 hours cache
    
    console.log('📊 Hourly performance report generated');
    return report;
  }

  async generateBusinessReport() {
    const analytics = await this.getBusinessAnalytics('24h');
    const report = {
      type: 'business',
      timestamp: new Date(),
      period: 'last_24h',
      ...analytics
    };
    
    // Store in memory cache
    memoryCache.set('business_report_daily', report, 172800000); // 48 hours cache
    
    console.log('📈 Daily business report generated');
    return report;
  }

  // Export data for external monitoring tools
  exportMetrics(format = 'json') {
    const allMetrics = {
      system: this.metrics.get('system'),
      api: Object.fromEntries(this.apiMetrics),
      alerts: this.metrics.get('alerts') || [],
      timestamp: new Date()
    };
    
    switch (format) {
      case 'json':
        return JSON.stringify(allMetrics, null, 2);
      case 'prometheus':
        return this.formatPrometheusMetrics(allMetrics);
      default:
        return allMetrics;
    }
  }

  formatPrometheusMetrics(metrics) {
    let output = '';
    
    // System metrics
    if (metrics.system) {
      output += `# HELP nodejs_heap_used_bytes Process heap used\n`;
      output += `# TYPE nodejs_heap_used_bytes gauge\n`;
      output += `nodejs_heap_used_bytes ${metrics.system.memory.heapUsed}\n`;
      
      output += `# HELP nodejs_heap_total_bytes Process heap total\n`;
      output += `# TYPE nodejs_heap_total_bytes gauge\n`;
      output += `nodejs_heap_total_bytes ${metrics.system.memory.heapTotal}\n`;
    }
    
    // API metrics
    for (const [endpoint, data] of Object.entries(metrics.api)) {
      const cleanEndpoint = endpoint.replace(/[^a-zA-Z0-9_]/g, '_');
      
      output += `# HELP api_requests_total Total API requests\n`;
      output += `# TYPE api_requests_total counter\n`;
      output += `api_requests_total{endpoint="${endpoint}"} ${data.totalRequests}\n`;
      
      output += `# HELP api_response_time_avg Average response time\n`;
      output += `# TYPE api_response_time_avg gauge\n`;
      output += `api_response_time_avg{endpoint="${endpoint}"} ${data.avgResponseTime}\n`;
    }
    
    return output;
  }
}

// Routes for monitoring endpoints
const monitoringRoutes = (router) => {
  const monitor = new PerformanceMonitoringSystem();
  
  // Real-time dashboard
  router.get('/admin/monitoring/dashboard', (req, res) => {
    try {
      const dashboard = monitor.getAnalyticsDashboard();
      res.json({
        success: true,
        dashboard
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get dashboard data'
      });
    }
  });
  
  // Business analytics
  router.get('/admin/analytics/business', async (req, res) => {
    try {
      const { timeframe = '24h' } = req.query;
      const analytics = await monitor.getBusinessAnalytics(timeframe);
      
      res.json({
        success: true,
        analytics
      });
    } catch (error) {
      console.error('Business analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get business analytics'
      });
    }
  });
  
  // Export metrics
  router.get('/admin/monitoring/export', (req, res) => {
    try {
      const { format = 'json' } = req.query;
      const metrics = monitor.exportMetrics(format);
      
      if (format === 'prometheus') {
        res.setHeader('Content-Type', 'text/plain');
        res.send(metrics);
      } else {
        res.json({
          success: true,
          metrics: format === 'json' ? JSON.parse(metrics) : metrics
        });
      }
    } catch (error) {
      console.error('Export metrics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export metrics'
      });
    }
  });
  
  // Health check endpoint
  router.get('/health', (req, res) => {
    const systemMetrics = monitor.metrics.get('system');
    const activeAlerts = monitor.getActiveAlerts();
    
    const health = {
      status: activeAlerts.length === 0 ? 'healthy' : 'warning',
      timestamp: new Date(),
      uptime: process.uptime(),
      memory: systemMetrics?.memory || null,
      alerts: activeAlerts.length,
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    };
    
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  });
  
  return { router, monitor };
};

module.exports = {
  PerformanceMonitoringSystem,
  monitoringRoutes
};
