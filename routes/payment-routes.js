const express = require('express');
const router = express.Router();
const PaymentService = require('../services/paymentservice');
const { hybridProtect } = require('../middleware/hybridAuthmiddleware'); // ← Changed this line
const { validateOrder } = require('../middleware/validation');

// ============================================================================
// RAZORPAY PAYMENT ROUTES
// ============================================================================

/**
 * @route   POST /api/v1/payment/razorpay/create-order
 * @desc    Create Razorpay payment order
 * @access  Private
 */
router.post('/razorpay/create-order', hybridProtect, validateOrder, async (req, res) => { // ← Changed authenticateToken to hybridProtect
  try {
    const { orderId, amount, customerName, customerEmail } = req.body;
    const userId = req.user.id;

    const orderData = {
      orderId,
      amount,
      userId,
      customerName,
      customerEmail
    };

    const razorpayOrder = await PaymentService.createRazorpayOrder(orderData);

    res.status(200).json({
      success: true,
      message: 'Razorpay order created successfully',
      data: razorpayOrder
    });

  } catch (error) {
    console.error('Razorpay order creation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create payment order',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   POST /api/v1/payment/razorpay/verify
 * @desc    Verify Razorpay payment
 * @access  Private
 */
router.post('/razorpay/verify', hybridProtect, async (req, res) => { // ← Changed authenticateToken to hybridProtect
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required payment verification data'
      });
    }

    const paymentData = {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    };

    const verificationResult = await PaymentService.verifyRazorpayPayment(paymentData);

    res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      data: verificationResult
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Payment verification failed'
    });
  }
});

// ============================================================================
// STRIPE PAYMENT ROUTES
// ============================================================================

/**
 * @route   POST /api/v1/payment/stripe/create-intent
 * @desc    Create Stripe payment intent
 * @access  Private
 */
router.post('/stripe/create-intent', hybridProtect, validateOrder, async (req, res) => { // ← Changed authenticateToken to hybridProtect
  try {
    if (process.env.STRIPE_ENABLED !== 'true') {
      return res.status(400).json({
        success: false,
        message: 'Stripe payments are not enabled'
      });
    }

    const { orderId, amount, customerName, customerEmail } = req.body;
    const userId = req.user.id;

    const orderData = {
      orderId,
      amount,
      userId,
      customerName,
      customerEmail
    };

    const paymentIntent = await PaymentService.createStripePaymentIntent(orderData);

    res.status(200).json({
      success: true,
      message: 'Payment intent created successfully',
      data: paymentIntent
    });

  } catch (error) {
    console.error('Stripe payment intent error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create payment intent'
    });
  }
});

/**
 * @route   POST /api/v1/payment/stripe/confirm
 * @desc    Confirm Stripe payment
 * @access  Private
 */
router.post('/stripe/confirm', hybridProtect, async (req, res) => { // ← Changed authenticateToken to hybridProtect
  try {
    const { paymentIntentId, orderId } = req.body;

    if (!paymentIntentId || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment intent ID or order ID'
      });
    }

    const confirmationResult = await PaymentService.confirmStripePayment(paymentIntentId, orderId);

    res.status(200).json({
      success: true,
      message: 'Payment confirmed successfully',
      data: confirmationResult
    });

  } catch (error) {
    console.error('Payment confirmation error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Payment confirmation failed'
    });
  }
});

// ============================================================================
// REFUND ROUTES
// ============================================================================

/**
 * @route   POST /api/v1/payment/refund/razorpay
 * @desc    Process Razorpay refund
 * @access  Private (Admin/Seller)
 */
router.post('/refund/razorpay', hybridProtect, async (req, res) => { // ← Changed authenticateToken to hybridProtect
  try {
    const { paymentId, amount, orderId, reason } = req.body;

    if (!paymentId || !amount || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required refund data'
      });
    }

    const refundResult = await PaymentService.processRazorpayRefund(paymentId, amount, orderId);

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: refundResult
    });

  } catch (error) {
    console.error('Refund processing error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Refund processing failed'
    });
  }
});

/**
 * @route   POST /api/v1/payment/refund/stripe
 * @desc    Process Stripe refund
 * @access  Private (Admin/Seller)
 */
router.post('/refund/stripe', hybridProtect, async (req, res) => { // ← Changed authenticateToken to hybridProtect
  try {
    const { paymentIntentId, amount, orderId, reason } = req.body;

    if (!paymentIntentId || !amount || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required refund data'
      });
    }

    const refundResult = await PaymentService.processStripeRefund(paymentIntentId, amount, orderId);

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: refundResult
    });

  } catch (error) {
    console.error('Refund processing error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Refund processing failed'
    });
  }
});

// ============================================================================
// PAYMENT ANALYTICS ROUTES
// ============================================================================

/**
 * @route   GET /api/v1/payment/analytics
 * @desc    Get payment analytics
 * @access  Private (Admin/Seller)
 */
router.get('/analytics', hybridProtect, async (req, res) => { // ← Changed authenticateToken to hybridProtect
  try {
    const { startDate, endDate } = req.query;

    // Default to last 30 days if no dates provided
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const analytics = await PaymentService.getPaymentAnalytics(start, end);

    res.status(200).json({
      success: true,
      message: 'Payment analytics retrieved successfully',
      data: {
        ...analytics,
        dateRange: {
          startDate: start,
          endDate: end
        }
      }
    });

  } catch (error) {
    console.error('Payment analytics error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to retrieve payment analytics'
    });
  }
});

// ============================================================================
// PAYMENT STATUS ROUTES
// ============================================================================

/**
 * @route   GET /api/v1/payment/status/:orderId
 * @desc    Get payment status for an order
 * @access  Private
 */
router.get('/status/:orderId', hybridProtect, async (req, res) => { // ← Changed authenticateToken to hybridProtect
  try {
    const { orderId } = req.params;

    // You'll need to implement this in your Order model
    const Order = require('../models/Order');
    const order = await Order.findById(orderId).select('payment status');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        orderId: order._id,
        paymentStatus: order.payment.status,
        orderStatus: order.status,
        paymentMethod: order.payment.method,
        amount: order.totalAmount
      }
    });

  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payment status'
    });
  }
});

// ============================================================================
// PAYMENT METHODS ROUTES
// ============================================================================

/**
 * @route   GET /api/v1/payment/methods
 * @desc    Get available payment methods
 * @access  Public
 */
router.get('/methods', async (req, res) => {
  try {
    const paymentMethods = [];

    if (process.env.RAZORPAY_ENABLED === 'true') {
      paymentMethods.push({
        provider: 'razorpay',
        methods: ['card', 'netbanking', 'upi', 'wallet'],
        currency: 'INR',
        country: 'IN'
      });
    }

    if (process.env.STRIPE_ENABLED === 'true') {
      paymentMethods.push({
        provider: 'stripe',
        methods: ['card', 'apple_pay', 'google_pay'],
        currency: 'USD',
        country: 'US'
      });
    }

    if (process.env.PAYPAL_ENABLED === 'true') {
      paymentMethods.push({
        provider: 'paypal',
        methods: ['paypal'],
        currency: 'USD',
        country: 'US'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        availableMethods: paymentMethods,
        platformCommission: parseFloat(process.env.PLATFORM_COMMISSION),
        paymentGatewayFee: parseFloat(process.env.PAYMENT_GATEWAY_FEE)
      }
    });

  } catch (error) {
    console.error('Payment methods error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payment methods'
    });
  }
});

module.exports = router;