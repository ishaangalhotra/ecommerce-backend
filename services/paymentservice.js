const Razorpay = require('razorpay');
const Stripe = require('stripe');
const crypto = require('crypto');
const Order = require('../models/Order');
const User = require('../models/User');

class PaymentService {
  constructor() {
    // Initialize Razorpay
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    // Initialize Stripe
    this.stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  }

  // RAZORPAY INTEGRATION
  async createRazorpayOrder(orderData) {
    try {
      const options = {
        amount: orderData.amount * 100, // Amount in paise
        currency: 'INR',
        receipt: `order_${Date.now()}`,
        notes: {
          orderId: orderData.orderId,
          userId: orderData.userId,
          customerName: orderData.customerName,
          customerEmail: orderData.customerEmail
        }
      };

      const razorpayOrder = await this.razorpay.orders.create(options);
      
      // Update order in database with Razorpay order ID
      await Order.findByIdAndUpdate(orderData.orderId, {
        'payment.razorpayOrderId': razorpayOrder.id,
        'payment.status': 'pending'
      });

      return {
        success: true,
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt
      };
    } catch (error) {
      console.error('Razorpay order creation failed:', error);
      throw new Error('Failed to create payment order');
    }
  }

  async verifyRazorpayPayment(paymentData) {
    try {
      const { 
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        orderId 
      } = paymentData;

      // Verify signature
      const body = razorpay_order_id + "|" + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        throw new Error('Invalid payment signature');
      }

      // Get payment details from Razorpay
      const payment = await this.razorpay.payments.fetch(razorpay_payment_id);

      // Update order in database
      const order = await Order.findByIdAndUpdate(orderId, {
        'payment.status': 'completed',
        'payment.razorpayPaymentId': razorpay_payment_id,
        'payment.razorpaySignature': razorpay_signature,
        'payment.method': payment.method,
        'payment.completedAt': new Date(),
        status: 'confirmed'
      }, { new: true });

      return {
        success: true,
        payment: {
          id: razorpay_payment_id,
          amount: payment.amount / 100,
          status: payment.status,
          method: payment.method
        },
        order: order
      };
    } catch (error) {
      console.error('Payment verification failed:', error);
      
      // Update order status to failed
      if (paymentData.orderId) {
        await Order.findByIdAndUpdate(paymentData.orderId, {
          'payment.status': 'failed',
          status: 'cancelled'
        });
      }

      throw new Error('Payment verification failed');
    }
  }

  // STRIPE INTEGRATION
  async createStripePaymentIntent(orderData) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(orderData.amount * 100), // Amount in cents
        currency: 'usd', // Change to 'inr' for Indian Rupees
        metadata: {
          orderId: orderData.orderId,
          userId: orderData.userId,
          customerName: orderData.customerName,
          customerEmail: orderData.customerEmail
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      // Update order in database
      await Order.findByIdAndUpdate(orderData.orderId, {
        'payment.stripePaymentIntentId': paymentIntent.id,
        'payment.status': 'pending'
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      };
    } catch (error) {
      console.error('Stripe payment intent creation failed:', error);
      throw new Error('Failed to create payment intent');
    }
  }

  async confirmStripePayment(paymentIntentId, orderId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status === 'succeeded') {
        // Update order in database
        const order = await Order.findByIdAndUpdate(orderId, {
          'payment.status': 'completed',
          'payment.stripePaymentIntentId': paymentIntentId,
          'payment.completedAt': new Date(),
          status: 'confirmed'
        }, { new: true });

        return {
          success: true,
          payment: {
            id: paymentIntent.id,
            amount: paymentIntent.amount / 100,
            status: paymentIntent.status,
            method: paymentIntent.payment_method_types[0]
          },
          order: order
        };
      } else {
        throw new Error('Payment not successful');
      }
    } catch (error) {
      console.error('Stripe payment confirmation failed:', error);
      
      // Update order status to failed
      await Order.findByIdAndUpdate(orderId, {
        'payment.status': 'failed',
        status: 'cancelled'
      });

      throw new Error('Payment confirmation failed');
    }
  }

  // REFUND METHODS
  async processRazorpayRefund(paymentId, amount, orderId) {
    try {
      const refund = await this.razorpay.payments.refund(paymentId, {
        amount: amount * 100, // Amount in paise
        speed: 'normal'
      });

      // Update order in database
      await Order.findByIdAndUpdate(orderId, {
        'payment.refundId': refund.id,
        'payment.refundStatus': 'processed',
        'payment.refundAmount': amount,
        'payment.refundedAt': new Date(),
        status: 'refunded'
      });

      return {
        success: true,
        refund: {
          id: refund.id,
          amount: refund.amount / 100,
          status: refund.status
        }
      };
    } catch (error) {
      console.error('Razorpay refund failed:', error);
      throw new Error('Refund processing failed');
    }
  }

  async processStripeRefund(paymentIntentId, amount, orderId) {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(amount * 100) // Amount in cents
      });

      // Update order in database
      await Order.findByIdAndUpdate(orderId, {
        'payment.refundId': refund.id,
        'payment.refundStatus': 'processed',
        'payment.refundAmount': amount,
        'payment.refundedAt': new Date(),
        status: 'refunded'
      });

      return {
        success: true,
        refund: {
          id: refund.id,
          amount: refund.amount / 100,
          status: refund.status
        }
      };
    } catch (error) {
      console.error('Stripe refund failed:', error);
      throw new Error('Refund processing failed');
    }
  }

  // WEBHOOK HANDLERS
  async handleRazorpayWebhook(body, signature) {
    try {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(body))
        .digest('hex');

      if (expectedSignature !== signature) {
        throw new Error('Invalid webhook signature');
      }

      const event = body.event;
      const payment = body.payload.payment.entity;

      switch (event) {
        case 'payment.captured':
          await this.handlePaymentCaptured(payment, 'razorpay');
          break;
        case 'payment.failed':
          await this.handlePaymentFailed(payment, 'razorpay');
          break;
        case 'refund.processed':
          await this.handleRefundProcessed(body.payload.refund.entity, 'razorpay');
          break;
      }

      return { success: true };
    } catch (error) {
      console.error('Razorpay webhook error:', error);
      throw error;
    }
  }

  async handleStripeWebhook(body, signature) {
    try {
      const event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentCaptured(event.data.object, 'stripe');
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentFailed(event.data.object, 'stripe');
          break;
        case 'charge.dispute.created':
          await this.handleChargeDispute(event.data.object);
          break;
      }

      return { success: true };
    } catch (error) {
      console.error('Stripe webhook error:', error);
      throw error;
    }
  }

  // Helper methods for webhook handling
  async handlePaymentCaptured(payment, provider) {
    const orderId = provider === 'razorpay' ? payment.notes?.orderId : payment.metadata?.orderId;
    
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        'payment.status': 'completed',
        'payment.completedAt': new Date(),
        status: 'confirmed'
      });
    }
  }

  async handlePaymentFailed(payment, provider) {
    const orderId = provider === 'razorpay' ? payment.notes?.orderId : payment.metadata?.orderId;
    
    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        'payment.status': 'failed',
        status: 'cancelled'
      });
    }
  }

  async handleRefundProcessed(refund, provider) {
    // Update order status based on refund
    const paymentId = provider === 'razorpay' ? refund.payment_id : refund.payment_intent;
    
    const order = await Order.findOne({
      $or: [
        { 'payment.razorpayPaymentId': paymentId },
        { 'payment.stripePaymentIntentId': paymentId }
      ]
    });

    if (order) {
      await Order.findByIdAndUpdate(order._id, {
        'payment.refundStatus': 'completed',
        status: 'refunded'
      });
    }
  }

  // PAYMENT ANALYTICS
  async getPaymentAnalytics(startDate, endDate) {
    try {
      const orders = await Order.find({
        createdAt: { $gte: startDate, $lte: endDate },
        'payment.status': 'completed'
      });

      const analytics = {
        totalTransactions: orders.length,
        totalRevenue: orders.reduce((sum, order) => sum + order.totalAmount, 0),
        averageOrderValue: 0,
        paymentMethods: {},
        successRate: 0
      };

      if (orders.length > 0) {
        analytics.averageOrderValue = analytics.totalRevenue / orders.length;
        
        orders.forEach(order => {
          const method = order.payment.method || 'unknown';
          analytics.paymentMethods[method] = (analytics.paymentMethods[method] || 0) + 1;
        });
      }

      // Calculate success rate
      const allOrders = await Order.find({
        createdAt: { $gte: startDate, $lte: endDate }
      });
      
      analytics.successRate = allOrders.length > 0 
        ? (orders.length / allOrders.length) * 100 
        : 0;

      return analytics;
    } catch (error) {
      console.error('Payment analytics error:', error);
      throw new Error('Failed to generate payment analytics');
    }
  }
}

module.exports = new PaymentService();