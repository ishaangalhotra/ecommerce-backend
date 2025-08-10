const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Invoice utility functions for order processing
 */

// Invoice configuration
const INVOICE_CONFIG = {
  COMPANY_NAME: 'QuickLocal',
  COMPANY_ADDRESS: [
    'QuickLocal Technologies Pvt Ltd',
    'Electronic City, Bengaluru',
    'Karnataka 560100, India',
    'GSTIN: 29ABCDE1234F1Z5'
  ],
  INVOICE_PREFIX: 'QL',
  TAX_RATE: 0.18, // 18% GST
  CURRENCY: 'INR',
  CURRENCY_SYMBOL: '₹'
};

/**
 * Generate unique invoice number
 * @param {string} orderNumber - Order number
 * @returns {string} Invoice number
 */
const generateInvoiceNumber = (orderNumber) => {
  const timestamp = Date.now().toString().slice(-6);
  return `${INVOICE_CONFIG.INVOICE_PREFIX}-${orderNumber}-${timestamp}`;
};

/**
 * Calculate invoice totals
 * @param {Array} items - Order items
 * @param {Object} shipping - Shipping details
 * @param {Object} discounts - Applied discounts
 * @returns {Object} Calculated totals
 */
const calculateInvoiceTotals = (items, shipping = {}, discounts = {}) => {
  let subtotal = 0;
  let totalTax = 0;

  // Calculate item totals
  const processedItems = items.map(item => {
    const itemTotal = item.price * item.quantity;
    const itemTax = itemTotal * INVOICE_CONFIG.TAX_RATE;
    
    subtotal += itemTotal;
    totalTax += itemTax;

    return {
      ...item,
      total: itemTotal,
      tax: itemTax
    };
  });

  const shippingCost = shipping.cost || 0;
  const discountAmount = discounts.amount || 0;
  
  const grandTotal = subtotal + totalTax + shippingCost - discountAmount;

  return {
    items: processedItems,
    subtotal: Math.round(subtotal * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    shippingCost,
    discountAmount,
    grandTotal: Math.round(grandTotal * 100) / 100
  };
};

/**
 * Generate invoice data object
 * @param {Object} order - Order object
 * @param {Object} customer - Customer object
 * @returns {Object} Invoice data
 */
const generateInvoiceData = (order, customer) => {
  const invoiceNumber = generateInvoiceNumber(order.orderNumber);
  const totals = calculateInvoiceTotals(
    order.items, 
    order.shipping, 
    order.discounts
  );

  return {
    invoiceNumber,
    orderNumber: order.orderNumber,
    invoiceDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    
    // Company details
    company: {
      name: INVOICE_CONFIG.COMPANY_NAME,
      address: INVOICE_CONFIG.COMPANY_ADDRESS
    },
    
    // Customer details
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: order.shipping?.address || customer.addresses?.[0]
    },
    
    // Order items and totals
    subtotal: totals.subtotal,
    totalTax: totals.totalTax,
    shippingCost: totals.shippingCost,
    discountAmount: totals.discountAmount,
    total: totals.total,
    
    // Payment details
    paymentMethod: order.payment?.method || 'Not specified',
    paymentStatus: order.payment?.status || 'pending',
    
    // Additional info
    notes: order.notes || '',
    terms: 'Payment due within 30 days of invoice date.'
  };
};

/**
 * Generate PDF invoice
 * @param {Object} invoiceData - Invoice data object
 * @returns {Buffer} PDF buffer
 */
const generateInvoicePDF = (invoiceData) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Header
      doc.fontSize(20)
         .text(INVOICE_CONFIG.COMPANY_NAME, 50, 50)
         .fontSize(10)
         .text(INVOICE_CONFIG.COMPANY_ADDRESS.join('\n'), 50, 80);

      // Invoice title
      doc.fontSize(20)
         .text('INVOICE', 400, 50);

      // Invoice details
      doc.fontSize(10)
         .text(`Invoice #: ${invoiceData.invoiceNumber}`, 400, 80)
         .text(`Order #: ${invoiceData.orderNumber}`, 400, 95)
         .text(`Date: ${invoiceData.invoiceDate.toLocaleDateString()}`, 400, 110)
         .text(`Due Date: ${invoiceData.dueDate.toLocaleDateString()}`, 400, 125);

      // Customer details
      doc.text('Bill To:', 50, 150)
         .text(invoiceData.customer.name, 50, 165)
         .text(invoiceData.customer.email, 50, 180);

      if (invoiceData.customer.address) {
        const address = invoiceData.customer.address;
        doc.text(`${address.street}`, 50, 195)
           .text(`${address.city}, ${address.state} ${address.pincode}`, 50, 210);
      }

      // Items table header
      const tableTop = 250;
      doc.text('Item', 50, tableTop)
         .text('Qty', 250, tableTop)
         .text('Price', 300, tableTop)
         .text('Tax', 380, tableTop)
         .text('Total', 450, tableTop);

      // Draw line under header
      doc.moveTo(50, tableTop + 15)
         .lineTo(550, tableTop + 15)
         .stroke();

      // Items
      let yPosition = tableTop + 30;
      invoiceData.items.forEach(item => {
        doc.text(item.name, 50, yPosition)
           .text(item.quantity.toString(), 250, yPosition)
           .text(`${INVOICE_CONFIG.CURRENCY_SYMBOL}${item.price}`, 300, yPosition)
           .text(`${INVOICE_CONFIG.CURRENCY_SYMBOL}${item.tax.toFixed(2)}`, 380, yPosition)
           .text(`${INVOICE_CONFIG.CURRENCY_SYMBOL}${item.total.toFixed(2)}`, 450, yPosition);
        yPosition += 20;
      });

      // Totals
      const totalsTop = yPosition + 20;
      doc.text(`Subtotal: ${INVOICE_CONFIG.CURRENCY_SYMBOL}${invoiceData.subtotal}`, 350, totalsTop)
         .text(`Tax: ${INVOICE_CONFIG.CURRENCY_SYMBOL}${invoiceData.totalTax}`, 350, totalsTop + 15);

      if (invoiceData.shippingCost > 0) {
        doc.text(`Shipping: ${INVOICE_CONFIG.CURRENCY_SYMBOL}${invoiceData.shippingCost}`, 350, totalsTop + 30);
      }

      if (invoiceData.discountAmount > 0) {
        doc.text(`Discount: -${INVOICE_CONFIG.CURRENCY_SYMBOL}${invoiceData.discountAmount}`, 350, totalsTop + 45);
      }

      doc.fontSize(12)
         .text(`Total: ${INVOICE_CONFIG.CURRENCY_SYMBOL}${invoiceData.grandTotal}`, 350, totalsTop + 60);

      // Payment info
      doc.fontSize(10)
         .text(`Payment Method: ${invoiceData.paymentMethod}`, 50, totalsTop + 80)
         .text(`Payment Status: ${invoiceData.paymentStatus}`, 50, totalsTop + 95);

      // Terms
      if (invoiceData.terms) {
        doc.text('Terms & Conditions:', 50, totalsTop + 120)
           .text(invoiceData.terms, 50, totalsTop + 135);
      }

      // Footer
      doc.text('Thank you for your business!', 50, 700, { align: 'center' });

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Generate and save invoice
 * @param {Object} order - Order object
 * @param {Object} customer - Customer object
 * @param {string} outputPath - Optional output file path
 * @returns {Object} Invoice result
 */
const generateInvoice = async (order, customer, outputPath = null) => {
  try {
    const invoiceData = generateInvoiceData(order, customer);
    const pdfBuffer = await generateInvoicePDF(invoiceData);

    let filePath = null;
    if (outputPath) {
      filePath = path.resolve(outputPath);
      fs.writeFileSync(filePath, pdfBuffer);
    }

    logger.info('Invoice generated successfully', {
      invoiceNumber: invoiceData.invoiceNumber,
      orderNumber: order.orderNumber,
      filePath
    });

    return {
      success: true,
      invoiceData,
      pdfBuffer,
      filePath
    };

  } catch (error) {
    logger.error('Invoice generation failed', {
      error: error.message,
      orderNumber: order.orderNumber
    });
    throw error;
  }
};

/**
 * Email invoice to customer
 * @param {Object} invoiceResult - Result from generateInvoice
 * @param {string} customerEmail - Customer email
 * @returns {Object} Email result
 */
const emailInvoice = async (invoiceResult, customerEmail) => {
  try {
    const { sendEmail } = require('./email');

    await sendEmail({
      email: customerEmail,
      subject: `Invoice ${invoiceResult.invoiceData.invoiceNumber} - ${INVOICE_CONFIG.COMPANY_NAME}`,
      template: 'invoice',
      data: {
        invoiceNumber: invoiceResult.invoiceData.invoiceNumber,
        orderNumber: invoiceResult.invoiceData.orderNumber,
        total: invoiceResult.invoiceData.grandTotal,
        customerName: invoiceResult.invoiceData.customer.name
      },
      attachments: [
        {
          filename: `invoice-${invoiceResult.invoiceData.invoiceNumber}.pdf`,
          content: invoiceResult.pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });

    logger.info('Invoice emailed successfully', {
      invoiceNumber: invoiceResult.invoiceData.invoiceNumber,
      email: customerEmail
    });

    return { success: true };

  } catch (error) {
    logger.error('Invoice email failed', {
      error: error.message,
      email: customerEmail
    });
    throw error;
  }
};

/**
 * Validate invoice data
 * @param {Object} order - Order object
 * @param {Object} customer - Customer object
 * @returns {boolean} Is valid
 */
const validateInvoiceData = (order, customer) => {
  const required = {
    order: ['orderNumber', 'items'],
    customer: ['name', 'email']
  };

  for (const field of required.order) {
    if (!order[field]) {
      throw new Error(`Missing required order field: ${field}`);
    }
  }

  for (const field of required.customer) {
    if (!customer[field]) {
      throw new Error(`Missing required customer field: ${field}`);
    }
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error('Order must have at least one item');
  }

  return true;
};

module.exports = {
  generateInvoiceNumber,
  calculateInvoiceTotals,
  generateInvoiceData,
  generateInvoicePDF,
  generateInvoice,
  emailInvoice,
  validateInvoiceData,
  INVOICE_CONFIG
};