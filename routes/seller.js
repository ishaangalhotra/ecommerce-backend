// Create product
router.post(
  '/products',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  upload.fields([
    { name: 'images', maxCount: 8 },
    { name: 'image', maxCount: 1 }
  ]),
  validateFileUpload,
  sellerCtrl.validateProduct,
  logRequest('Product creation'),
  asyncHandler(sellerCtrl.uploadProduct)
);

// List my products (with filtering, sorting, pagination)
router.get(
  '/products',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  logRequest('Product retrieval'),
  asyncHandler(sellerCtrl.getMyProducts)
);

// Export my products
router.get(
  '/products/export',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  validateExportFormat,
  logRequest('Export products'),
  asyncHandler(sellerCtrl.exportProducts)
);

// Bulk operations (status changes, price updates, etc.)
router.patch(
  '/products/bulk',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  validateBulkOperation,
  logRequest('Bulk product update'),
  asyncHandler(sellerCtrl.bulkUpdateProducts)
);

// Update product (full update)
router.put(
  '/products/:productId',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  validateObjectId('productId'),
  upload.fields([
    { name: 'images', maxCount: 8 },
    { name: 'image', maxCount: 1 }
  ]),
  validateFileUpload,
  sellerCtrl.validateProduct,
  logRequest('Product update'),
  asyncHandler(async (req, res, next) => {
    req.isFullUpdate = true;
    await sellerCtrl.updateProduct(req, res, next);
  })
);

// Update product (partial update)
router.patch(
  '/products/:productId',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  validateObjectId('productId'),
  upload.fields([
    { name: 'images', maxCount: 8 },
    { name: 'image', maxCount: 1 }
  ]),
  validateFileUpload,
  sellerCtrl.validateProduct,
  logRequest('Product update'),
  asyncHandler(async (req, res, next) => {
    req.isPartialUpdate = true;
    await sellerCtrl.updateProduct(req, res, next);
  })
);

// Delete product
router.delete(
  '/products/:productId',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  validateObjectId('productId'),
  logRequest('Product deletion'),
  asyncHandler(sellerCtrl.deleteProduct)
);

// Seller dashboard (overview metrics)
router.get(
  '/dashboard',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  logRequest('Dashboard access'),
  asyncHandler(sellerCtrl.getSellerDashboard)
);

// Product analytics
router.get(
  '/products/:productId/analytics',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  validateObjectId('productId'),
  logRequest('Product analytics'),
  asyncHandler(sellerCtrl.getProductAnalytics)
);

// Seller orders
router.get(
  '/orders',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  logRequest('Seller orders'),
  asyncHandler(sellerOrders.listSellerOrders)
);

// Update order status
router.patch(
  '/orders/:id/status',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  validateObjectId('id'),
  logRequest('Update order status'),
  asyncHandler(sellerOrders.updateOrderStatusForSeller)
);

// List seller customers
router.get(
  '/customers',
  systemHealthCheck,
  protect(),
  authorize(['seller','admin']),
  logRequest('Seller customers'),
  asyncHandler(sellerOrders.listSellerCustomers)
);