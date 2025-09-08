// Order Tracking System for QuickLocal Quick Commerce
// Real-time order status tracking with delivery updates

// ==================== FRONTEND ORDER TRACKING ====================

// 1. HTML Structure for Order Tracking Page
/*
<div class="order-tracking-container">
  <div class="tracking-header">
    <h2>Track Your Order</h2>
    <div class="order-search">
      <input type="text" id="order-id-input" placeholder="Enter Order ID or Phone Number">
      <button id="track-order-btn">Track Order</button>
    </div>
  </div>

  <div id="order-details" class="order-details" style="display: none;">
    <!-- Order information will be populated here -->
  </div>

  <div id="tracking-timeline" class="tracking-timeline" style="display: none;">
    <!-- Tracking steps will be shown here -->
  </div>

  <div id="delivery-map" class="delivery-map" style="display: none;">
    <!-- Real-time delivery tracking map -->
  </div>
</div>
*/

// 2. Order Tracking JavaScript Implementation
class OrderTracking {
  constructor() {
    this.orderIdInput = document.getElementById('order-id-input');
    this.trackBtn = document.getElementById('track-order-btn');
    this.orderDetails = document.getElementById('order-details');
    this.trackingTimeline = document.getElementById('tracking-timeline');
    this.deliveryMap = document.getElementById('delivery-map');
    
    this.currentOrderId = null;
    this.trackingInterval = null;
    
    this.init();
  }

  init() {
    // Track order button click
    this.trackBtn.addEventListener('click', () => {
      this.trackOrder();
    });

    // Enter key to track
    this.orderIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.trackOrder();
      }
    });

    // Auto-load order if order ID is in URL
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('orderId');
    if (orderId) {
      this.orderIdInput.value = orderId;
      this.trackOrder();
    }
  }

  async trackOrder() {
    const identifier = this.orderIdInput.value.trim();
    
    if (!identifier) {
      this.showError('Please enter an Order ID or Phone Number');
      return;
    }

    try {
      this.showLoading();
      
      const response = await fetch(`/api/v1/orders/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ identifier })
      });

      const data = await response.json();
      
      if (data.success) {
        this.displayOrderDetails(data.order);
        this.displayTrackingTimeline(data.order);
        this.startRealTimeTracking(data.order._id);
      } else {
        this.showError(data.message);
      }
    } catch (error) {
      console.error('Order tracking error:', error);
      this.showError('Failed to track order. Please try again.');
    }
  }

  displayOrderDetails(order) {
    this.orderDetails.style.display = 'block';
    this.orderDetails.innerHTML = `
      <div class="order-card">
        <div class="order-header">
          <h3>Order #${order.orderNumber || order._id}</h3>
          <span class="order-status status-${order.status.toLowerCase()}">${order.status.toUpperCase()}</span>
        </div>
        
        <div class="order-info">
          <div class="info-group">
            <label>Order Date:</label>
            <span>${new Date(order.createdAt).toLocaleDateString('en-IN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</span>
          </div>
          
          <div class="info-group">
            <label>Total Amount:</label>
            <span class="amount">₹${order.totalAmount}</span>
          </div>
          
          <div class="info-group">
            <label>Payment Status:</label>
            <span class="payment-status status-${order.paymentStatus.toLowerCase()}">${order.paymentStatus}</span>
          </div>
          
          ${order.estimatedDelivery ? `
            <div class="info-group">
              <label>Expected Delivery:</label>
              <span class="delivery-time">${new Date(order.estimatedDelivery).toLocaleString('en-IN')}</span>
            </div>
          ` : ''}
        </div>

        <div class="delivery-address">
          <h4>Delivery Address</h4>
          <p>${order.deliveryAddress.street}, ${order.deliveryAddress.city}, ${order.deliveryAddress.postalCode}</p>
        </div>

        <div class="order-items">
          <h4>Order Items (${order.items.length} items)</h4>
          <div class="items-list">
            ${order.items.map(item => `
              <div class="order-item">
                <img src="${item.product.images?.[0] || '/images/placeholder-product.jpg'}" 
                     alt="${item.product.name}">
                <div class="item-details">
                  <h5>${item.product.name}</h5>
                  <p>Quantity: ${item.quantity} × ₹${item.price}</p>
                  <span class="item-total">₹${item.quantity * item.price}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        ${order.deliveryPartner ? `
          <div class="delivery-partner">
            <h4>Delivery Partner</h4>
            <div class="partner-info">
              <span class="partner-name">${order.deliveryPartner.name}</span>
              <span class="partner-phone">${order.deliveryPartner.phone}</span>
              ${order.deliveryPartner.vehicle ? `<span class="partner-vehicle">${order.deliveryPartner.vehicle}</span>` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  displayTrackingTimeline(order) {
    this.trackingTimeline.style.display = 'block';
    
    const trackingSteps = [
      { key: 'placed', title: 'Order Placed', description: 'Your order has been confirmed' },
      { key: 'confirmed', title: 'Order Confirmed', description: 'Seller confirmed your order' },
      { key: 'preparing', title: 'Preparing', description: 'Your order is being prepared' },
      { key: 'dispatched', title: 'Dispatched', description: 'Order picked up by delivery partner' },
      { key: 'outForDelivery', title: 'Out for Delivery', description: 'On the way to you' },
      { key: 'delivered', title: 'Delivered', description: 'Order delivered successfully' }
    ];

    const currentStepIndex = trackingSteps.findIndex(step => step.key === order.status);
    
    this.trackingTimeline.innerHTML = `
      <div class="timeline-container">
        <h4>Order Progress</h4>
        <div class="timeline">
          ${trackingSteps.map((step, index) => {
            const isCompleted = index <= currentStepIndex;
            const isCurrent = index === currentStepIndex;
            const statusUpdate = order.statusHistory?.find(s => s.status === step.key);
            
            return `
              <div class="timeline-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}">
                <div class="step-marker">
                  ${isCompleted ? '<i class="fas fa-check"></i>' : (isCurrent ? '<i class="fas fa-clock"></i>' : '<i class="fas fa-circle"></i>')}
                </div>
                <div class="step-content">
                  <h5>${step.title}</h5>
                  <p>${step.description}</p>
                  ${statusUpdate ? `<span class="step-time">${new Date(statusUpdate.timestamp).toLocaleString('en-IN')}</span>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  startRealTimeTracking(orderId) {
    this.currentOrderId = orderId;
    
    // Clear existing interval
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
    }
    
    // Update every 30 seconds for active orders
    this.trackingInterval = setInterval(() => {
      this.updateOrderStatus(orderId);
    }, 30000);
    
    // Initial update
    this.updateOrderStatus(orderId);
  }

  async updateOrderStatus(orderId) {
    try {
      const response = await fetch(`/api/v1/orders/${orderId}/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      if (data.success && data.order) {
        // Update timeline if status changed
        if (data.order.status !== this.currentStatus) {
          this.displayTrackingTimeline(data.order);
          this.currentStatus = data.order.status;
          
          // Show notification for status change
          this.showStatusNotification(data.order.status);
        }

        // Update delivery location if available
        if (data.order.deliveryTracking && data.order.deliveryTracking.currentLocation) {
          this.updateDeliveryLocation(data.order.deliveryTracking.currentLocation);
        }
      }
    } catch (error) {
      console.error('Status update error:', error);
    }
  }

  updateDeliveryLocation(location) {
    // If delivery partner is on the way, show live location
    if (location.latitude && location.longitude) {
      this.deliveryMap.style.display = 'block';
      this.deliveryMap.innerHTML = `
        <div class="live-tracking">
          <h4>Live Tracking</h4>
          <p>Your delivery partner is on the way!</p>
          <div class="location-info">
            <span>Last updated: ${new Date(location.timestamp).toLocaleTimeString('en-IN')}</span>
            <span>Distance: ${location.distance || 'Calculating...'}</span>
            <span>ETA: ${location.eta || 'Calculating...'}</span>
          </div>
        </div>
      `;
    }
  }

  showStatusNotification(status) {
    const messages = {
      'confirmed': 'Your order has been confirmed!',
      'preparing': 'Your order is being prepared',
      'dispatched': 'Your order is on the way!',
      'outForDelivery': 'Delivery partner is nearby',
      'delivered': 'Your order has been delivered!'
    };

    const message = messages[status] || 'Order status updated';
    
    // Show browser notification if permission granted
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Order Update', {
        body: message,
        icon: '/images/logo.png'
      });
    }

    // Show in-page notification
    const notification = document.createElement('div');
    notification.className = 'status-notification';
    notification.innerHTML = `
      <i class="fas fa-info-circle"></i>
      <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  showLoading() {
    this.orderDetails.style.display = 'block';
    this.orderDetails.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <p>Tracking your order...</p>
      </div>
    `;
  }

  showError(message) {
    this.orderDetails.style.display = 'block';
    this.orderDetails.innerHTML = `
      <div class="error-container">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Tracking Error</h3>
        <p>${message}</p>
        <button onclick="window.location.reload()" class="btn-retry">Try Again</button>
      </div>
    `;
  }

  destroy() {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
    }
  }
}

// Initialize order tracking
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('order-id-input')) {
    new OrderTracking();
  }
});

// ==================== BACKEND ORDER TRACKING ROUTES ====================
// Add these routes to your orders.js file

/*
// Track order by ID or phone number
router.post('/track', async (req, res) => {
  try {
    const { identifier } = req.body;
    
    if (!identifier || !identifier.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Order ID or phone number is required'
      });
    }

    let query;
    
    // Check if identifier is phone number or order ID
    if (/^[+]?[0-9]{10,15}$/.test(identifier.replace(/[\s\-\(\)]/g, ''))) {
      // Phone number search
      query = { 'customer.phone': identifier };
    } else {
      // Order ID search
      query = {
        $or: [
          { _id: identifier },
          { orderNumber: identifier },
          { orderNumber: identifier.toUpperCase() }
        ]
      };
    }

    const order = await Order.findOne(query)
      .populate('items.product', 'name images price')
      .populate('customer', 'name email phone')
      .populate('deliveryPartner', 'name phone vehicle')
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found. Please check your Order ID or Phone Number.'
      });
    }

    res.json({
      success: true,
      order,
      message: 'Order found successfully'
    });

  } catch (error) {
    console.error('Order tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track order',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Tracking error'
    });
  }
});

// Get real-time order status
router.get('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId)
      .populate('deliveryPartner', 'name phone vehicle')
      .select('status statusHistory deliveryTracking estimatedDelivery')
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('Order status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get order status'
    });
  }
});

// Update order status (for sellers/admin)
router.put('/:orderId/status', protect, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes, location } = req.body;
    
    const validStatuses = ['placed', 'confirmed', 'preparing', 'dispatched', 'outForDelivery', 'delivered', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status'
      });
    }

    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Update status
    order.status = status;
    
    // Add to status history
    if (!order.statusHistory) order.statusHistory = [];
    order.statusHistory.push({
      status,
      timestamp: new Date(),
      updatedBy: req.user.id,
      notes
    });

    // Update delivery tracking if location provided
    if (location && status === 'outForDelivery') {
      if (!order.deliveryTracking) order.deliveryTracking = {};
      order.deliveryTracking.currentLocation = {
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: new Date()
      };
    }

    // Set delivered timestamp
    if (status === 'delivered') {
      order.deliveredAt = new Date();
    }

    await order.save();

    // Send notification to customer
    // (Email notification will be handled by email system)

    res.json({
      success: true,
      message: 'Order status updated successfully',
      order: {
        _id: order._id,
        status: order.status,
        statusHistory: order.statusHistory
      }
    });

  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order status'
    });
  }
});
*/

// ==================== CSS STYLING ====================
/*
.order-tracking-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.tracking-header {
  text-align: center;
  margin-bottom: 30px;
}

.order-search {
  display: flex;
  gap: 10px;
  max-width: 400px;
  margin: 20px auto 0;
}

.order-search input {
  flex: 1;
  padding: 12px;
  border: 2px solid #ddd;
  border-radius: 8px;
  font-size: 16px;
}

.order-search button {
  background: #007bff;
  color: white;
  border: none;
  padding: 12px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.order-card {
  background: white;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  margin-bottom: 20px;
}

.order-header {
  display: flex;
  justify-content: between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #eee;
}

.order-status {
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.status-placed { background: #e3f2fd; color: #1976d2; }
.status-confirmed { background: #f3e5f5; color: #7b1fa2; }
.status-preparing { background: #fff3e0; color: #f57c00; }
.status-dispatched { background: #e8f5e8; color: #388e3c; }
.status-outfordelivery { background: #e1f5fe; color: #0288d1; }
.status-delivered { background: #e8f5e8; color: #2e7d32; }

.order-info {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.info-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-group label {
  font-size: 12px;
  color: #666;
  font-weight: 600;
  text-transform: uppercase;
}

.timeline-container {
  background: white;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

.timeline {
  position: relative;
  padding-left: 30px;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ddd;
}

.timeline-step {
  position: relative;
  margin-bottom: 25px;
  padding-bottom: 15px;
}

.timeline-step:last-child {
  margin-bottom: 0;
}

.step-marker {
  position: absolute;
  left: -37px;
  top: 0;
  width: 30px;
  height: 30px;
  background: white;
  border: 3px solid #ddd;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #999;
}

.timeline-step.completed .step-marker {
  background: #28a745;
  border-color: #28a745;
  color: white;
}

.timeline-step.current .step-marker {
  background: #007bff;
  border-color: #007bff;
  color: white;
  animation: pulse 2s infinite;
}

.step-content h5 {
  margin: 0 0 5px 0;
  color: #333;
}

.step-content p {
  margin: 0 0 5px 0;
  color: #666;
  font-size: 14px;
}

.step-time {
  font-size: 12px;
  color: #999;
}

.status-notification {
  position: fixed;
  top: 20px;
  right: 20px;
  background: #28a745;
  color: white;
  padding: 15px 20px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 1000;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

@media (max-width: 768px) {
  .order-info {
    grid-template-columns: 1fr;
  }
  
  .order-search {
    flex-direction: column;
  }
}
*/
