const Razorpay = require('razorpay');
const Stripe = require('stripe');
const crypto = require('crypto');
const Order = require('../models/Order');
const User = require('../models/User');

class PaymentService {
  constructor() {
    // Initialize Razorpay only if enabled and credentials are provided
    if (process.env.RAZORPAY_ENABLED === 'true' && 
        process.env.RAZORPAY_KEY_ID && 
        process.env.RAZORPAY_KEY_SECRET &&
        process.env.RAZORPAY_KEY_ID !== 'your_razorpay_key_id') {
      try {
        this.razorpay = new Razorpay({
          key_id: process.env.RAZORPAY_KEY_ID,
          key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
        console.log('✅ Razorpay initialized successfully');
      } catch (error) {
        console.warn('⚠️  Razorpay initialization failed:', error.message);
        this.razorpay = null;
      }
    } else {
      console.log('ℹ️  Razorpay disabled or not configured');
      this.razorpay = null;
    }

    // Initialize Stripe only if enabled and credentials are provided
    if (process.env.STRIPE_ENABLED === 'true' && 
        process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_SECRET_KEY !== 'sk_test_your_stripe_secret') {
      try {
        this.stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        console.log('✅ Stripe initialized successfully');
      } catch (error) {
        console.warn('⚠️  Stripe initialization failed:', error.message);
        this.stripe = null;
      }
    } else {
      console.log('ℹ️  Stripe disabled or not configured');
      this.stripe = null;
    }
  }

  // RAZORPAY INTEGRATION
  async createRazorpayOrder(orderData) {
    if (!this.razorpay) {
      throw new Error('Razorpay is not initialized or disabled');
    }
    // ... rest of your Razorpay methods
  }

  // Add similar checks for other Razorpay methods
  async verifyRazorpaySignature(signature, orderId, paymentId) {
    if (!this.razorpay) {
      throw new Error('Razorpay is not initialized or disabled');
    }
    // ... rest of verification logic
  }

  // STRIPE INTEGRATION  
  async createStripePaymentIntent(orderData) {
    if (!this.stripe) {
      throw new Error('Stripe is not initialized or disabled');
    }
    // ... rest of your Stripe methods
  }

  // ... rest of your existing methods
}