/**
 * Advanced Order Processing Engine
 * Handles order lifecycle, inventory management, and fraud detection
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const orderStatusManager = require('./orderStatusManager');

class OrderProcessingEngine {
  constructor() {
    this.processingQueue = new Map();
    this.fraudDetectionRules = [
      {
        name: 'high_value_order',
        condition: (order) => order.pricing.totalPrice > 10000,
        action: 'flag_for_review',
        riskScore: 20
      },
      {
        name: 'multiple_orders_same_ip',
        condition: async (order, context) => {
          const recentOrders = await this.getRecentOrdersByIP(context.ip, 24);
          return recentOrders.length > 3;
        },
        action: 'flag_for_review',
        riskScore: 30
      },
      {
        name: 'new_customer_high_value',
        condition: async (order) => {
          const customerOrderCount = await this.getCustomerOrderCount(order.user);
          return customerOrderCount === 0 && order.pricing.totalPrice > 5000;
        },
        action: 'flag_for_review',
        riskScore: 25
      }
    ];
  }

  /**
   * Process order with comprehensive validation and checks
   */
  async processOrder(orderData, context = {}) {
    const orderId = `temp_${Date.now()}`;
    this.processingQueue.set(orderId, {
      status: 'processing',
      startTime: new Date(),
      steps: []
    });

    try {
      logger.info('Starting order processing', { orderId, userId: orderData.userId });

      // Step 1: Validate order data
      await this.validateOrderData(orderData);
      this.addProcessingStep(orderId, 'validation', 'completed');

      // Step 2: Check inventory availability
      await this.checkInventoryAvailability(orderData.items);
      this.addProcessingStep(orderId, 'inventory_check', 'completed');

      // Step 3: Fraud detection
      const fraudResult = await this.performFraudDetection(orderData, context);
      this.addProcessingStep(orderId, 'fraud_detection', 'completed', { fraudScore: fraudResult.riskScore });

      // Step 4: Reserve inventory
      const reservationResult = await this.reserveInventory(orderData.items);
      this.addProcessingStep(orderId, 'inventory_reservation', 'completed');

      // Step 5: Calculate pricing
      const pricingResult = await this.calculatePricing(orderData);
      this.addProcessingStep(orderId, 'pricing_calculation', 'completed');

      // Step 6: Create order in database
      const order = await this.createOrderRecord({
        ...orderData,
        ...pricingResult,
        fraudCheck: fraudResult,
        inventoryReservation: reservationResult.reservationId
      });
      this.addProcessingStep(orderId, 'order_creation', 'completed');

      // Step 7: Process payment (if not COD)
      if (orderData.paymentMethod !== 'cod') {
        const paymentResult = await this.processPayment(order, orderData.paymentDetails);
        this.addProcessingStep(orderId, 'payment_processing', paymentResult.success ? 'completed' : 'failed');
        
        if (!paymentResult.success) {
          await this.releaseInventoryReservation(reservationResult.reservationId);
          throw new Error('Payment processing failed: ' + paymentResult.error);
        }
      }

      // Step 8: Confirm order
      await orderStatusManager.updateOrderStatus(order._id, 'confirmed', {
        systemGenerated: true,
        description: 'Order confirmed after successful processing'
      });
      this.addProcessingStep(orderId, 'order_confirmation', 'completed');

      // Step 9: Notify stakeholders
      await this.notifyStakeholders(order);
      this.addProcessingStep(orderId, 'notifications', 'completed');

      // Step 10: Schedule fulfillment
      await this.scheduleFulfillment(order);
      this.addProcessingStep(orderId, 'fulfillment_scheduling', 'completed');

      this.processingQueue.get(orderId).status = 'completed';
      this.processingQueue.get(orderId).endTime = new Date();

      logger.info('Order processing completed successfully', { 
        orderId: order._id, 
        orderNumber: order.orderNumber 
      });

      return {
        success: true,
        order,
        processingSteps: this.processingQueue.get(orderId).steps,
        fraudScore: fraudResult.riskScore
      };

    } catch (error) {
      this.processingQueue.get(orderId).status = 'failed';
      this.processingQueue.get(orderId).error = error.message;
      
      logger.error('Order processing failed', { 
        orderId, 
        error: error.message,
        steps: this.processingQueue.get(orderId).steps
      });

      throw error;
    } finally {
      // Clean up processing queue after 1 hour
      setTimeout(() => {
        this.processingQueue.delete(orderId);
      }, 60 * 60 * 1000);
    }
  }

  /**
   * Validate order data
   */
  async validateOrderData(orderData) {
    const requiredFields = ['userId', 'items', 'shippingAddress', 'paymentMethod'];
    
    for (const field of requiredFields) {
      if (!orderData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
      throw new Error('Order must contain at least one item');
    }

    // Validate items
    for (const item of orderData.items) {
      if (!item.product || !item.quantity || item.quantity <= 0) {
        throw new Error('Invalid item data');
      }
    }

    // Validate shipping address
    const address = orderData.shippingAddress;
    const requiredAddressFields = ['name', 'address', 'city', 'postalCode', 'phone'];
    
    for (const field of requiredAddressFields) {
      if (!address[field]) {
        throw new Error(`Missing shipping address field: ${field}`);
      }
    }

    return true;
  }

  /**
   * Check inventory availability
   */
  async checkInventoryAvailability(items) {
    const Product = mongoose.model('Product');
    const productIds = items.map(item => item.product);
    
    const products = await Product.find({
      _id: { $in: productIds },
      status: 'active',
      isDeleted: { $ne: true }
    }).select('_id name stock');

    const productMap = new Map(products.map(p => [p._id.toString(), p]));
    
    for (const item of items) {
      const product = productMap.get(item.product.toString());
      
      if (!product) {
        throw new Error(`Product not found: ${item.product}`);
      }
      
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`);
      }
    }

    return { available: true, products: Array.from(productMap.values()) };
  }

  /**
   * Reserve inventory for order
   */
  async reserveInventory(items) {
    const Product = mongoose.model('Product');
    const reservationId = `RES_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const bulkOps = items.map(item => ({
        updateOne: {
          filter: { 
            _id: item.product,
            stock: { $gte: item.quantity }
          },
          update: { 
            $inc: { 
              stock: -item.quantity,
              reservedStock: item.quantity
            },
            $push: {
              reservations: {
                reservationId,
                quantity: item.quantity,
                reservedAt: new Date(),
                expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
              }
            }
          }
        }
      }));

      const bulkResult = await Product.bulkWrite(bulkOps, { session });
      
      if (bulkResult.modifiedCount !== items.length) {
        throw new Error('Failed to reserve inventory - some items may have gone out of stock');
      }

      await session.commitTransaction();
      
      logger.info('Inventory reserved successfully', { reservationId, itemCount: items.length });
      
      return { reservationId, expiresAt: new Date(Date.now() + 30 * 60 * 1000) };

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Release inventory reservation
   */
  async releaseInventoryReservation(reservationId) {
    const Product = mongoose.model('Product');
    
    const products = await Product.find({
      'reservations.reservationId': reservationId
    });

    for (const product of products) {
      const reservation = product.reservations.find(r => r.reservationId === reservationId);
      if (reservation) {
        product.stock += reservation.quantity;
        product.reservedStock -= reservation.quantity;
        product.reservations = product.reservations.filter(r => r.reservationId !== reservationId);
        await product.save();
      }
    }

    logger.info('Inventory reservation released', { reservationId });
  }

  /**
   * Perform fraud detection
   */
  async performFraudDetection(orderData, context) {
    let totalRiskScore = 0;
    const flags = [];
    const checks = [];

    for (const rule of this.fraudDetectionRules) {
      try {
        const isRisky = await rule.condition(orderData, context);
        
        checks.push({
          ruleName: rule.name,
          result: isRisky,
          riskScore: isRisky ? rule.riskScore : 0
        });

        if (isRisky) {
          totalRiskScore += rule.riskScore;
          flags.push(rule.name);
          
          logger.warn('Fraud detection rule triggered', {
            rule: rule.name,
            orderId: orderData.tempId,
            riskScore: rule.riskScore
          });
        }
      } catch (error) {
        logger.error('Fraud detection rule failed', {
          rule: rule.name,
          error: error.message
        });
      }
    }

    const riskLevel = totalRiskScore > 50 ? 'high' : totalRiskScore > 20 ? 'medium' : 'low';
    const requiresReview = totalRiskScore > 30;

    return {
      riskScore: totalRiskScore,
      riskLevel,
      flags,
      checks,
      requiresReview,
      isVerified: !requiresReview
    };
  }

  /**
   * Calculate comprehensive pricing
   */
  async calculatePricing(orderData) {
    let itemsPrice = 0;
    let totalWeight = 0;
    let totalItems = 0;

    const Product = mongoose.model('Product');
    const productIds = orderData.items.map(item => item.product);
    const products = await Product.find({ _id: { $in: productIds } })
      .select('_id price weight');
    
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    // Calculate items price and weight
    for (const item of orderData.items) {
      const product = productMap.get(item.product.toString());
      if (!product) {
        throw new Error(`Product not found for pricing: ${item.product}`);
      }

      const itemTotal = product.price * item.quantity;
      itemsPrice += itemTotal;
      totalWeight += (product.weight || 0) * item.quantity;
      totalItems += item.quantity;
    }

    // Calculate shipping price
    const shippingPrice = this.calculateShippingPrice(itemsPrice, totalWeight, orderData.shippingAddress);
    
    // Calculate tax
    const taxPrice = this.calculateTax(itemsPrice, orderData.shippingAddress);
    
    // Apply discounts
    const discountAmount = await this.calculateDiscounts(orderData, itemsPrice);
    
    // Calculate platform fee
    const platformFee = this.calculatePlatformFee(itemsPrice);
    
    // Calculate total
    const totalPrice = itemsPrice + shippingPrice + taxPrice + platformFee - discountAmount;

    return {
      pricing: {
        itemsPrice,
        shippingPrice,
        taxPrice,
        platformFee,
        discountAmount,
        totalPrice
      },
      orderMetrics: {
        totalItems,
        totalWeight,
        averageItemValue: itemsPrice / totalItems
      }
    };
  }

  /**
   * Calculate shipping price
   */
  calculateShippingPrice(itemsPrice, weight, address) {
    // Free shipping for orders above threshold
    if (itemsPrice >= 500) {
      return 0;
    }

    // Base shipping cost
    let shippingPrice = 50;

    // Weight-based pricing
    if (weight > 1) { // 1kg
      shippingPrice += Math.ceil((weight - 1) / 0.5) * 10; // ₹10 per 500g
    }

    // Distance-based pricing (simplified)
    const distanceMultiplier = this.getDistanceMultiplier(address.postalCode);
    shippingPrice *= distanceMultiplier;

    return Math.round(shippingPrice);
  }

  /**
   * Calculate tax
   */
  calculateTax(itemsPrice, address) {
    // Simplified GST calculation (18% for most items)
    const gstRate = 0.18;
    return Math.round(itemsPrice * gstRate);
  }

  /**
   * Calculate platform fee
   */
  calculatePlatformFee(itemsPrice) {
    // 2% platform fee
    return Math.round(itemsPrice * 0.02);
  }

  /**
   * Calculate discounts
   */
  async calculateDiscounts(orderData, itemsPrice) {
    let totalDiscount = 0;

    // Apply coupon if provided
    if (orderData.couponCode) {
      const discount = await this.applyCoupon(orderData.couponCode, itemsPrice, orderData.userId);
      totalDiscount += discount;
    }

    // First-time customer discount
    const isFirstOrder = await this.isFirstTimeCustomer(orderData.userId);
    if (isFirstOrder && itemsPrice >= 1000) {
      totalDiscount += Math.min(itemsPrice * 0.1, 500); // 10% up to ₹500
    }

    return Math.round(totalDiscount);
  }

  /**
   * Create order record in database
   */
  async createOrderRecord(orderData) {
    const Order = mongoose.model('Order');
    
    // Generate order number
    const orderCount = await Order.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });

    const orderNumber = `QL${new Date().getFullYear().toString().slice(-2)}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}${(orderCount + 1).toString().padStart(4, '0')}`;

    // Prepare order items with details
    const Product = mongoose.model('Product');
    const productIds = orderData.items.map(item => item.product);
    const products = await Product.find({ _id: { $in: productIds } })
      .select('name price images seller category');
    
    const productMap = new Map(products.map(p => [p._id.toString(), p]));
    
    const orderItemsWithDetails = orderData.items.map(item => {
      const product = productMap.get(item.product.toString());
      return {
        product: product._id,
        name: product.name,
        unitPrice: product.price,
        qty: item.quantity,
        totalPrice: product.price * item.quantity,
        seller: product.seller,
        category: product.category,
        image: product.images && product.images[0] ? 
               (typeof product.images[0] === 'string' ? product.images[0] : product.images[0].url) : ''
      };
    });

    const order = new Order({
      orderNumber,
      user: orderData.userId,
      customerInfo: {
        name: orderData.shippingAddress.name,
        email: orderData.customerEmail,
        phone: orderData.shippingAddress.phone
      },
      orderItems: orderItemsWithDetails,
      shippingAddress: {
        fullName: orderData.shippingAddress.name,
        address: orderData.shippingAddress.address,
        city: orderData.shippingAddress.city,
        state: orderData.shippingAddress.state,
        postalCode: orderData.shippingAddress.postalCode,
        country: orderData.shippingAddress.country || 'India',
        phoneNumber: orderData.shippingAddress.phone
      },
      paymentMethod: orderData.paymentMethod,
      pricing: orderData.pricing,
      status: 'pending',
      isPaid: orderData.paymentMethod !== 'cod',
      statusHistory: [{
        status: 'pending',
        timestamp: new Date(),
        description: 'Order placed successfully'
      }],
      fraudCheck: orderData.fraudCheck,
      deliveryTracking: {
        estimatedDeliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
      }
    });

    await order.save();
    
    logger.info('Order record created', { orderId: order._id, orderNumber });
    
    return order;
  }

  /**
   * Process payment
   */
  async processPayment(order, paymentDetails) {
    try {
      // Mock payment processing - replace with actual payment gateway integration
      logger.info('Processing payment', { 
        orderId: order._id, 
        amount: order.pricing.totalPrice,
        method: order.paymentMethod 
      });

      // Simulate payment processing delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Update order with payment result
      order.paymentResult = {
        paymentId: `PAY_${Date.now()}`,
        status: 'success',
        transactionId: `TXN_${Math.random().toString(36).substr(2, 9)}`,
        amount: order.pricing.totalPrice,
        currency: 'INR',
        paidAt: new Date()
      };

      order.isPaid = true;
      order.paidAt = new Date();
      
      await order.save();

      return { success: true, paymentId: order.paymentResult.paymentId };
    } catch (error) {
      logger.error('Payment processing failed', { orderId: order._id, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify stakeholders
   */
  async notifyStakeholders(order) {
    try {
      // Notify customer
      // await this.sendCustomerNotification(order);
      
      // Notify sellers
      // await this.sendSellerNotifications(order);
      
      // Notify admin for high-value orders
      if (order.pricing.totalPrice > 10000) {
        // await this.sendAdminNotification(order);
      }

      logger.info('Stakeholder notifications sent', { orderId: order._id });
    } catch (error) {
      logger.error('Failed to send notifications', { orderId: order._id, error: error.message });
    }
  }

  /**
   * Schedule fulfillment
   */
  async scheduleFulfillment(order) {
    // Group items by seller for multi-vendor orders
    const sellerGroups = new Map();
    
    order.orderItems.forEach(item => {
      const sellerId = item.seller.toString();
      if (!sellerGroups.has(sellerId)) {
        sellerGroups.set(sellerId, []);
      }
      sellerGroups.get(sellerId).push(item);
    });

    // Schedule fulfillment for each seller
    for (const [sellerId, items] of sellerGroups) {
      await this.scheduleSellerFulfillment(order, sellerId, items);
    }

    logger.info('Fulfillment scheduled', { orderId: order._id, sellers: sellerGroups.size });
  }

  /**
   * Schedule fulfillment for a specific seller
   */
  async scheduleSellerFulfillment(order, sellerId, items) {
    // This would integrate with warehouse management system
    const fulfillmentTask = {
      orderId: order._id,
      orderNumber: order.orderNumber,
      sellerId,
      items: items.map(item => ({
        productId: item.product,
        name: item.name,
        quantity: item.qty
      })),
      priority: order.fraudCheck.riskLevel === 'high' ? 'low' : 'normal',
      estimatedProcessingTime: items.length * 15 // 15 minutes per item
    };

    logger.info('Seller fulfillment scheduled', { 
      orderId: order._id, 
      sellerId, 
      itemCount: items.length 
    });
  }

  /**
   * Helper methods
   */
  addProcessingStep(orderId, step, status, data = {}) {
    if (this.processingQueue.has(orderId)) {
      this.processingQueue.get(orderId).steps.push({
        step,
        status,
        timestamp: new Date(),
        ...data
      });
    }
  }

  async getRecentOrdersByIP(ip, hours) {
    // Mock implementation - replace with actual database query
    return [];
  }

  async getCustomerOrderCount(userId) {
    const Order = mongoose.model('Order');
    return await Order.countDocuments({ user: userId });
  }

  getDistanceMultiplier(postalCode) {
    // Simplified distance calculation based on postal code
    const code = parseInt(postalCode);
    if (code >= 110000 && code <= 110099) return 1.0; // Delhi NCR
    if (code >= 400000 && code <= 400099) return 1.2; // Mumbai
    if (code >= 560000 && code <= 560099) return 1.3; // Bangalore
    return 1.5; // Other locations
  }

  async applyCoupon(couponCode, itemsPrice, userId) {
    // Mock coupon application - replace with actual coupon system
    return 0;
  }

  async isFirstTimeCustomer(userId) {
    const orderCount = await this.getCustomerOrderCount(userId);
    return orderCount === 0;
  }

  /**
   * Get processing status
   */
  getProcessingStatus(orderId) {
    return this.processingQueue.get(orderId) || null;
  }

  /**
   * Clean up expired reservations
   */
  async cleanupExpiredReservations() {
    const Product = mongoose.model('Product');
    const now = new Date();
    
    const productsWithExpiredReservations = await Product.find({
      'reservations.expiresAt': { $lt: now }
    });

    for (const product of productsWithExpiredReservations) {
      const expiredReservations = product.reservations.filter(r => r.expiresAt < now);
      
      for (const reservation of expiredReservations) {
        product.stock += reservation.quantity;
        product.reservedStock -= reservation.quantity;
      }
      
      product.reservations = product.reservations.filter(r => r.expiresAt >= now);
      await product.save();
      
      logger.info('Expired reservations cleaned up', {
        productId: product._id,
        expiredCount: expiredReservations.length
      });
    }
  }
}

module.exports = new OrderProcessingEngine();
