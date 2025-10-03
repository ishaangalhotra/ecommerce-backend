// ✅ FIXED: Order Creation Route (with all improvements)
router.post('/',
  hybridProtect,
  checkoutLimiter,
  validateOrder,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    let orderData;
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      // ✅ Minimal logging (no full payload)
      logger.info(`Order request from user ${req.user.id}, items: ${(req.body.orderItems || req.body.items)?.length}`);

      // ✅ Process order creation (within transaction)
      orderData = await processOrderCreation(req.body, req.user, session);

      // ✅ Commit transaction BEFORE side effects
      await session.commitTransaction();

      // ✅ CRITICAL: Populate AFTER commit (not during transaction)
      orderData.order = await populateOrderDetails(orderData.order);

    } catch (error) {
      await session.abortTransaction();
      logger.error('Order creation error:', error);
      
      // ✅ Single return point for errors
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Error creating order. Please try again.',
        error: error.details || undefined
      });
    } finally {
      session.endSession();
    }

    // ✅ POST-COMMIT: Side effects (non-blocking)
    // These run AFTER transaction is committed and response headers are safe
    sendOrderNotifications(orderData.order, 'created').catch(err => 
      logger.error('Notification error:', err)
    );

    // ✅ Safe socket emission with error handling
    try {
      if (io) {
        io.to(`user-${req.user.id}`).emit('order-created', {
          orderId: orderData.order._id,
          orderNumber: orderData.order.orderNumber,
          total: orderData.order.pricing.totalPrice
        });
      }
    } catch (socketError) {
      logger.warn('Socket emit failed:', socketError);
    }

    logger.info(`Order created: ${orderData.order.orderNumber}`, {
      orderId: orderData.order._id,
      customerId: req.user.id,
      total: orderData.order.pricing.totalPrice,
      itemCount: orderData.order.orderItems.length
    });

    // ✅ Single response - guaranteed to be sent only once
    // Now includes full product details from populate
    return res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order: {
        id: orderData.order._id,
        orderNumber: orderData.order.orderNumber,
        status: orderData.order.status,
        total: orderData.order.pricing.totalPrice,
        estimatedDelivery: orderData.order.deliveryTracking?.estimatedDeliveryDate,
        // ✅ Include payment result if available
        payment: orderData.paymentResult ? {
          status: 'paid',
          transactionId: orderData.paymentResult.transactionId,
          gateway: orderData.paymentResult.gateway
        } : {
          status: orderData.order.paymentMethod === 'cod' ? 'pending' : 'processing'
        },
        items: orderData.order.orderItems.map(item => ({
          product: item.product?._id || item.product,
          name: item.name,
          qty: item.qty,
          price: item.unitPrice,
          totalPrice: item.totalPrice,
          // ✅ Consistent image handling (handles both string and {url} object)
          image: item.image || 
                 (typeof item.product?.images?.[0] === 'string' 
                   ? item.product.images[0] 
                   : item.product?.images?.[0]?.url),
          seller: item.seller || item.product?.seller
        }))
      }
    });
  }
);

// ✅ FIXED: Process Order Creation (optimized transaction)
async function processOrderCreation(orderData, user, session) {
  const {
    orderItems,
    items,
    shippingAddress,
    deliveryAddress,
    paymentMethod,
    scheduledDelivery,
    couponCode,
    specialInstructions,
    tip = 0
  } = orderData;

  const itemsToProcess = orderItems || items;
  const address = shippingAddress || deliveryAddress;
  
  // ✅ Proper Error objects with statusCode
  if (!itemsToProcess || !Array.isArray(itemsToProcess) || itemsToProcess.length === 0) {
    const err = new Error('Order items are required');
    err.statusCode = 400;
    throw err;
  }
  
  if (!address) {
    const err = new Error('Shipping address is required');
    err.statusCode = 400;
    throw err;
  }

  // ✅ All DB operations within transaction
  const preparedItems = await validateAndPrepareOrderItems(itemsToProcess, session);
  
  const pricing = await calculateOrderPricing(
    preparedItems, 
    address, 
    couponCode,
    tip
  );

  // ✅ Reserve stock atomically
  await reserveProductStock(preparedItems, session);

  const orderNumber = await generateOrderNumber();

  let normalizedPaymentMethod = paymentMethod;
  if (paymentMethod === 'card') normalizedPaymentMethod = 'credit_card';

  const order = new Order({
    orderNumber,
    user: user.id,
    customerInfo: {
      name: user.name,
      email: user.email,
      phone: user.phone
    },
    orderItems: preparedItems,
    shippingAddress: {
      fullName: address.fullName || address.name,
      address: address.address,
      city: address.city,
      state: address.state || '',
      postalCode: address.postalCode || address.pincode,
      country: address.country || 'India',
      phoneNumber: address.phoneNumber || address.phone
    },
    pricing: {
      itemsPrice: pricing.subtotal,
      discountAmount: pricing.discount,
      shippingPrice: pricing.deliveryFee,
      taxPrice: pricing.taxAmount,
      totalPrice: pricing.total
    },
    paymentMethod: normalizedPaymentMethod,
    status: 'pending',
    isPaid: normalizedPaymentMethod !== 'cod',
    // ✅ Include special instructions if provided
    specialInstructions: specialInstructions || '',
    deliveryTracking: {
      estimatedDeliveryDate: calculateEstimatedDeliveryTime(address, scheduledDelivery)
    },
    statusHistory: [{
      status: 'pending',
      timestamp: new Date(),
      description: 'Order placed successfully'
    }]
  });

  // ✅ Save order within transaction
  await order.save({ session });

  // ✅ Payment processing (if needed)
  let paymentResult = null;
  if (normalizedPaymentMethod !== 'cod') {
    // Only include payment processing if it completes in <5s
    // Otherwise move to background job after commit
    try {
      // paymentResult = await processPayment({ ... });
    } catch (paymentError) {
      // Restore stock if payment fails
      await restoreProductStock(preparedItems, session);
      const err = new Error('Payment processing failed');
      err.statusCode = 402;
      err.details = { paymentError: paymentError.message };
      throw err;
    }
  }

  // ✅ Clear cart within transaction
  await Cart.findOneAndDelete({ user: user.id }, { session });

  // ✅ Return unpopulated order - populate happens AFTER commit
  return { order, pricing, paymentResult };
}

// ✅ FIXED: Populate order details after transaction commit
// Using .lean() for performance since we only need to send JSON
async function populateOrderDetails(order) {
  return await Order.findById(order._id)
    .populate('orderItems.product', 'name images price seller slug')
    .populate('user', 'name email phone')
    .lean();
}

// ✅ IMPROVED: Error handling in validateAndPrepareOrderItems
async function validateAndPrepareOrderItems(items, session) {
  const productIds = items.map(item => item.product);
  const products = await Product.find({
    _id: { $in: productIds },
    status: 'active',
    isDeleted: false
  }).session(session);

  const orderItems = [];
  
  for (const item of items) {
    const product = products.find(p => p._id.toString() === item.product.toString());
    
    if (!product) {
      const err = new Error(`Product not found: ${item.product}`);
      err.statusCode = 404;
      throw err;
    }
    
    const quantity = item.qty || item.quantity || 1;
    
    if (product.stock < quantity) {
      const err = new Error(`Insufficient stock for ${product.name}`);
      err.statusCode = 400;
      err.details = {
        productId: product._id,
        requested: quantity,
        available: product.stock
      };
      throw err;
    }
    
    orderItems.push({
      product: product._id,
      name: product.name,
      unitPrice: product.price,
      qty: quantity,
      totalPrice: product.price * quantity,
      seller: product.seller,
      image: product.images && product.images[0] ? 
             (typeof product.images[0] === 'string' ? product.images[0] : product.images[0].url) :
             product.image || ''
    });
  }
  
  return orderItems;
}

// ✅ Optional: Add request timeout wrapper for production
async function withTimeout(promise, timeoutMs = 10000, errorMsg = 'Operation timeout') {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      const err = new Error(errorMsg);
      err.statusCode = 408;
      reject(err);
    }, timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

// Usage example (wrap the entire order creation):
// orderData = await withTimeout(
//   processOrderCreation(req.body, req.user, session),
//   10000,
//   'Order creation timeout - please try again'
// );