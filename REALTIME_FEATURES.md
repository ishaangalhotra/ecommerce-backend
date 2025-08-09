# QuickLocal Real-time Features Documentation

## 🚀 Overview

QuickLocal now includes comprehensive real-time features powered by Socket.IO, providing live updates for order tracking, notifications, chat, and delivery management.

## 📋 Features Implemented

### ✅ **Real-time Notifications**
- Live order status updates
- Payment confirmations
- Delivery tracking alerts
- System announcements
- Support request notifications

### ✅ **Live Order Tracking**
- Real-time order status updates
- Delivery partner location tracking
- Estimated delivery time updates
- Order timeline visualization

### ✅ **Real-time Chat System**
- Customer support chat
- Order-specific chat rooms
- Typing indicators
- Message history
- Support queue management

### ✅ **Delivery Partner Features**
- Live location updates
- Order assignment notifications
- Real-time status reporting
- Route optimization

## 🏗️ Architecture

### Backend Services

#### 1. **SocketService** (`services/socketService.js`)
- Handles all Socket.IO connections
- Manages authentication and authorization
- Routes events to appropriate services
- Provides connection statistics

#### 2. **RealtimeNotificationService** (`services/realtimeNotificationService.js`)
- Manages all notification types
- Sends real-time notifications to users
- Handles notification persistence
- Supports priority levels

#### 3. **RealtimeOrderTrackingService** (`services/realtimeOrderTrackingService.js`)
- Tracks order status changes
- Manages delivery partner assignments
- Updates delivery locations
- Calculates estimated delivery times

#### 4. **RealtimeChatService** (`services/realtimeChatService.js`)
- Manages chat rooms and messages
- Handles support requests
- Provides typing indicators
- Manages message history

### Frontend Client

#### **RealtimeClient** (`frontend/js/realtime.js`)
- Connects to Socket.IO server
- Handles authentication
- Manages UI updates
- Provides event handling

## 🔌 Socket.IO Events

### Connection Events
```javascript
// Client to Server
socket.emit('authenticate', { token: 'jwt_token' });
socket.emit('join_user_room', { userId: 'user_id' });
socket.emit('track_order', { orderId: 'order_id' });

// Server to Client
socket.on('authenticated', { user: {...} });
socket.on('auth_error', { message: 'error' });
socket.on('connected', { status: 'success' });
```

### Notification Events
```javascript
// Server to Client
socket.on('notification', {
  id: 'notification_id',
  type: 'order_created',
  title: 'Order Placed!',
  message: 'Your order has been placed successfully',
  priority: 'normal',
  timestamp: '2024-01-01T00:00:00Z'
});

socket.on('pending_notifications', [
  // Array of unread notifications
]);
```

### Order Tracking Events
```javascript
// Client to Server
socket.emit('track_order', { orderId: 'order_id' });

// Server to Client
socket.on('order_update', {
  orderId: 'order_id',
  status: 'dispatched',
  tracking: { currentLocation: {...} },
  estimatedDelivery: '2024-01-01T00:20:00Z'
});

socket.on('delivery_update', {
  orderId: 'order_id',
  location: { latitude: 0, longitude: 0 },
  deliveryPartner: { name: 'John Doe' }
});
```

### Chat Events
```javascript
// Client to Server
socket.emit('join_chat', { roomId: 'room_id', type: 'support' });
socket.emit('send_message', { roomId: 'room_id', type: 'support', message: 'Hello' });
socket.emit('typing', { roomId: 'room_id', type: 'support' });

// Server to Client
socket.on('new_message', {
  id: 'message_id',
  sender: { id: 'user_id', name: 'John', role: 'customer' },
  message: 'Hello',
  timestamp: '2024-01-01T00:00:00Z'
});

socket.on('user_typing', { userId: 'user_id', userName: 'John' });
socket.on('chat_history', { messages: [...] });
```

## 🛠️ Implementation Guide

### 1. **Backend Setup**

#### Install Dependencies
```bash
npm install socket.io
```

#### Initialize Services
```javascript
// In server.js
const SocketService = require('./services/socketService');
const RealtimeNotificationService = require('./services/realtimeNotificationService');
const RealtimeOrderTrackingService = require('./services/realtimeOrderTrackingService');
const RealtimeChatService = require('./services/realtimeChatService');

// Initialize services
this.socketService = new SocketService(this.io);
this.notificationService = new RealtimeNotificationService(this.socketService);
this.orderTrackingService = new RealtimeOrderTrackingService(this.socketService, this.notificationService);
this.chatService = new RealtimeChatService(this.socketService);
```

### 2. **Frontend Setup**

#### Include Socket.IO Client
```html
<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
<script src="js/realtime.js"></script>
<link rel="stylesheet" href="css/realtime.css">
```

#### Initialize Client
```javascript
// The client is automatically initialized
// Access via window.realtimeClient

// Track an order
realtimeClient.trackOrder('order_id');

// Join chat
realtimeClient.joinChat('room_id', 'support');

// Send message
realtimeClient.sendMessage('room_id', 'support', 'Hello!');
```

### 3. **HTML Structure**

#### Notification Container
```html
<div id="notification-container" class="notification-container"></div>
```

#### Chat Container
```html
<div class="chat-container">
  <div class="chat-header">
    <h3>Customer Support</h3>
    <div class="chat-controls">
      <button class="chat-control-btn" id="minimize-chat">−</button>
      <button class="chat-control-btn" id="close-chat">×</button>
    </div>
  </div>
  <div class="chat-messages" id="chat-messages"></div>
  <div class="typing-indicator" id="typing-indicator"></div>
  <div class="chat-input-container">
    <textarea class="chat-input" id="chat-input" placeholder="Type your message..."></textarea>
    <button class="chat-send-btn" id="send-message">➤</button>
  </div>
</div>
```

#### Order Tracking
```html
<div class="order-tracking">
  <div class="tracking-timeline">
    <div class="timeline" id="order-tracking">
      <!-- Timeline steps will be added dynamically -->
    </div>
  </div>
  <div class="delivery-info" id="delivery-tracking">
    <!-- Delivery information will be updated dynamically -->
  </div>
</div>
```

## 📊 API Reference

### NotificationService Methods

```javascript
// Send order notification
await notificationService.sendOrderNotification(orderId, 'order_created');

// Send payment notification
await notificationService.sendPaymentNotification(userId, 'payment_success', paymentData);

// Send delivery update
await notificationService.sendDeliveryUpdate(orderId, {
  message: 'Your order is out for delivery',
  location: { latitude: 0, longitude: 0 }
});

// Send system alert
await notificationService.sendSystemAlert('System maintenance scheduled', ['admin']);
```

### OrderTrackingService Methods

```javascript
// Update order status
await orderTrackingService.updateOrderStatus(orderId, 'dispatched', {
  tracking: { currentLocation: {...} },
  notes: 'Order picked up by delivery partner'
});

// Update delivery location
await orderTrackingService.updateDeliveryLocation(orderId, {
  latitude: 0,
  longitude: 0,
  accuracy: 10
});

// Assign delivery partner
await orderTrackingService.assignDeliveryPartner(orderId, partnerId);

// Get tracking info
const trackingInfo = await orderTrackingService.getOrderTrackingInfo(orderId);
```

### ChatService Methods

```javascript
// Create support request
await chatService.createSupportRequest(userId, 'Order issue', 'high');

// Join chat room
await chatService.joinChatRoom(socket, roomId, 'support', userId);

// Send message
await chatService.sendMessage(socket, roomId, 'support', 'Hello', userId);

// Get chat history
const history = await chatService.getChatHistory(roomId);
```

## 🔧 Configuration

### Environment Variables
```env
# Socket.IO Configuration
ENABLE_SOCKET_IO=true
SOCKET_PING_TIMEOUT=60000
SOCKET_PING_INTERVAL=25000
SOCKET_MAX_HTTP_BUFFER_SIZE=10485760

# Real-time Features
FEATURE_LIVE_TRACKING=true
FEATURE_CHAT=true
FEATURE_REVIEWS=true
FEATURE_LOYALTY_PROGRAM=true
```

### CORS Configuration
```javascript
// In server.js
const corsOptions = {
  origin: ['http://localhost:3000', 'https://yourdomain.com'],
  credentials: true,
  methods: ['GET', 'POST']
};
```

## 🧪 Testing

### Test Socket Connection
```javascript
// Test connection
const status = realtimeClient.getConnectionStatus();
console.log('Connection status:', status);

// Test authentication
realtimeClient.on('authenticated', (data) => {
  console.log('Authenticated:', data);
});

// Test notifications
realtimeClient.on('notification', (notification) => {
  console.log('Received notification:', notification);
});
```

### Test Order Tracking
```javascript
// Track an order
realtimeClient.trackOrder('order_id');

realtimeClient.on('order_update', (update) => {
  console.log('Order updated:', update);
});
```

## 📈 Performance Considerations

### Backend Optimization
- **Connection Pooling**: Socket.IO manages connections efficiently
- **Rate Limiting**: Prevents abuse with 50 events per minute limit
- **Memory Management**: Automatic cleanup of inactive rooms
- **Error Handling**: Comprehensive error handling and logging

### Frontend Optimization
- **Reconnection**: Automatic reconnection with exponential backoff
- **Event Debouncing**: Prevents excessive UI updates
- **Memory Cleanup**: Proper event listener cleanup
- **Responsive Design**: Mobile-optimized real-time features

## 🔒 Security Features

### Authentication
- JWT-based socket authentication
- Role-based access control
- Token validation on every event

### Rate Limiting
- Per-socket event rate limiting
- Connection rate limiting
- Message frequency controls

### Data Validation
- Input sanitization
- Event validation
- Error boundary handling

## 🚀 Deployment

### Production Setup
```bash
# Install dependencies
npm install

# Set environment variables
ENABLE_SOCKET_IO=true
NODE_ENV=production

# Start server
npm start
```

### Docker Deployment
```dockerfile
# Add to Dockerfile
EXPOSE 10000
ENV ENABLE_SOCKET_IO=true
```

### Load Balancer Configuration
```nginx
# Nginx configuration for Socket.IO
location /socket.io/ {
    proxy_pass http://localhost:10000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 📝 Troubleshooting

### Common Issues

#### Connection Failed
```javascript
// Check server status
curl http://localhost:10000/health

// Check Socket.IO endpoint
curl http://localhost:10000/socket.io/
```

#### Authentication Issues
```javascript
// Verify JWT token
const token = localStorage.getItem('authToken');
console.log('Token:', token);

// Check authentication status
const status = realtimeClient.getConnectionStatus();
console.log('Auth status:', status.authenticated);
```

#### Missing Notifications
```javascript
// Check notification service
realtimeClient.on('notification', (notification) => {
  console.log('Notification received:', notification);
});

// Check pending notifications
realtimeClient.on('pending_notifications', (notifications) => {
  console.log('Pending notifications:', notifications);
});
```

### Debug Mode
```javascript
// Enable debug logging
localStorage.setItem('debug', 'socket.io:*');

// Check connection logs
realtimeClient.on('connected', () => {
  console.log('Connected to Socket.IO');
});

realtimeClient.on('disconnected', (reason) => {
  console.log('Disconnected:', reason);
});
```

## 🎯 Next Steps

### Planned Enhancements
1. **Push Notifications**: Web push notifications for mobile
2. **Voice Chat**: Audio support for customer service
3. **Video Calls**: Video support for complex issues
4. **AI Chatbot**: Automated customer support
5. **Analytics Dashboard**: Real-time analytics
6. **Multi-language Support**: Internationalization

### Integration Opportunities
1. **Payment Gateways**: Real-time payment status
2. **Inventory Management**: Live stock updates
3. **Marketing Tools**: Real-time promotions
4. **CRM Integration**: Customer relationship management
5. **Analytics Platforms**: Real-time data streaming

---

## 📞 Support

For technical support or questions about real-time features:

- **Documentation**: Check this file and inline code comments
- **Issues**: Create GitHub issues for bugs
- **Discussions**: Use GitHub discussions for questions
- **Email**: support@quicklocal.com

---

**QuickLocal Real-time Features** - Revolutionizing e-commerce with live updates and instant communication.
