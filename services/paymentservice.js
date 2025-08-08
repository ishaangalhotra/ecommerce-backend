const stripe = require('stripe');
const Razorpay = require('razorpay');
const logger = require('../utils/logger');

class PaymentService {
  constructor() {
    this.stripe = null;
    this.razorpay = null;
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Initialize Stripe
      if (process.env.STRIPE_SECRET_KEY) {
        this.stripe = stripe(process.env.STRIPE_SECRET_KEY);
        logger.info('✅ Stripe payment service initialized');
      }

      // Initialize Razorpay
      if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        this.razorpay = new Razorpay({
          key_id: process.env.RAZORPAY_KEY_ID,
          key_secret: process.env.RAZORPAY_KEY_SECRET
        });
        logger.info('✅ Razorpay payment service initialized');
      }

      this.isInitialized = true;
      logger.info('✅ Payment service initialized successfully');
    } catch (error) {
      logger.error('❌ Payment service initialization failed:', error.message);
      throw error;
    }
  }

  // Stripe Payment Methods
  async createStripePaymentIntent(amount, currency = 'usd', metadata = {}) {
    try {
      if (!this.stripe) {
        throw new Error('Stripe not configured');
      }

      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      });

      logger.info('✅ Stripe payment intent created', { 
        paymentIntentId: paymentIntent.id,
        amount: amount
      });

      return {
        id: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status
      };
      } catch (error) {
      logger.error('❌ Failed to create Stripe payment intent:', error.message);
      throw error;
    }
  }

  async confirmStripePayment(paymentIntentId) {
    try {
      if (!this.stripe) {
        throw new Error('Stripe not configured');
      }

      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      
      if (paymentIntent.status === 'succeeded') {
        logger.info('✅ Stripe payment confirmed', { paymentIntentId });
        return {
          success: true,
          paymentIntentId,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: paymentIntent.status
        };
    } else {
        throw new Error(`Payment not successful. Status: ${paymentIntent.status}`);
      }
    } catch (error) {
      logger.error('❌ Failed to confirm Stripe payment:', error.message);
      throw error;
    }
  }

  async createStripeRefund(paymentIntentId, amount, reason = 'requested_by_customer') {
    try {
      if (!this.stripe) {
        throw new Error('Stripe not configured');
      }

      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(amount * 100), // Convert to cents
        reason
      });

      logger.info('✅ Stripe refund created', { 
        refundId: refund.id,
        amount: amount
      });

      return {
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        reason: refund.reason
      };
    } catch (error) {
      logger.error('❌ Failed to create Stripe refund:', error.message);
      throw error;
    }
  }

  // Razorpay Payment Methods
  async createRazorpayOrder(amount, currency = 'INR', receipt = null) {
    try {
      if (!this.razorpay) {
        throw new Error('Razorpay not configured');
      }

      const options = {
        amount: Math.round(amount * 100), // Convert to paise
        currency,
        receipt: receipt || `receipt_${Date.now()}`
      };

      const order = await this.razorpay.orders.create(options);

      logger.info('✅ Razorpay order created', { 
        orderId: order.id,
        amount: amount
      });

      return {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
        status: order.status
      };
      } catch (error) {
      logger.error('❌ Failed to create Razorpay order:', error.message);
      throw error;
    }
  }

  async verifyRazorpayPayment(paymentId, orderId, signature) {
    try {
      if (!this.razorpay) {
        throw new Error('Razorpay not configured');
      }

      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      if (expectedSignature === signature) {
        logger.info('✅ Razorpay payment verified', { paymentId, orderId });
        return {
          success: true,
          paymentId,
          orderId,
          verified: true
        };
    } else {
        throw new Error('Invalid payment signature');
      }
    } catch (error) {
      logger.error('❌ Failed to verify Razorpay payment:', error.message);
      throw error;
    }
  }

  async createRazorpayRefund(paymentId, amount) {
    try {
    if (!this.razorpay) {
        throw new Error('Razorpay not configured');
      }

      const refund = await this.razorpay.payments.refund(paymentId, {
        amount: Math.round(amount * 100) // Convert to paise
      });

      logger.info('✅ Razorpay refund created', { 
        refundId: refund.id,
        amount: amount
      });

      return {
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status
      };
    } catch (error) {
      logger.error('❌ Failed to create Razorpay refund:', error.message);
      throw error;
    }
  }

  // Generic Payment Methods
  async processPayment(order, paymentMethod, paymentData) {
    try {
      const { amount, currency, orderId, metadata } = order;
      
      let paymentResult = null;

      switch (paymentMethod) {
        case 'stripe':
          const paymentIntent = await this.createStripePaymentIntent(
            amount, 
            currency, 
            { orderId, ...metadata }
          );
          paymentResult = {
            provider: 'stripe',
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.clientSecret,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            status: paymentIntent.status
          };
          break;

        case 'razorpay':
          const razorpayOrder = await this.createRazorpayOrder(
            amount, 
            currency, 
            orderId
          );
          paymentResult = {
            provider: 'razorpay',
            orderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            status: razorpayOrder.status
          };
          break;

        case 'cod':
          paymentResult = {
            provider: 'cod',
            status: 'pending',
            amount,
            currency,
            requiresConfirmation: true
          };
          break;

        default:
          throw new Error(`Unsupported payment method: ${paymentMethod}`);
      }

      logger.info('✅ Payment processed', {
        orderId,
        paymentMethod,
        amount,
        status: paymentResult.status
      });

      return paymentResult;
    } catch (error) {
      logger.error('❌ Payment processing failed:', error.message);
      throw error;
    }
  }

  async confirmPayment(paymentMethod, paymentData) {
    try {
      let confirmationResult = null;

      switch (paymentMethod) {
        case 'stripe':
          confirmationResult = await this.confirmStripePayment(paymentData.paymentIntentId);
          break;

        case 'razorpay':
          confirmationResult = await this.verifyRazorpayPayment(
            paymentData.paymentId,
            paymentData.orderId,
            paymentData.signature
          );
          break;

        case 'cod':
          confirmationResult = {
            success: true,
            status: 'confirmed',
            provider: 'cod'
          };
          break;

        default:
          throw new Error(`Unsupported payment method: ${paymentMethod}`);
      }

      logger.info('✅ Payment confirmed', {
        paymentMethod,
        status: confirmationResult.status
      });

      return confirmationResult;
    } catch (error) {
      logger.error('❌ Payment confirmation failed:', error.message);
      throw error;
    }
  }

  async processRefund(order, refundAmount, reason = 'requested_by_customer') {
    try {
      const { paymentMethod, paymentData } = order;
      let refundResult = null;

      switch (paymentMethod) {
        case 'stripe':
          refundResult = await this.createStripeRefund(
            paymentData.paymentIntentId,
            refundAmount,
            reason
          );
          break;

        case 'razorpay':
          refundResult = await this.createRazorpayRefund(
            paymentData.paymentId,
            refundAmount
          );
          break;

        case 'cod':
          refundResult = {
            id: `cod_refund_${Date.now()}`,
            amount: refundAmount,
            status: 'pending',
            provider: 'cod',
            note: 'Refund will be processed manually'
          };
          break;

        default:
          throw new Error(`Unsupported payment method: ${paymentMethod}`);
      }

      logger.info('✅ Refund processed', {
        orderId: order.orderId,
        paymentMethod,
        amount: refundAmount,
        status: refundResult.status
      });

      return refundResult;
    } catch (error) {
      logger.error('❌ Refund processing failed:', error.message);
      throw error;
    }
  }

  // Payment Validation
  validatePaymentData(paymentMethod, paymentData) {
    const errors = [];

    switch (paymentMethod) {
      case 'stripe':
        if (!paymentData.paymentIntentId) {
          errors.push('Stripe payment intent ID is required');
        }
        break;

      case 'razorpay':
        if (!paymentData.paymentId || !paymentData.orderId || !paymentData.signature) {
          errors.push('Razorpay payment ID, order ID, and signature are required');
        }
        break;

      case 'cod':
        // No validation needed for COD
        break;

      default:
        errors.push(`Unsupported payment method: ${paymentMethod}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Payment Status Methods
  async getPaymentStatus(paymentMethod, paymentData) {
    try {
      switch (paymentMethod) {
        case 'stripe':
          if (!this.stripe) {
            throw new Error('Stripe not configured');
          }
          const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentData.paymentIntentId);
          return {
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            created: paymentIntent.created
          };

        case 'razorpay':
    if (!this.razorpay) {
            throw new Error('Razorpay not configured');
          }
          const payment = await this.razorpay.payments.fetch(paymentData.paymentId);
          return {
            status: payment.status,
            amount: payment.amount,
            currency: payment.currency,
            created: payment.created_at
          };

        case 'cod':
          return {
            status: 'pending',
            amount: paymentData.amount,
            currency: paymentData.currency
          };

        default:
          throw new Error(`Unsupported payment method: ${paymentMethod}`);
      }
    } catch (error) {
      logger.error('❌ Failed to get payment status:', error.message);
      throw error;
    }
  }

  // Webhook Processing
  async processStripeWebhook(event) {
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          logger.info('✅ Stripe payment succeeded', { 
            paymentIntentId: event.data.object.id 
          });
          return {
            type: 'payment_succeeded',
            paymentIntentId: event.data.object.id,
            amount: event.data.object.amount,
            currency: event.data.object.currency
          };

        case 'payment_intent.payment_failed':
          logger.warn('⚠️ Stripe payment failed', { 
            paymentIntentId: event.data.object.id 
          });
          return {
            type: 'payment_failed',
            paymentIntentId: event.data.object.id,
            error: event.data.object.last_payment_error
          };

        case 'charge.refunded':
          logger.info('✅ Stripe refund processed', { 
            chargeId: event.data.object.id 
          });
          return {
            type: 'refund_processed',
            chargeId: event.data.object.id,
            amount: event.data.object.amount_refunded
          };

        default:
          logger.info('ℹ️ Unhandled Stripe webhook event', { type: event.type });
          return { type: 'unhandled', eventType: event.type };
      }
    } catch (error) {
      logger.error('❌ Failed to process Stripe webhook:', error.message);
      throw error;
    }
  }

  async processRazorpayWebhook(event) {
    try {
      const { event: eventType, payload } = event;

      switch (eventType) {
        case 'payment.captured':
          logger.info('✅ Razorpay payment captured', { 
            paymentId: payload.payment.entity.id 
          });
          return {
            type: 'payment_captured',
            paymentId: payload.payment.entity.id,
            amount: payload.payment.entity.amount,
            currency: payload.payment.entity.currency
          };

        case 'payment.failed':
          logger.warn('⚠️ Razorpay payment failed', { 
            paymentId: payload.payment.entity.id 
          });
          return {
            type: 'payment_failed',
            paymentId: payload.payment.entity.id,
            error: payload.payment.entity.error_code
          };

        case 'refund.processed':
          logger.info('✅ Razorpay refund processed', { 
            refundId: payload.refund.entity.id 
          });
          return {
            type: 'refund_processed',
            refundId: payload.refund.entity.id,
            amount: payload.refund.entity.amount
          };

        default:
          logger.info('ℹ️ Unhandled Razorpay webhook event', { type: eventType });
          return { type: 'unhandled', eventType };
      }
    } catch (error) {
      logger.error('❌ Failed to process Razorpay webhook:', error.message);
      throw error;
    }
  }

  // Utility Methods
  formatAmount(amount, currency = 'usd') {
    const currencies = {
      usd: { symbol: '$', decimals: 2 },
      inr: { symbol: '₹', decimals: 2 },
      eur: { symbol: '€', decimals: 2 }
    };

    const config = currencies[currency.toLowerCase()] || currencies.usd;
    return `${config.symbol}${amount.toFixed(config.decimals)}`;
  }

  calculateTax(amount, taxRate = 0) {
    return amount * (taxRate / 100);
  }

  calculateDeliveryFee(orderAmount, baseFee = 2.99, freeThreshold = 50) {
    return orderAmount >= freeThreshold ? 0 : baseFee;
  }

  calculateTotal(orderAmount, taxRate = 0, deliveryFee = 0) {
    const tax = this.calculateTax(orderAmount, taxRate);
    return orderAmount + tax + deliveryFee;
  }
}

module.exports = new PaymentService();