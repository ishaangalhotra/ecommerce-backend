const WebSocket = require('ws');
const mongoose = require('mongoose');
const { memoryCache } = require('./database-optimization');

// Real-time Inventory Management System
class RealtimeInventorySystem {
  
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map(); // Map of userId -> WebSocket connection
    this.adminClients = new Set(); // Set of admin WebSocket connections
    this.productSubscriptions = new Map(); // Map of productId -> Set of userIds
    this.stockAlerts = new Map(); // Map of productId -> alert thresholds
    this.priceWatchers = new Map(); // Map of productId -> Set of userIds watching for price drops
    
    this.initializeWebSocket();
    this.setupStockMonitoring();
    
    console.log('🔄 Real-time Inventory System initialized');
  }

  initializeWebSocket() {
    this.wss.on('connection', (ws, req) => {
      console.log('📡 WebSocket client connected');
      
      // Handle authentication
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (error) {
          console.error('WebSocket message parse error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format'
          }));
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
        console.log('📡 WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });
  }

  handleMessage(ws, data) {
    switch (data.type) {
      case 'auth':
        this.authenticateUser(ws, data);
        break;
        
      case 'subscribe_product':
        this.subscribeToProduct(ws, data.productId);
        break;
        
      case 'unsubscribe_product':
        this.unsubscribeFromProduct(ws, data.productId);
        break;
        
      case 'watch_price':
        this.watchProductPrice(ws, data.productId, data.targetPrice);
        break;
        
      case 'admin_monitor':
        this.subscribeAdminMonitoring(ws);
        break;
        
      case 'update_stock':
        this.updateProductStock(ws, data);
        break;
        
      case 'update_price':
        this.updateProductPrice(ws, data);
        break;
        
      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unknown message type'
        }));
    }
  }

  authenticateUser(ws, data) {
    const { userId, token, isAdmin } = data;
    
    // In production, verify the JWT token here
    if (userId) {
      ws.userId = userId;
      ws.isAdmin = isAdmin || false;
      
      this.clients.set(userId, ws);
      
      if (isAdmin) {
        this.adminClients.add(ws);
      }
      
      ws.send(JSON.stringify({
        type: 'auth_success',
        message: 'Authenticated successfully',
        userId: userId
      }));
      
      // Send initial stock updates for subscribed products
      this.sendInitialData(ws, userId);
    } else {
      ws.send(JSON.stringify({
        type: 'auth_failed',
        message: 'Invalid authentication credentials'
      }));
    }
  }

  async sendInitialData(ws, userId) {
    try {
      // Get user's cart items for stock monitoring
      const Cart = mongoose.model('Cart');
      const userCart = await Cart.findOne({ user: userId }).populate('items.product');
      
      if (userCart && userCart.items.length > 0) {
        for (const item of userCart.items) {
          if (item.product) {
            this.subscribeToProduct(ws, item.product._id.toString());
            
            // Send current stock status
            ws.send(JSON.stringify({
              type: 'stock_update',
              productId: item.product._id,
              stock: item.product.stock,
              price: item.product.price,
              available: item.product.stock > 0
            }));
          }
        }
      }
      
      // Get user's wishlist items
      const Wishlist = mongoose.model('Wishlist');
      const userWishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
      
      if (userWishlist && userWishlist.items.length > 0) {
        for (const item of userWishlist.items) {
          if (item.product) {
            this.subscribeToProduct(ws, item.product._id.toString());
            
            ws.send(JSON.stringify({
              type: 'wishlist_stock_update',
              productId: item.product._id,
              stock: item.product.stock,
              price: item.product.price,
              available: item.product.stock > 0
            }));
          }
        }
      }
      
    } catch (error) {
      console.error('Error sending initial data:', error);
    }
  }

  subscribeToProduct(ws, productId) {
    if (!ws.userId) return;
    
    if (!this.productSubscriptions.has(productId)) {
      this.productSubscriptions.set(productId, new Set());
    }
    
    this.productSubscriptions.get(productId).add(ws.userId);
    
    ws.send(JSON.stringify({
      type: 'subscription_confirmed',
      productId: productId
    }));
  }

  unsubscribeFromProduct(ws, productId) {
    if (!ws.userId) return;
    
    if (this.productSubscriptions.has(productId)) {
      this.productSubscriptions.get(productId).delete(ws.userId);
      
      if (this.productSubscriptions.get(productId).size === 0) {
        this.productSubscriptions.delete(productId);
      }
    }
    
    ws.send(JSON.stringify({
      type: 'unsubscription_confirmed',
      productId: productId
    }));
  }

  watchProductPrice(ws, productId, targetPrice) {
    if (!ws.userId) return;
    
    if (!this.priceWatchers.has(productId)) {
      this.priceWatchers.set(productId, new Set());
    }
    
    this.priceWatchers.get(productId).add(ws.userId);
    
    // Store target price for this user
    if (!ws.priceTargets) {
      ws.priceTargets = new Map();
    }
    ws.priceTargets.set(productId, targetPrice);
    
    ws.send(JSON.stringify({
      type: 'price_watch_confirmed',
      productId: productId,
      targetPrice: targetPrice
    }));
  }

  subscribeAdminMonitoring(ws) {
    if (ws.isAdmin) {
      this.adminClients.add(ws);
      
      ws.send(JSON.stringify({
        type: 'admin_monitoring_active',
        message: 'Now monitoring all inventory changes'
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Admin access required'
      }));
    }
  }

  async updateProductStock(ws, data) {
    if (!ws.isAdmin) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Admin access required'
      }));
      return;
    }

    try {
      const { productId, newStock, reason } = data;
      const Product = mongoose.model('Product');
      
      const product = await Product.findById(productId);
      if (!product) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Product not found'
        }));
        return;
      }

      const oldStock = product.stock;
      product.stock = newStock;
      
      // Update stock change history
      if (!product.stockHistory) {
        product.stockHistory = [];
      }
      
      product.stockHistory.push({
        previousStock: oldStock,
        newStock: newStock,
        change: newStock - oldStock,
        reason: reason || 'Manual update',
        updatedBy: ws.userId,
        timestamp: new Date()
      });
      
      await product.save();
      
      // Update memory cache
      memoryCache.delete(`product_${productId}`);
      
      // Broadcast stock update to all subscribers
      this.broadcastStockUpdate(productId, {
        stock: newStock,
        previousStock: oldStock,
        available: newStock > 0,
        lastUpdated: new Date()
      });
      
      // Check for low stock alerts
      this.checkLowStockAlert(productId, newStock, product.name);
      
      ws.send(JSON.stringify({
        type: 'stock_update_success',
        productId: productId,
        newStock: newStock
      }));
      
    } catch (error) {
      console.error('Stock update error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to update stock'
      }));
    }
  }

  async updateProductPrice(ws, data) {
    if (!ws.isAdmin) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Admin access required'
      }));
      return;
    }

    try {
      const { productId, newPrice, reason } = data;
      const Product = mongoose.model('Product');
      
      const product = await Product.findById(productId);
      if (!product) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Product not found'
        }));
        return;
      }

      const oldPrice = product.price;
      product.price = newPrice;
      
      // Update price change history
      if (!product.priceHistory) {
        product.priceHistory = [];
      }
      
      product.priceHistory.push({
        previousPrice: oldPrice,
        newPrice: newPrice,
        change: newPrice - oldPrice,
        reason: reason || 'Manual update',
        updatedBy: ws.userId,
        timestamp: new Date()
      });
      
      await product.save();
      
      // Update memory cache
      memoryCache.delete(`product_${productId}`);
      
      // Broadcast price update to all subscribers
      this.broadcastPriceUpdate(productId, {
        price: newPrice,
        previousPrice: oldPrice,
        change: newPrice - oldPrice,
        changePercent: ((newPrice - oldPrice) / oldPrice * 100).toFixed(2),
        lastUpdated: new Date()
      });
      
      // Notify price watchers
      this.notifyPriceWatchers(productId, newPrice, oldPrice);
      
      ws.send(JSON.stringify({
        type: 'price_update_success',
        productId: productId,
        newPrice: newPrice
      }));
      
    } catch (error) {
      console.error('Price update error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to update price'
      }));
    }
  }

  broadcastStockUpdate(productId, stockData) {
    if (!this.productSubscriptions.has(productId)) return;
    
    const subscribers = this.productSubscriptions.get(productId);
    const message = JSON.stringify({
      type: 'stock_update',
      productId: productId,
      ...stockData
    });
    
    subscribers.forEach(userId => {
      const ws = this.clients.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
    
    // Also notify admins
    this.notifyAdmins({
      type: 'admin_stock_update',
      productId: productId,
      ...stockData
    });
  }

  broadcastPriceUpdate(productId, priceData) {
    if (!this.productSubscriptions.has(productId)) return;
    
    const subscribers = this.productSubscriptions.get(productId);
    const message = JSON.stringify({
      type: 'price_update',
      productId: productId,
      ...priceData
    });
    
    subscribers.forEach(userId => {
      const ws = this.clients.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
    
    // Also notify admins
    this.notifyAdmins({
      type: 'admin_price_update',
      productId: productId,
      ...priceData
    });
  }

  notifyPriceWatchers(productId, newPrice, oldPrice) {
    if (!this.priceWatchers.has(productId)) return;
    
    const watchers = this.priceWatchers.get(productId);
    
    watchers.forEach(userId => {
      const ws = this.clients.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN && ws.priceTargets) {
        const targetPrice = ws.priceTargets.get(productId);
        
        if (targetPrice && newPrice <= targetPrice && oldPrice > targetPrice) {
          ws.send(JSON.stringify({
            type: 'price_drop_alert',
            productId: productId,
            newPrice: newPrice,
            targetPrice: targetPrice,
            discount: oldPrice - newPrice,
            discountPercent: ((oldPrice - newPrice) / oldPrice * 100).toFixed(2)
          }));
        }
      }
    });
  }

  checkLowStockAlert(productId, currentStock, productName) {
    const threshold = this.stockAlerts.get(productId) || 5; // Default threshold
    
    if (currentStock <= threshold && currentStock > 0) {
      this.notifyAdmins({
        type: 'low_stock_alert',
        productId: productId,
        productName: productName,
        currentStock: currentStock,
        threshold: threshold,
        severity: currentStock <= threshold / 2 ? 'critical' : 'warning'
      });
    } else if (currentStock === 0) {
      this.notifyAdmins({
        type: 'out_of_stock_alert',
        productId: productId,
        productName: productName,
        severity: 'critical'
      });
      
      // Notify all subscribers that product is out of stock
      this.broadcastStockUpdate(productId, {
        stock: 0,
        available: false,
        outOfStock: true
      });
    }
  }

  notifyAdmins(message) {
    const messageStr = JSON.stringify(message);
    
    this.adminClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  handleDisconnect(ws) {
    if (ws.userId) {
      this.clients.delete(ws.userId);
      
      // Remove from all product subscriptions
      this.productSubscriptions.forEach((subscribers, productId) => {
        subscribers.delete(ws.userId);
        if (subscribers.size === 0) {
          this.productSubscriptions.delete(productId);
        }
      });
      
      // Remove from price watchers
      this.priceWatchers.forEach((watchers, productId) => {
        watchers.delete(ws.userId);
        if (watchers.size === 0) {
          this.priceWatchers.delete(productId);
        }
      });
    }
    
    if (ws.isAdmin) {
      this.adminClients.delete(ws);
    }
  }

  // Setup automated stock monitoring
  setupStockMonitoring() {
    // Monitor for automatic stock updates from orders
    setInterval(() => {
      this.syncDatabaseChanges();
    }, 30000); // Every 30 seconds
    
    // Cleanup inactive connections
    setInterval(() => {
      this.cleanupConnections();
    }, 300000); // Every 5 minutes
  }

  async syncDatabaseChanges() {
    try {
      // Get products with recent stock changes
      const Product = mongoose.model('Product');
      const recentlyUpdated = await Product.find({
        updatedAt: { $gte: new Date(Date.now() - 30000) } // Last 30 seconds
      }).lean();

      for (const product of recentlyUpdated) {
        if (this.productSubscriptions.has(product._id.toString())) {
          this.broadcastStockUpdate(product._id.toString(), {
            stock: product.stock,
            price: product.price,
            available: product.stock > 0,
            lastUpdated: product.updatedAt
          });
        }
      }

    } catch (error) {
      console.error('Database sync error:', error);
    }
  }

  cleanupConnections() {
    this.clients.forEach((ws, userId) => {
      if (ws.readyState !== WebSocket.OPEN) {
        this.clients.delete(userId);
      }
    });
    
    this.adminClients.forEach(ws => {
      if (ws.readyState !== WebSocket.OPEN) {
        this.adminClients.delete(ws);
      }
    });
  }

  // API methods for integration with HTTP routes
  notifyStockChange(productId, newStock, oldStock) {
    this.broadcastStockUpdate(productId, {
      stock: newStock,
      previousStock: oldStock,
      available: newStock > 0,
      lastUpdated: new Date()
    });
  }

  notifyPriceChange(productId, newPrice, oldPrice) {
    this.broadcastPriceUpdate(productId, {
      price: newPrice,
      previousPrice: oldPrice,
      change: newPrice - oldPrice,
      changePercent: ((newPrice - oldPrice) / oldPrice * 100).toFixed(2),
      lastUpdated: new Date()
    });
  }

  getConnectionStats() {
    return {
      totalConnections: this.clients.size,
      adminConnections: this.adminClients.size,
      productSubscriptions: this.productSubscriptions.size,
      priceWatchers: this.priceWatchers.size,
      timestamp: new Date()
    };
  }
}

// Stock change detection middleware for MongoDB
const stockChangeMiddleware = (inventorySystem) => {
  return {
    // Middleware to detect product stock changes
    detectStockChanges: async function(next) {
      if (this.isModified('stock')) {
        const oldStock = this.getUpdate ? this.getUpdate().$set?.stock : this._original?.stock;
        const newStock = this.stock;
        
        // Notify real-time system after save
        this.constructor.schema.post('save', function() {
          if (inventorySystem) {
            inventorySystem.notifyStockChange(
              this._id.toString(), 
              newStock, 
              oldStock || 0
            );
          }
        });
      }
      
      if (this.isModified('price')) {
        const oldPrice = this.getUpdate ? this.getUpdate().$set?.price : this._original?.price;
        const newPrice = this.price;
        
        // Notify real-time system after save
        this.constructor.schema.post('save', function() {
          if (inventorySystem) {
            inventorySystem.notifyPriceChange(
              this._id.toString(), 
              newPrice, 
              oldPrice || 0
            );
          }
        });
      }
      
      next();
    }
  };
};

module.exports = {
  RealtimeInventorySystem,
  stockChangeMiddleware
};
