// services/paymentservice.js
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/Order');
const Payment = require('../models/Payment');

// Initialize Razorpay instance
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// Initialize Stripe (if available)
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

class PaymentService {
  /**
   * Create Razorpay Order
   */
  static async createRazorpayOrder(orderData) {
    try {
      const { orderId, amount, userId, customerName, customerEmail } = orderData;

      if (!razorpay) {
        throw new Error('Razorpay not configured. Please check environment variables.');
      }

      // Check if order exists
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      // Verify order belongs to user
      if (order.userId.toString() !== userId) {
        throw new Error('Unauthorized access to order');
      }

      // Create Razorpay order
      const razorpayOrderOptions = {
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'INR',
        receipt: `order_${orderId}_${Date.now()}`,
        payment_capture: 1,
        notes: {
          orderId: orderId,
          userId: userId,
          customerName: customerName || '',
          customerEmail: customerEmail || ''
        }
      };

      const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);

      // Save payment record
      const payment = new Payment({
        orderId: orderId,
        userId: userId,
        paymentGateway: 'razorpay',
        gatewayOrderId: razorpayOrder.id,
        amount: amount,
        currency: 'INR',
        status: 'pending',
        metadata: {
          razorpayOrderId: razorpayOrder.id,
          customerName,
          customerEmail
        }
      });

      await payment.save();

      // Update order with payment info
      order.payment = {
        method: 'razorpay',
        status: 'pending',
        gatewayOrderId: razorpayOrder.id,
        paymentId: payment._id
      };
      await order.save();

      return {
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        orderId: orderId,
        key: process.env.RAZORPAY_KEY_ID,
        customerName: customerName,
        customerEmail: customerEmail
      };

    } catch (error) {
      console.error('PaymentService - createRazorpayOrder error:', error);
      throw error;
    }
  }

  /**
   * Verify Razorpay Payment
   */
  static async verifyRazorpayPayment(paymentData) {
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
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

      const isSignatureValid = expectedSignature === razorpay_signature;

      if (!isSignatureValid) {
        throw new Error('Invalid payment signature');
      }

      // Find and update payment record
      const payment = await Payment.findOne({ 
        gatewayOrderId: razorpay_order_id,
        orderId: orderId 
      });

      if (!payment) {
        throw new Error('Payment record not found');
      }

      // Update payment status
      payment.status = 'completed';
      payment.gatewayPaymentId = razorpay_payment_id;
      payment.gatewaySignature = razorpay_signature;
      payment.paidAt = new Date();
      await payment.save();

      // Update order status
      const order = await Order.findById(orderId);
      if (order) {
        order.payment.status = 'completed';
        order.payment.paidAt = new Date();
        order.status = 'confirmed';
        await order.save();
      }

      return {
        paymentId: payment._id,
        orderId: orderId,
        status: 'completed',
        amount: payment.amount
      };

    } catch (error) {
      console.error('PaymentService - verifyRazorpayPayment error:', error);
      throw error;
    }
  }

  /**
   * Create Stripe Payment Intent
   */
  static async createStripePaymentIntent(orderData) {
    try {
      if (!stripe) {
        throw new Error('Stripe not configured. Please check environment variables.');
      }

      const { orderId, amount, userId, customerName, customerEmail } = orderData;

      // Check if order exists
      const order = await Order.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      // Create Stripe Payment Intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        metadata: {
          orderId: orderId,
          userId: userId,
          customerName: customerName || '',
          customerEmail: customerEmail || ''
        }
      });

      // Save payment record
      const payment = new Payment({
        orderId: orderId,
        userId: userId,
        paymentGateway: 'stripe',
        gatewayOrderId: paymentIntent.id,
        amount: amount,
        currency: 'USD',
        status: 'pending',
        metadata: {
          paymentIntentId: paymentIntent.id,
          customerName,
          customerEmail
        }
      });

      await payment.save();

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: amount,
        orderId: orderId
      };

    } catch (error) {
      console.error('PaymentService - createStripePaymentIntent error:', error);
      throw error;
    }
  }

  /**
   * Confirm Stripe Payment
   */
  static async confirmStripePayment(paymentIntentId, orderId) {
    try {
      if (!stripe) {
        throw new Error('Stripe not configured');
      }

      // Retrieve payment intent from Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status !== 'succeeded') {
        throw new Error('Payment not completed');
      }

      // Find and update payment record
      const payment = await Payment.findOne({ 
        gatewayOrderId: paymentIntentId,
        orderId: orderId 
      });

      if (!payment) {
        throw new Error('Payment record not found');
      }

      // Update payment status
      payment.status = 'completed';
      payment.gatewayPaymentId = paymentIntent.id;
      payment.paidAt = new Date();
      await payment.save();

      // Update order status
      const order = await Order.findById(orderId);
      if (order) {
        order.payment.status = 'completed';
        order.payment.paidAt = new Date();
        order.status = 'confirmed';
        await order.save();
      }

      return {
        paymentId: payment._id,
        orderId: orderId,
        status: 'completed',
        amount: payment.amount
      };

    } catch (error) {
      console.error('PaymentService - confirmStripePayment error:', error);
      throw error;
    }
  }

  /**
   * Process Razorpay Refund
   */
  static async processRazorpayRefund(paymentId, amount, orderId) {
    try {
      if (!razorpay) {
        throw new Error('Razorpay not configured');
      }

      // Find payment record
      const payment = await Payment.findOne({ 
        gatewayPaymentId: paymentId,
        orderId: orderId 
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      // Process refund with Razorpay
      const refund = await razorpay.payments.refund(paymentId, {
        amount: Math.round(amount * 100), // Convert to paise
        notes: {
          reason: 'Refund requested',
          orderId: orderId
        }
      });

      // Update payment record
      payment.refundAmount = amount;
      payment.refundStatus = 'completed';
      payment.refundId = refund.id;
      payment.refundedAt = new Date();
      await payment.save();

      return {
        refundId: refund.id,
        amount: amount,
        status: refund.status
      };

    } catch (error) {
      console.error('PaymentService - processRazorpayRefund error:', error);
      throw error;
    }
  }

  /**
   * Process Stripe Refund
   */
  static async processStripeRefund(paymentIntentId, amount, orderId) {
    try {
      if (!stripe) {
        throw new Error('Stripe not configured');
      }

      // Process refund with Stripe
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(amount * 100), // Convert to cents
        reason: 'requested_by_customer',
        metadata: {
          orderId: orderId,
          reason: 'Refund requested'
        }
      });

      // Find and update payment record
      const payment = await Payment.findOne({ 
        gatewayOrderId: paymentIntentId,
        orderId: orderId 
      });

      if (payment) {
        payment.refundAmount = amount;
        payment.refundStatus = 'completed';
        payment.refundId = refund.id;
        payment.refundedAt = new Date();
        await payment.save();
      }

      return {
        refundId: refund.id,
        amount: amount / 100, // Convert back to dollars
        status: refund.status
      };

    } catch (error) {
      console.error('PaymentService - processStripeRefund error:', error);
      throw error;
    }
  }

  /**
   * Get Payment Analytics
   */
  static async getPaymentAnalytics(startDate, endDate) {
    try {
      // Get payment statistics
      const totalPayments = await Payment.countDocuments({
        paidAt: { $gte: startDate, $lte: endDate },
        status: 'completed'
      });

      const totalRevenue = await Payment.aggregate([
        {
          $match: {
            paidAt: { $gte: startDate, $lte: endDate },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' }
          }
        }
      ]);

      const paymentsByGateway = await Payment.aggregate([
        {
          $match: {
            paidAt: { $gte: startDate, $lte: endDate },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: '$paymentGateway',
            count: { $sum: 1 },
            revenue: { $sum: '$amount' }
          }
        }
      ]);

      const refundStatistics = await Payment.aggregate([
        {
          $match: {
            refundedAt: { $gte: startDate, $lte: endDate },
            refundStatus: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            totalRefunds: { $sum: 1 },
            totalRefundAmount: { $sum: '$refundAmount' }
          }
        }
      ]);

      return {
        totalPayments,
        totalRevenue: totalRevenue[0]?.total || 0,
        paymentsByGateway,
        refundStatistics: refundStatistics[0] || { totalRefunds: 0, totalRefundAmount: 0 }
      };

    } catch (error) {
      console.error('PaymentService - getPaymentAnalytics error:', error);
      throw error;
    }
  }
}

module.exports = PaymentService;