const crypto = require('crypto');
const logger = require('./logger');

/**
 * Payment utility functions for order processing
 */

// Payment methods supported
const PAYMENT_METHODS = {
  CASH_ON_DELIVERY: 'cod',
  ONLINE: 'online',
  WALLET: 'wallet',
  UPI: 'upi',
  CARD: 'card'
};

// Payment statuses
const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled'
};

/**
 * Generate unique payment transaction ID
 * @returns {string} Unique transaction ID
 */
const generateTransactionId = () => {
  const timestamp = Date.now().toString();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TXN${timestamp}${random}`;
};

/**
 * Calculate total amount with taxes and fees
 * @param {number} baseAmount - Base order amount
 * @param {object} options - Tax and fee options
 * @returns {object} Calculated amounts
 */
const calculatePaymentAmount = (baseAmount, options = {}) => {
  const {
    taxRate = 0.18, // 18% GST
    deliveryFee = 0,
    platformFee = 0,
    discount = 0
  } = options;

  const taxAmount = baseAmount * taxRate;
  const totalAmount = baseAmount + taxAmount + deliveryFee + platformFee - discount;

  return {
    baseAmount,
    taxAmount: Math.round(taxAmount * 100) / 100,
    deliveryFee,
    platformFee,
    discount,
    totalAmount: Math.round(totalAmount * 100) / 100
  };
};

/**
 * Validate payment method
 * @param {string} method - Payment method to validate
 * @returns {boolean} Is valid payment method
 */
const isValidPaymentMethod = (method) => {
  return Object.values(PAYMENT_METHODS).includes(method);
};

/**
 * Process COD payment
 * @param {object} orderData - Order information
 * @returns {object} Payment result
 */
const processCODPayment = async (orderData) => {
  try {
    const transactionId = generateTransactionId();
    
    return {
      success: true,
      transactionId,
      paymentMethod: PAYMENT_METHODS.CASH_ON_DELIVERY,
      status: PAYMENT_STATUS.PENDING,
      amount: orderData.totalAmount,
      currency: 'INR',
      timestamp: new Date()
    };
  } catch (error) {
    logger.error('COD payment processing failed', { error: error.message, orderData });
    throw error;
  }
};

/**
 * Process wallet payment
 * @param {object} orderData - Order information
 * @param {object} user - User object with wallet balance
 * @returns {object} Payment result
 */
const processWalletPayment = async (orderData, user) => {
  try {
    const { totalAmount } = orderData;
    
    if (user.walletBalance < totalAmount) {
      return {
        success: false,
        error: 'Insufficient wallet balance',
        requiredAmount: totalAmount,
        availableBalance: user.walletBalance
      };
    }

    const transactionId = generateTransactionId();
    
    return {
      success: true,
      transactionId,
      paymentMethod: PAYMENT_METHODS.WALLET,
      status: PAYMENT_STATUS.COMPLETED,
      amount: totalAmount,
      currency: 'INR',
      timestamp: new Date(),
      walletDeduction: totalAmount
    };
  } catch (error) {
    logger.error('Wallet payment processing failed', { error: error.message, orderData });
    throw error;
  }
};

/**
 * Process online payment (placeholder for actual payment gateway integration)
 * @param {object} orderData - Order information
 * @param {object} paymentDetails - Payment gateway details
 * @returns {object} Payment result
 */
const processOnlinePayment = async (orderData, paymentDetails) => {
  try {
    // This would integrate with actual payment gateways like Razorpay, Stripe, etc.
    const transactionId = generateTransactionId();
    
    // Placeholder implementation
    const mockPaymentSuccess = Math.random() > 0.1; // 90% success rate for testing
    
    return {
      success: mockPaymentSuccess,
      transactionId,
      paymentMethod: PAYMENT_METHODS.ONLINE,
      status: mockPaymentSuccess ? PAYMENT_STATUS.COMPLETED : PAYMENT_STATUS.FAILED,
      amount: orderData.totalAmount,
      currency: 'INR',
      timestamp: new Date(),
      gatewayResponse: {
        gateway: paymentDetails.gateway || 'razorpay',
        gatewayTransactionId: `gw_${transactionId}`,
        paymentMode: paymentDetails.paymentMode || 'card'
      }
    };
  } catch (error) {
    logger.error('Online payment processing failed', { error: error.message, orderData });
    throw error;
  }
};

/**
 * Verify payment signature (for webhook verification)
 * @param {string} payload - Payment payload
 * @param {string} signature - Payment signature
 * @param {string} secret - Webhook secret
 * @returns {boolean} Is signature valid
 */
const verifyPaymentSignature = (payload, signature, secret) => {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    logger.error('Payment signature verification failed', { error: error.message });
    return false;
  }
};

/**
 * Process refund
 * @param {object} paymentData - Original payment data
 * @param {number} refundAmount - Amount to refund
 * @param {string} reason - Refund reason
 * @returns {object} Refund result
 */
const processRefund = async (paymentData, refundAmount, reason) => {
  try {
    const refundId = `REF${generateTransactionId()}`;
    
    // Handle different payment methods
    let refundResult;
    
    switch (paymentData.paymentMethod) {
      case PAYMENT_METHODS.WALLET:
        refundResult = {
          success: true,
          refundId,
          method: 'wallet_credit',
          amount: refundAmount,
          processingTime: '1-2 minutes'
        };
        break;
        
      case PAYMENT_METHODS.ONLINE:
        refundResult = {
          success: true,
          refundId,
          method: 'gateway_refund',
          amount: refundAmount,
          processingTime: '5-7 business days'
        };
        break;
        
      case PAYMENT_METHODS.CASH_ON_DELIVERY:
        refundResult = {
          success: true,
          refundId,
          method: 'wallet_credit',
          amount: refundAmount,
          processingTime: '1-2 minutes'
        };
        break;
        
      default:
        throw new Error('Unsupported payment method for refund');
    }
    
    return {
      ...refundResult,
      originalTransactionId: paymentData.transactionId,
      reason,
      timestamp: new Date(),
      status: PAYMENT_STATUS.PROCESSING
    };
    
  } catch (error) {
    logger.error('Refund processing failed', { error: error.message, paymentData });
    throw error;
  }
};

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  generateTransactionId,
  calculatePaymentAmount,
  isValidPaymentMethod,
  processCODPayment,
  processWalletPayment,
  processOnlinePayment,
  verifyPaymentSignature,
  processRefund
};