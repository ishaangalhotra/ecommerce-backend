// services/advancedPaymentService.js - Multi-Gateway Payment System

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/order');
const User = require('../models/User');
const Seller = require('../models/Seller');

class AdvancedPaymentService {
  constructor() {
    // Initialize payment gateways
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    // Payment method configurations
    this.paymentMethods = {
      stripe: {
        name: 'Stripe',
        types: ['card', 'apple_pay', 'google_pay', 'link'],
        currencies: ['USD', 'EUR', 'GBP', 'INR'],
        fees: { percentage: 2.9, fixed: 30 }, // 2.9% + $0.30
        isActive: true
      },
      razorpay: {
        name: 'Razorpay',
        types: ['card', 'netbanking', 'upi', 'wallet', 'emi'],
        currencies: ['INR'],
        fees: { percentage: 2.0, fixed: 0 }, // 2% + ₹0
        isActive: true
      },
      paypal: {
        name: 'PayPal',
        types: ['paypal', 'card'],
        currencies: ['USD', 'EUR', 'GBP'],
        fees: { percentage: 3.49, fixed: 0 }, // 3.49% + $0
        isActive: false // Would need PayPal SDK integration
      },
      crypto: {
        name: 'Cryptocurrency',
        types: ['bitcoin', 'ethereum', 'usdc'],
        currencies: ['BTC', 'ETH', 'USDC'],
        fees: { percentage: 1.0, fixed: 0 }, // 1% + $0
        isActive: false // Would need crypto payment processor
      }
    };

    // Wallet configurations
    this.walletProviders = {
      paytm: { name: 'Paytm', isActive: true },
      phonepe: { name: 'PhonePe', isActive: true },
      googlepay: { name: 'Google Pay', isActive: true },
      amazonpay: { name: 'Amazon Pay', isActive: true },
      mobikwik: { name: 'MobiKwik', isActive: true }
    };
  }

  /**
   * Create payment intent for multiple gateways
   */
  async createPaymentIntent(orderData) {
    try {
      const { orderId, amount, currency, paymentMethod, userId, metadata = {} } = orderData;

      // Get user and order details
      const order = await Order.findById(orderId).populate('user').populate('items.product');
      if (!order) {
        throw new Error('Order not found');
      }

      let paymentIntent;

      switch (paymentMethod.gateway) {
        case 'stripe':
          paymentIntent = await this.createStripePaymentIntent(order, amount, currency, paymentMethod, metadata);
          break;
        
        case 'razorpay':
          paymentIntent = await this.createRazorpayOrder(order, amount, currency, paymentMethod, metadata);
          break;
        
        case 'paypal':
          paymentIntent = await this.createPayPalOrder(order, amount, currency, paymentMethod, metadata);
          break;
        
        default:
          throw new Error('Unsupported payment gateway');
      }

      // Store payment intent in order
      order.paymentDetails = {
        gateway: paymentMethod.gateway,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: amount,
        currency: currency,
        status: 'pending',
        createdAt: new Date()
      };

      await order.save();

      return {
        success: true,
        paymentIntent,
        order: {
          id: order._id,
          amount: order.totalAmount,
          currency: order.currency
        }
      };

    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw error;
    }
  }

  /**
   * Create Stripe payment intent
   */
  async createStripePaymentIntent(order, amount, currency, paymentMethod, metadata) {
    try {
      const paymentIntentData = {
        amount: Math.round(amount * 100), // Stripe uses cents
        currency: currency.toLowerCase(),
        payment_method_types: paymentMethod.types || ['card'],
        metadata: {
          orderId: order._id.toString(),
          userId: order.user._id.toString(),
          ...metadata
        },
        description: `Order ${order.orderNumber} - ${order.items.length} items`,
        receipt_email: order.user.email,
        shipping: {
          name: order.shippingAddress.name,
          address: {
            line1: order.shippingAddress.street,
            city: order.shippingAddress.city,
            state: order.shippingAddress.state,
            postal_code: order.shippingAddress.pincode,
            country: order.shippingAddress.country
          }
        }
      };

      // Add automatic payment methods
      if (paymentMethod.types.includes('apple_pay') || paymentMethod.types.includes('google_pay')) {
        paymentIntentData.automatic_payment_methods = {
          enabled: true
        };
      }

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

      return {
        id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status
      };

    } catch (error) {
      console.error('Error creating Stripe payment intent:', error);
      throw error;
    }
  }

  /**
   * Create Razorpay order
   */
  async createRazorpayOrder(order, amount, currency, paymentMethod, metadata) {
    try {
      const orderOptions = {
        amount: Math.round(amount * 100), // Razorpay uses paise
        currency: currency,
        receipt: `order_${order._id}`,
        notes: {
          orderId: order._id.toString(),
          userId: order.user._id.toString(),
          orderNumber: order.orderNumber,
          ...metadata
        }
      };

      const razorpayOrder = await this.razorpay.orders.create(orderOptions);

      return {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        status: razorpayOrder.status,
        receipt: razorpayOrder.receipt,
        key: process.env.RAZORPAY_KEY_ID // Frontend needs this
      };

    } catch (error) {
      console.error('Error creating Razorpay order:', error);
      throw error;
    }
  }

  /**
   * Verify payment signature (Razorpay)
   */
  verifyRazorpaySignature(orderId, paymentId, signature) {
    try {
      const body = orderId + '|' + paymentId;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

      return expectedSignature === signature;
    } catch (error) {
      console.error('Error verifying Razorpay signature:', error);
      return false;
    }
  }

  /**
   * Process payment confirmation
   */
  async confirmPayment(paymentData) {
    try {
      const { orderId, paymentId, signature, gateway, metadata = {} } = paymentData;

      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      let paymentConfirmed = false;
      let paymentDetails = {};

      switch (gateway) {
        case 'stripe':
          paymentConfirmed = await this.confirmStripePayment(paymentId);
          break;
        
        case 'razorpay':
          paymentConfirmed = this.verifyRazorpaySignature(
            order.paymentDetails.paymentIntentId,
            paymentId,
            signature
          );
          break;
        
        default:
          throw new Error('Unsupported payment gateway');
      }

      if (paymentConfirmed) {
        // Update order status
        order.paymentStatus = 'paid';
        order.status = 'confirmed';
        order.paymentDetails = {
          ...order.paymentDetails,
          paymentId,
          signature,
          paidAt: new Date(),
          status: 'completed'
        };

        await order.save();

        // Process post-payment actions
        await this.processPostPaymentActions(order);

        return {
          success: true,
          orderId: order._id,
          paymentId,
          status: 'completed',
          message: 'Payment confirmed successfully'
        };
      } else {
        throw new Error('Payment verification failed');
      }

    } catch (error) {
      console.error('Error confirming payment:', error);
      throw error;
    }
  }

  /**
   * Confirm Stripe payment
   */
  async confirmStripePayment(paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      return paymentIntent.status === 'succeeded';
    } catch (error) {
      console.error('Error confirming Stripe payment:', error);
      return false;
    }
  }

  /**
   * Process refund
   */
  async processRefund(refundData) {
    try {
      const { orderId, amount, reason, gateway, metadata = {} } = refundData;

      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      let refundResult;

      switch (gateway) {
        case 'stripe':
          refundResult = await this.processStripeRefund(order.paymentDetails.paymentId, amount, reason);
          break;
        
        case 'razorpay':
          refundResult = await this.processRazorpayRefund(order.paymentDetails.paymentId, amount, reason);
          break;
        
        default:
          throw new Error('Unsupported payment gateway for refunds');
      }

      // Update order with refund information
      if (!order.refunds) order.refunds = [];
      order.refunds.push({
        refundId: refundResult.id,
        amount: amount,
        reason: reason,
        status: refundResult.status,
        processedAt: new Date(),
        gateway: gateway
      });

      // Update order status if fully refunded
      const totalRefunded = order.refunds.reduce((sum, refund) => sum + refund.amount, 0);
      if (totalRefunded >= order.totalAmount) {
        order.status = 'refunded';
      } else {
        order.status = 'partially_refunded';
      }

      await order.save();

      return {
        success: true,
        refundId: refundResult.id,
        amount: amount,
        status: refundResult.status,
        estimatedArrival: refundResult.estimatedArrival
      };

    } catch (error) {
      console.error('Error processing refund:', error);
      throw error;
    }
  }

  /**
   * Process Stripe refund
   */
  async processStripeRefund(paymentIntentId, amount, reason) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(amount * 100), // Stripe uses cents
        reason: reason || 'requested_by_customer',
        metadata: {
          refund_reason: reason
        }
      });

      return {
        id: refund.id,
        amount: refund.amount / 100,
        status: refund.status,
        estimatedArrival: '5-10 business days'
      };

    } catch (error) {
      console.error('Error processing Stripe refund:', error);
      throw error;
    }
  }

  /**
   * Process Razorpay refund
   */
  async processRazorpayRefund(paymentId, amount, reason) {
    try {
      const refund = await this.razorpay.payments.refund(paymentId, {
        amount: Math.round(amount * 100), // Razorpay uses paise
        notes: {
          refund_reason: reason
        }
      });

      return {
        id: refund.id,
        amount: refund.amount / 100,
        status: refund.status,
        estimatedArrival: '3-7 business days'
      };

    } catch (error) {
      console.error('Error processing Razorpay refund:', error);
      throw error;
    }
  }

  /**
   * Split payment for multi-vendor orders
   */
  async splitPayment(order) {
    try {
      const splits = [];
      const platformCommission = parseFloat(process.env.PLATFORM_COMMISSION || '5'); // 5% default

      // Group items by seller
      const sellerGroups = {};
      for (const item of order.items) {
        const sellerId = item.product.seller.toString();
        if (!sellerGroups[sellerId]) {
          sellerGroups[sellerId] = {
            seller: item.product.seller,
            items: [],
            totalAmount: 0
          };
        }
        sellerGroups[sellerId].items.push(item);
        sellerGroups[sellerId].totalAmount += item.price * item.quantity;
      }

      // Calculate splits for each seller
      for (const [sellerId, group] of Object.entries(sellerGroups)) {
        const seller = await Seller.findById(sellerId);
        if (!seller) continue;

        const commissionRate = seller.commission.rate || platformCommission;
        const sellerAmount = group.totalAmount;
        const commissionAmount = (sellerAmount * commissionRate) / 100;
        const netAmount = sellerAmount - commissionAmount;

        splits.push({
          sellerId: sellerId,
          sellerName: seller.businessInfo.businessName,
          grossAmount: sellerAmount,
          commissionRate: commissionRate,
          commissionAmount: commissionAmount,
          netAmount: netAmount,
          items: group.items.length,
          bankAccount: {
            accountNumber: seller.bankInfo.accountNumber,
            ifscCode: seller.bankInfo.ifscCode,
            accountHolderName: seller.bankInfo.accountHolderName
          }
        });
      }

      return splits;

    } catch (error) {
      console.error('Error splitting payment:', error);
      throw error;
    }
  }

  /**
   * Transfer funds to sellers
   */
  async transferFundsToSellers(orderId) {
    try {
      const order = await Order.findById(orderId).populate('items.product');
      if (!order) {
        throw new Error('Order not found');
      }

      const splits = await this.splitPayment(order);
      const transferResults = [];

      for (const split of splits) {
        try {
          let transferResult;

          // Transfer via payment gateway
          if (order.paymentDetails.gateway === 'stripe') {
            transferResult = await this.stripeTransfer(split, order);
          } else if (order.paymentDetails.gateway === 'razorpay') {
            transferResult = await this.razorpayTransfer(split, order);
          }

          transferResults.push({
            sellerId: split.sellerId,
            amount: split.netAmount,
            status: transferResult.status,
            transferId: transferResult.id,
            transferredAt: new Date()
          });

        } catch (transferError) {
          console.error(`Error transferring to seller ${split.sellerId}:`, transferError);
          transferResults.push({
            sellerId: split.sellerId,
            amount: split.netAmount,
            status: 'failed',
            error: transferError.message,
            transferredAt: new Date()
          });
        }
      }

      // Update order with transfer information
      order.sellerTransfers = transferResults;
      await order.save();

      return {
        success: true,
        transfers: transferResults,
        totalTransferred: transferResults
          .filter(t => t.status === 'completed')
          .reduce((sum, t) => sum + t.amount, 0)
      };

    } catch (error) {
      console.error('Error transferring funds to sellers:', error);
      throw error;
    }
  }

  /**
   * Stripe transfer to seller
   */
  async stripeTransfer(split, order) {
    // Note: This requires Stripe Connect setup
    const transfer = await stripe.transfers.create({
      amount: Math.round(split.netAmount * 100),
      currency: order.currency.toLowerCase(),
      destination: split.stripeAccountId, // Seller's connected account
      description: `Order ${order.orderNumber} - ${split.sellerName}`,
      metadata: {
        orderId: order._id.toString(),
        sellerId: split.sellerId
      }
    });

    return {
      id: transfer.id,
      status: 'completed',
      amount: transfer.amount / 100
    };
  }

  /**
   * Razorpay transfer to seller
   */
  async razorpayTransfer(split, order) {
    // Note: This requires Razorpay Route setup
    const transfer = await this.razorpay.transfers.create({
      amount: Math.round(split.netAmount * 100),
      currency: order.currency,
      account: split.razorpayAccountId, // Seller's linked account
      notes: {
        orderId: order._id.toString(),
        sellerId: split.sellerId,
        orderNumber: order.orderNumber
      }
    });

    return {
      id: transfer.id,
      status: transfer.status,
      amount: transfer.amount / 100
    };
  }

  /**
   * Get supported payment methods for user
   */
  async getSupportedPaymentMethods(userId, amount, currency) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const supportedMethods = [];

      // Check each gateway
      for (const [gateway, config] of Object.entries(this.paymentMethods)) {
        if (config.isActive && config.currencies.includes(currency)) {
          const fees = this.calculateFees(amount, config.fees);
          
          supportedMethods.push({
            gateway: gateway,
            name: config.name,
            types: config.types,
            fees: {
              percentage: config.fees.percentage,
              fixed: config.fees.fixed,
              total: fees.total,
              display: fees.display
            },
            isRecommended: gateway === 'razorpay' && currency === 'INR'
          });
        }
      }

      // Add wallet options
      const walletMethods = Object.entries(this.walletProviders)
        .filter(([key, config]) => config.isActive)
        .map(([key, config]) => ({
          gateway: 'wallet',
          type: key,
          name: config.name,
          fees: { total: 0, display: 'Free' }
        }));

      return {
        paymentMethods: supportedMethods,
        walletMethods: walletMethods,
        recommendedMethod: supportedMethods.find(m => m.isRecommended) || supportedMethods[0]
      };

    } catch (error) {
      console.error('Error getting supported payment methods:', error);
      throw error;
    }
  }

  /**
   * Calculate payment fees
   */
  calculateFees(amount, feeConfig) {
    const percentageFee = (amount * feeConfig.percentage) / 100;
    const total = percentageFee + feeConfig.fixed;
    
    return {
      percentage: percentageFee,
      fixed: feeConfig.fixed,
      total: total,
      display: `₹${total.toFixed(2)}`
    };
  }

  /**
   * Process post-payment actions
   */
  async processPostPaymentActions(order) {
    try {
      // Send confirmation emails
      await this.sendPaymentConfirmationEmail(order);
      
      // Update inventory
      await this.updateInventory(order);
      
      // Create seller notifications
      await this.notifySellers(order);
      
      // Schedule fund transfers (after delivery confirmation)
      await this.scheduleFundTransfer(order);
      
      // Update user loyalty points
      await this.updateLoyaltyPoints(order);

    } catch (error) {
      console.error('Error in post-payment actions:', error);
      // Don't throw error as payment is already successful
    }
  }

  async sendPaymentConfirmationEmail(order) {
    // Implementation would use emailService
    console.log(`Sending payment confirmation email for order ${order.orderNumber}`);
  }

  async updateInventory(order) {
    // Implementation would update product stock
    console.log(`Updating inventory for order ${order.orderNumber}`);
  }

  async notifySellers(order) {
    // Implementation would notify sellers of new orders
    console.log(`Notifying sellers for order ${order.orderNumber}`);
  }

  async scheduleFundTransfer(order) {
    // Implementation would schedule fund transfer after delivery
    console.log(`Scheduling fund transfer for order ${order.orderNumber}`);
  }

  async updateLoyaltyPoints(order) {
    // Implementation would update user loyalty points
    console.log(`Updating loyalty points for order ${order.orderNumber}`);
  }
}

module.exports = new AdvancedPaymentService();
