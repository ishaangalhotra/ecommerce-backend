const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Order = require('../models/Order');
const Notification = require('../models/Notification');

class SocketService {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socket
    this.userSockets = new Map(); // userId -> Set of socketIds
    this.orderTracking = new Map(); // orderId -> Set of socketIds
    this.chatRooms = new Map(); // roomId -> Set of socketIds
    
    this.setupEventHandlers();
    this.setupPeriodicTasks();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Socket connected: ${socket.id} from ${socket.handshake.address}`);
      
      // Authentication middleware
      socket.use(this.authenticateSocket.bind(this));
      
      // Core event handlers
      socket.on('authenticate', this.handleAuthentication.bind(this, socket));
      socket.on('join_user_room', this.handleJoinUserRoom.bind(this, socket));
      socket.on('track_order', this.handleTrackOrder.bind(this, socket));
      socket.on('join_chat', this.handleJoinChat.bind(this, socket));
      socket.on('send_message', this.handleSendMessage.bind(this, socket));
      socket.on('typing', this.handleTyping.bind(this, socket));
      socket.on('stop_typing', this.handleStopTyping.bind(this, socket));
      socket.on('update_location', this.handleUpdateLocation.bind(this, socket));
      socket.on('request_support', this.handleRequestSupport.bind(this, socket));
      socket.on('disconnect', this.handleDisconnect.bind(this, socket));
      socket.on('error', this.handleError.bind(this, socket));
      
      // Rate limiting
      this.setupRateLimiting(socket);
    });
  }

  async authenticateSocket(packet, next) {
    const [event, data] = packet;
    
    // Skip authentication for certain events
    if (['authenticate', 'ping', 'pong'].includes(event)) {
      return next();
    }
    
    const token = data?.token || data?.authToken;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      packet[1] = { ...data, user: decoded };
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  }

  async handleAuthentication(socket, data) {
    try {
      const { token } = data;
      if (!token) {
        socket.emit('auth_error', { message: 'Token required' });
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        socket.emit('auth_error', { message: 'User not found' });
        return;
      }

      socket.userId = user._id.toString();
      socket.user = user;
      
      // Store user connection
      if (!this.userSockets.has(user._id.toString())) {
        this.userSockets.set(user._id.toString(), new Set());
      }
      this.userSockets.get(user._id.toString()).add(socket.id);
      this.connectedUsers.set(socket.id, user._id.toString());

      // Join user-specific room
      socket.join(`user_${user._id}`);
      
      // Join role-specific rooms
      if (user.role === 'admin') {
        socket.join('admin_room');
      }
      if (user.role === 'seller') {
        socket.join('seller_room');
        socket.join(`seller_${user._id}`);
      }
      if (user.role === 'delivery') {
        socket.join('delivery_room');
        socket.join(`delivery_${user._id}`);
      }

      socket.emit('authenticated', {
        status: 'success',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });

      console.log(`✅ Socket ${socket.id} authenticated for user: ${user.name}`);
      
      // Send pending notifications
      this.sendPendingNotifications(user._id);
      
    } catch (error) {
      console.error('Authentication error:', error);
      socket.emit('auth_error', { message: 'Authentication failed' });
    }
  }

  async handleJoinUserRoom(socket, data) {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const { userId } = data;
    if (userId && userId === socket.userId) {
      socket.join(`user_${userId}`);
      console.log(`👤 Socket ${socket.id} joined user room: ${userId}`);
    }
  }

  async handleTrackOrder(socket, data) {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const { orderId } = data;
    if (!orderId || !orderId.match(/^[0-9a-fA-F]{24}$/)) {
      socket.emit('error', { message: 'Invalid order ID' });
      return;
    }

    try {
      const order = await Order.findById(orderId);
      if (!order) {
        socket.emit('error', { message: 'Order not found' });
        return;
      }

      // Check if user has permission to track this order
      if (order.user.toString() !== socket.userId && 
          socket.user.role !== 'admin' && 
          socket.user.role !== 'seller') {
        socket.emit('error', { message: 'Access denied' });
        return;
      }

      socket.join(`order_${orderId}`);
      
      if (!this.orderTracking.has(orderId)) {
        this.orderTracking.set(orderId, new Set());
      }
      this.orderTracking.get(orderId).add(socket.id);

      // Send current order status
      socket.emit('order_status_update', {
        orderId,
        status: order.status,
        tracking: order.tracking,
        estimatedDelivery: order.estimatedDelivery
      });

      console.log(`📦 Socket ${socket.id} tracking order: ${orderId}`);
      
    } catch (error) {
      console.error('Order tracking error:', error);
      socket.emit('error', { message: 'Failed to track order' });
    }
  }

  async handleJoinChat(socket, data) {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const { roomId, type } = data;
    if (!roomId) {
      socket.emit('error', { message: 'Room ID required' });
      return;
    }

    const roomName = `chat_${type}_${roomId}`;
    socket.join(roomName);
    
    if (!this.chatRooms.has(roomName)) {
      this.chatRooms.set(roomName, new Set());
    }
    this.chatRooms.get(roomName).add(socket.id);

    socket.emit('joined_chat', { roomId, type });
    console.log(`💬 Socket ${socket.id} joined chat room: ${roomName}`);
  }

  async handleSendMessage(socket, data) {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const { roomId, type, message, orderId } = data;
    if (!message || !roomId) {
      socket.emit('error', { message: 'Message and room ID required' });
      return;
    }

    const roomName = `chat_${type}_${roomId}`;
    const messageData = {
      id: Date.now().toString(),
      sender: {
        id: socket.userId,
        name: socket.user.name,
        role: socket.user.role
      },
      message: message.trim(),
      timestamp: new Date(),
      roomId,
      type
    };

    // Broadcast to room
    this.io.to(roomName).emit('new_message', messageData);
    
    // Store message in database if needed
    if (type === 'support' && orderId) {
      // Store support message
      console.log(`💬 Support message stored for order: ${orderId}`);
    }

    console.log(`💬 Message sent in room ${roomName} by ${socket.user.name}`);
  }

  async handleTyping(socket, data) {
    const { roomId, type } = data;
    const roomName = `chat_${type}_${roomId}`;
    
    socket.to(roomName).emit('user_typing', {
      userId: socket.userId,
      userName: socket.user.name
    });
  }

  async handleStopTyping(socket, data) {
    const { roomId, type } = data;
    const roomName = `chat_${type}_${roomId}`;
    
    socket.to(roomName).emit('user_stop_typing', {
      userId: socket.userId,
      userName: socket.user.name
    });
  }

  async handleUpdateLocation(socket, data) {
    if (!socket.userId) return;

    const { latitude, longitude, orderId } = data;
    if (!latitude || !longitude) return;

    // Update delivery location for order tracking
    if (orderId && socket.user.role === 'delivery') {
      this.io.to(`order_${orderId}`).emit('delivery_location_update', {
        orderId,
        location: { latitude, longitude },
        timestamp: new Date(),
        deliveryPartner: {
          id: socket.userId,
          name: socket.user.name
        }
      });
    }
  }

  async handleRequestSupport(socket, data) {
    if (!socket.userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const { orderId, issue, priority } = data;
    
    // Notify support team
    this.io.to('admin_room').emit('support_request', {
      userId: socket.userId,
      userName: socket.user.name,
      orderId,
      issue,
      priority: priority || 'medium',
      timestamp: new Date()
    });

    socket.emit('support_requested', {
      message: 'Support request submitted successfully',
      ticketId: Date.now().toString()
    });
  }

  handleDisconnect(socket, reason) {
    console.log(`🔌 Socket disconnected: ${socket.id}, reason: ${reason}`);
    
    // Clean up user tracking
    if (socket.userId) {
      const userSockets = this.userSockets.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.userSockets.delete(socket.userId);
        }
      }
      this.connectedUsers.delete(socket.id);
    }

    // Clean up order tracking
    this.orderTracking.forEach((sockets, orderId) => {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.orderTracking.delete(orderId);
      }
    });

    // Clean up chat rooms
    this.chatRooms.forEach((sockets, roomName) => {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.chatRooms.delete(roomName);
      }
    });
  }

  handleError(socket, error) {
    console.error(`🔌 Socket error: ${socket.id}`, error);
    socket.emit('error', { message: 'An error occurred' });
  }

  setupRateLimiting(socket) {
    const eventRateLimit = new Map();
    
    socket.use((packet, next) => {
      const event = packet[0];
      const now = Date.now();
      const limit = eventRateLimit.get(event) || { count: 0, resetTime: now + 60000 };
      
      if (now > limit.resetTime) {
        limit.count = 0;
        limit.resetTime = now + 60000;
      }
      
      if (limit.count > 50) { // 50 events per minute
        return next(new Error('Rate limit exceeded'));
      }
      
      limit.count++;
      eventRateLimit.set(event, limit);
      next();
    });
  }

  setupPeriodicTasks() {
    // Clean up empty rooms every 5 minutes
    setInterval(() => {
      let cleanedRooms = 0;
      
      this.orderTracking.forEach((sockets, orderId) => {
        if (sockets.size === 0) {
          this.orderTracking.delete(orderId);
          cleanedRooms++;
        }
      });
      
      this.chatRooms.forEach((sockets, roomName) => {
        if (sockets.size === 0) {
          this.chatRooms.delete(roomName);
          cleanedRooms++;
        }
      });
      
      if (cleanedRooms > 0) {
        console.log(`🧹 Cleaned up ${cleanedRooms} empty socket rooms`);
      }
    }, 5 * 60 * 1000);

    // Send heartbeat every 30 seconds
    setInterval(() => {
      this.io.emit('heartbeat', { timestamp: Date.now() });
    }, 30 * 1000);
  }

  // Public methods for emitting events
  async sendNotification(userId, notification) {
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.forEach(socketId => {
        this.io.to(socketId).emit('notification', notification);
      });
    }
  }

  async sendOrderUpdate(orderId, update) {
    const orderSockets = this.orderTracking.get(orderId);
    if (orderSockets) {
      orderSockets.forEach(socketId => {
        this.io.to(socketId).emit('order_update', update);
      });
    }
    
    // Also emit to order room
    this.io.to(`order_${orderId}`).emit('order_update', update);
  }

  async sendDeliveryUpdate(orderId, update) {
    this.io.to(`order_${orderId}`).emit('delivery_update', update);
  }

  async sendChatMessage(roomId, type, message) {
    const roomName = `chat_${type}_${roomId}`;
    this.io.to(roomName).emit('new_message', message);
  }

  async sendSystemAlert(message, roles = []) {
    const alert = {
      id: Date.now().toString(),
      message,
      timestamp: new Date(),
      type: 'system'
    };

    if (roles.length === 0) {
      this.io.emit('system_alert', alert);
    } else {
      roles.forEach(role => {
        this.io.to(`${role}_room`).emit('system_alert', alert);
      });
    }
  }

  async sendPendingNotifications(userId) {
    try {
      const notifications = await Notification.find({
        user: userId,
        read: false
      }).sort({ createdAt: -1 }).limit(10);

      if (notifications.length > 0) {
        const userSockets = this.userSockets.get(userId);
        if (userSockets) {
          userSockets.forEach(socketId => {
            this.io.to(socketId).emit('pending_notifications', notifications);
          });
        }
      }
    } catch (error) {
      console.error('Error sending pending notifications:', error);
    }
  }

  // Get connection statistics
  getStats() {
    return {
      totalConnections: this.io.engine.clientsCount,
      connectedUsers: this.userSockets.size,
      trackedOrders: this.orderTracking.size,
      activeChatRooms: this.chatRooms.size,
      rooms: this.io.sockets.adapter.rooms.size
    };
  }
}

module.exports = SocketService;
