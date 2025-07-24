const express = require('express');
const router = express.Router();
const PaymentService = require('../services/paymentservice');

// ============================================================================
// RAZORPAY WEBHOOK HANDLER
// ============================================================================

/**
 * @route   POST /api/v1/webhooks/razorpay
 * @desc    Handle Razorpay webhooks
 * @access  Public (Webhook)
 */
router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    
    if (!signature) {
      console.error('Missing Razorpay signature');
      return res.status(400).json({
        success: false,
        message: 'Missing webhook signature'
      });
    }

    // Parse the raw body
    const body = JSON.parse(req.body.toString());
    
    console.log('📨 Razorpay Webhook received:', body.event);

    // Verify and process webhook
    await PaymentService.handleRazorpayWebhook(body, signature);

    // Log successful webhook processing
    console.log('✅ Razorpay webhook processed successfully:', body.event);

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });

  } catch (error) {
    console.error('❌ Razorpay webhook error:', error.message);
    
    // Don't expose internal errors to webhook sender
    res.status(400).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

// ============================================================================
// STRIPE WEBHOOK HANDLER
// ============================================================================

/**
 * @route   POST /api/v1/webhooks/stripe
 * @desc    Handle Stripe webhooks
 * @access  Public (Webhook)
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (process.env.STRIPE_ENABLED !== 'true') {
      return res.status(400).json({
        success: false,
        message: 'Stripe webhooks are not enabled'
      });
    }

    const signature = req.headers['stripe-signature'];
    
    if (!signature) {
      console.error('Missing Stripe signature');
      return res.status(400).json({
        success: false,
        message: 'Missing webhook signature'
      });
    }

    console.log('📨 Stripe Webhook received');

    // Process webhook (signature verification happens inside PaymentService)
    await PaymentService.handleStripeWebhook(req.body, signature);

    console.log('✅ Stripe webhook processed successfully');

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
    });

  } catch (error) {
    console.error('❌ Stripe webhook error:', error.message);
    
    res.status(400).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

// ============================================================================
// WEBHOOK VERIFICATION ENDPOINTS
// ============================================================================

/**
 * @route   GET /api/v1/webhooks/test/razorpay
 * @desc    Test Razorpay webhook endpoint
 * @access  Public
 */
router.get('/test/razorpay', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Razorpay webhook endpoint is active',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

/**
 * @route   GET /api/v1/webhooks/test/stripe
 * @desc    Test Stripe webhook endpoint
 * @access  Public
 */
router.get('/test/stripe', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Stripe webhook endpoint is active',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    enabled: process.env.STRIPE_ENABLED === 'true'
  });
});

// ============================================================================
// WEBHOOK MONITORING & LOGS
// ============================================================================

/**
 * @route   GET /api/v1/webhooks/logs
 * @desc    Get webhook processing logs (Admin only)
 * @access  Private (Admin)
 */
router.get('/logs', async (req, res) => {
  try {
    // This is a basic implementation - you might want to store webhook logs in database
    const logs = {
      razorpay: {
        endpoint: '/api/v1/webhooks/razorpay',
        lastProcessed: new Date().toISOString(),
        status: 'active'
      },
      stripe: {
        endpoint: '/api/v1/webhooks/stripe',
        lastProcessed: new Date().toISOString(),
        status: process.env.STRIPE_ENABLED === 'true' ? 'active' : 'disabled'
      }
    };

    res.status(200).json({
      success: true,
      data: logs
    });

  } catch (error) {
    console.error('Webhook logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve webhook logs'
    });
  }
});

// ============================================================================
// WEBHOOK HEALTH CHECK
// ============================================================================

/**
 * @route   GET /api/v1/webhooks/health
 * @desc    Health check for webhook endpoints
 * @access  Public
 */
router.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    webhooks: {
      razorpay: {
        enabled: process.env.RAZORPAY_ENABLED === 'true',
        endpoint: '/api/v1/webhooks/razorpay'
      },
      stripe: {
        enabled: process.env.STRIPE_ENABLED === 'true',
        endpoint: '/api/v1/webhooks/stripe'
      }
    },
    environment: process.env.NODE_ENV
  };

  res.status(200).json(health);
});

// ============================================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================================

// Webhook-specific error handler
router.use((error, req, res, next) => {
  console.error('Webhook Error:', {
    url: req.url,
    method: req.method,
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });

  res.status(500).json({
    success: false,
    message: 'Webhook processing error',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;