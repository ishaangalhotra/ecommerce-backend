const User = require('../models/User');
const Order = require('../models/Order');

class RealtimeChatService {
  constructor(socketService, options = {}) {
    this.socketService = socketService;
    
    // Configure limits to prevent unbounded growth
    this.config = {
      maxChatRooms: options.maxChatRooms || 1000,
      maxMessageHistoryPerRoom: options.maxMessageHistoryPerRoom || 100,
      maxSupportRequests: options.maxSupportRequests || 500,
      roomInactiveThreshold: options.roomInactiveThreshold || 24 * 60 * 60 * 1000, // 24 hours
      supportResolvedThreshold: options.supportResolvedThreshold || 7 * 24 * 60 * 60 * 1000, // 7 days
      cleanupInterval: options.cleanupInterval || 30 * 60 * 1000, // 30 minutes
      typingTimeout: options.typingTimeout || 5000, // 5 seconds
      maxTypingUsers: options.maxTypingUsers || 50,
      ...options
    };

    // Memory-bounded storage with size limits
    this.chatRooms = new Map(); // roomId -> room data
    this.userTyping = new Map(); // roomId -> Set of typing users  
    this.messageHistory = new Map(); // roomId -> bounded message array
    this.supportQueue = new Map(); // bounded support requests
    
    // Typing timeout tracking
    this.typingTimeouts = new Map(); // userId-roomId -> timeout
    
    // Cleanup interval handle
    this.cleanupIntervalId = null;
    
    // Statistics for monitoring
    this.stats = {
      totalMessagesProcessed: 0,
      peakConcurrentRooms: 0,
      cleanupRuns: 0,
      lastCleanup: null,
      memoryWarnings: 0
    };
  }

  startPeriodicCleanup() {
    if (this.cleanupIntervalId) {
      console.log('Chat service cleanup already running');
      return;
    }

    this.cleanupIntervalId = setInterval(() => {
      this.performMaintenance();
    }, this.config.cleanupInterval);
    
    console.log(`Chat service periodic cleanup scheduled every ${this.config.cleanupInterval / 1000 / 60} minutes`);
  }

  async performMaintenance() {
    try {
      console.log('Running chat service maintenance...');
      const startTime = Date.now();
      
      const cleaned = await this.cleanupInactiveChats();
      const supportCleaned = await this.cleanupSupportQueue();
      await this.cleanupTypingTimeouts();
      await this.checkMemoryLimits();
      
      this.stats.cleanupRuns++;
      this.stats.lastCleanup = new Date();
      
      const duration = Date.now() - startTime;
      console.log(`Chat maintenance completed in ${duration}ms: ${cleaned} rooms, ${supportCleaned} support requests cleaned`);
      
      // Log current memory usage
      this.logMemoryStats();
      
    } catch (error) {
      console.error('Error during chat maintenance:', error);
    }
  }

  async checkMemoryLimits() {
    let cleaned = 0;

    // Enforce chat rooms limit
    if (this.chatRooms.size > this.config.maxChatRooms) {
      cleaned += await this.enforceRoomsLimit();
      this.stats.memoryWarnings++;
    }

    // Enforce support queue limit
    if (this.supportQueue.size > this.config.maxSupportRequests) {
      cleaned += await this.enforceSupportLimit();
      this.stats.memoryWarnings++;
    }

    if (cleaned > 0) {
      console.warn(`Memory limit enforcement cleaned ${cleaned} items`);
    }

    return cleaned;
  }

  async enforceRoomsLimit() {
    const excess = this.chatRooms.size - this.config.maxChatRooms;
    if (excess <= 0) return 0;

    // Convert to array and sort by last activity (oldest first)
    const roomEntries = Array.from(this.chatRooms.entries())
      .sort(([,a], [,b]) => new Date(a.lastActivity) - new Date(b.lastActivity));

    let cleaned = 0;
    for (let i = 0; i < excess && i < roomEntries.length; i++) {
      const [roomId] = roomEntries[i];
      await this.forceCleanupRoom(roomId);
      cleaned++;
    }

    return cleaned;
  }

  async enforceSupportLimit() {
    const excess = this.supportQueue.size - this.config.maxSupportRequests;
    if (excess <= 0) return 0;

    // Sort by creation date (oldest first), prioritizing resolved/closed
    const supportEntries = Array.from(this.supportQueue.entries())
      .sort(([,a], [,b]) => {
        // Prioritize resolved/closed for cleanup
        const aResolved = ['resolved', 'closed'].includes(a.status);
        const bResolved = ['resolved', 'closed'].includes(b.status);
        
        if (aResolved && !bResolved) return -1;
        if (!aResolved && bResolved) return 1;
        
        return new Date(a.createdAt) - new Date(b.createdAt);
      });

    let cleaned = 0;
    for (let i = 0; i < excess && i < supportEntries.length; i++) {
      const [roomId] = supportEntries[i];
      this.supportQueue.delete(roomId);
      cleaned++;
    }

    return cleaned;
  }

  async forceCleanupRoom(roomId) {
    // Notify participants before cleanup
    const roomData = this.chatRooms.get(roomId);
    if (roomData && this.socketService.io) {
      const roomName = `chat_${roomData.type}_${roomId}`;
      this.socketService.io.to(roomName).emit('room_archived', {
        roomId,
        message: 'This chat room has been archived due to inactivity',
        timestamp: new Date()
      });
    }

    this.chatRooms.delete(roomId);
    this.messageHistory.delete(roomId);
    this.userTyping.delete(roomId);
  }

  async cleanupTypingTimeouts() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, timeout] of this.typingTimeouts.entries()) {
      if (now - timeout.startTime > this.config.typingTimeout) {
        clearTimeout(timeout.timeoutId);
        this.typingTimeouts.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  logMemoryStats() {
    const stats = {
      chatRooms: this.chatRooms.size,
      supportQueue: this.supportQueue.size,
      messageHistories: this.messageHistory.size,
      typingUsers: Array.from(this.userTyping.values()).reduce((sum, set) => sum + set.size, 0),
      activeTypingTimeouts: this.typingTimeouts.size,
      totalMessages: Array.from(this.messageHistory.values()).reduce((sum, history) => sum + history.length, 0)
    };

    // Update peak stats
    this.stats.peakConcurrentRooms = Math.max(this.stats.peakConcurrentRooms, stats.chatRooms);

    console.log('Chat service memory stats:', stats);
    return stats;
  }

  async createChatRoom(roomId, type, participants = []) {
    try {
      // Check if we're at capacity
      if (this.chatRooms.size >= this.config.maxChatRooms) {
        await this.checkMemoryLimits();
        
        // If still at capacity after cleanup, reject
        if (this.chatRooms.size >= this.config.maxChatRooms) {
          throw new Error('Maximum chat room capacity reached');
        }
      }

      const roomData = {
        id: roomId,
        type,
        participants: new Set(participants),
        createdAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        maxParticipants: participants.length
      };

      this.chatRooms.set(roomId, roomData);
      this.messageHistory.set(roomId, []);
      this.userTyping.set(roomId, new Set());

      console.log(`Created chat room: ${roomId} (${type})`);
      return roomData;
    } catch (error) {
      console.error('Error creating chat room:', error);
      throw error;
    }
  }

  async joinChatRoom(socket, roomId, type, userId) {
    try {
      let roomData = this.chatRooms.get(roomId);
      
      if (!roomData) {
        roomData = await this.createChatRoom(roomId, type, [userId]);
      } else {
        roomData.participants.add(userId);
        roomData.lastActivity = new Date();
        roomData.maxParticipants = Math.max(roomData.maxParticipants, roomData.participants.size);
      }

      const roomName = `chat_${type}_${roomId}`;
      socket.join(roomName);

      socket.emit('joined_chat', {
        roomId,
        type,
        participants: Array.from(roomData.participants),
        messageCount: roomData.messageCount
      });

      // Send bounded message history
      const history = this.messageHistory.get(roomId) || [];
      if (history.length > 0) {
        socket.emit('chat_history', {
          roomId,
          messages: history.slice(-50)
        });
      }

      console.log(`User ${userId} joined chat room: ${roomId}`);
      return roomData;
    } catch (error) {
      console.error('Error joining chat room:', error);
      throw error;
    }
  }

  async sendMessage(socket, roomId, type, message, userId) {
    try {
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        throw new Error('Invalid message content');
      }

      // Prevent excessively long messages
      const maxMessageLength = 2000;
      if (message.length > maxMessageLength) {
        throw new Error(`Message too long. Maximum ${maxMessageLength} characters allowed.`);
      }

      const roomName = `chat_${type}_${roomId}`;
      const user = await User.findById(userId).select('name role');
      
      if (!user) {
        throw new Error('User not found');
      }

      const messageData = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        roomId,
        type,
        sender: {
          id: userId,
          name: user.name,
          role: user.role
        },
        message: message.trim(),
        timestamp: new Date(),
        read: false
      };

      // Store message with bounded history
      await this.addMessageToHistory(roomId, messageData);

      // Update room activity
      const roomData = this.chatRooms.get(roomId);
      if (roomData) {
        roomData.lastActivity = new Date();
        roomData.messageCount++;
      }

      // Clear typing status for this user
      await this.clearTypingStatus(roomId, type, userId);

      // Broadcast to room
      this.socketService.io.to(roomName).emit('new_message', messageData);

      // Handle special message types
      if (type === 'support') {
        await this.handleSupportMessage(roomId, messageData);
      } else if (type === 'order') {
        await this.handleOrderMessage(roomId, messageData);
      }

      this.stats.totalMessagesProcessed++;
      console.log(`Message sent in room ${roomId} by ${user.name}`);
      return messageData;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async addMessageToHistory(roomId, messageData) {
    let history = this.messageHistory.get(roomId) || [];
    history.push(messageData);
    
    // Enforce message history limit
    if (history.length > this.config.maxMessageHistoryPerRoom) {
      history = history.slice(-this.config.maxMessageHistoryPerRoom);
    }
    
    this.messageHistory.set(roomId, history);
  }

  async handleSupportMessage(roomId, messageData) {
    try {
      this.socketService.io.to('admin_room').emit('support_message', {
        roomId,
        message: messageData,
        timestamp: new Date()
      });

      let request = this.supportQueue.get(roomId);
      if (!request) {
        // Check if we're at support queue capacity
        if (this.supportQueue.size >= this.config.maxSupportRequests) {
          await this.enforceSupportLimit();
        }

        request = {
          roomId,
          createdAt: new Date(),
          lastMessage: messageData,
          status: 'pending',
          priority: 'medium'
        };
        this.supportQueue.set(roomId, request);
      } else {
        request.lastMessage = messageData;
        request.lastActivity = new Date();
        if (request.status === 'resolved') {
          request.status = 'reopened';
        }
      }
    } catch (error) {
      console.error('Error handling support message:', error);
    }
  }

  async handleOrderMessage(roomId, messageData) {
    try {
      const orderId = roomId.replace('order_', '');
      
      this.socketService.io.to('seller_room').emit('order_message', {
        orderId,
        roomId,
        message: messageData,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error handling order message:', error);
    }
  }

  async handleTyping(socket, roomId, type, userId) {
    try {
      const roomName = `chat_${type}_${roomId}`;
      const user = await User.findById(userId).select('name');
      
      if (!user) return;

      const typingUsers = this.userTyping.get(roomId) || new Set();
      
      // Enforce typing users limit per room
      if (typingUsers.size >= this.config.maxTypingUsers) {
        return; // Skip if too many users typing
      }

      typingUsers.add(userId);
      this.userTyping.set(roomId, typingUsers);

      // Set timeout to auto-clear typing status
      const timeoutKey = `${userId}_${roomId}`;
      
      // Clear existing timeout
      const existingTimeout = this.typingTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout.timeoutId);
      }

      // Set new timeout
      const timeoutId = setTimeout(() => {
        this.clearTypingStatus(roomId, type, userId);
      }, this.config.typingTimeout);

      this.typingTimeouts.set(timeoutKey, {
        timeoutId,
        startTime: Date.now(),
        userId,
        roomId
      });

      socket.to(roomName).emit('user_typing', {
        userId,
        userName: user.name,
        roomId
      });
    } catch (error) {
      console.error('Error handling typing:', error);
    }
  }

  async clearTypingStatus(roomId, type, userId) {
    try {
      const typingUsers = this.userTyping.get(roomId);
      if (!typingUsers) return;

      typingUsers.delete(userId);
      
      const timeoutKey = `${userId}_${roomId}`;
      const timeout = this.typingTimeouts.get(timeoutKey);
      if (timeout) {
        clearTimeout(timeout.timeoutId);
        this.typingTimeouts.delete(timeoutKey);
      }

      // Emit stop typing event
      const roomName = `chat_${type}_${roomId}`;
      this.socketService.io.to(roomName).emit('user_stop_typing', {
        userId,
        roomId
      });
    } catch (error) {
      console.error('Error clearing typing status:', error);
    }
  }

  async handleStopTyping(socket, roomId, type, userId) {
    await this.clearTypingStatus(roomId, type, userId);
  }

  async createSupportRequest(userId, issue, priority = 'medium') {
    try {
      const user = await User.findById(userId).select('name email');
      if (!user) {
        throw new Error('User not found');
      }

      // Check support queue capacity
      if (this.supportQueue.size >= this.config.maxSupportRequests) {
        await this.enforceSupportLimit();
        
        if (this.supportQueue.size >= this.config.maxSupportRequests) {
          throw new Error('Support queue is full. Please try again later.');
        }
      }

      const roomId = `support_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const requestData = {
        roomId,
        userId,
        userName: user.name,
        userEmail: user.email,
        issue: issue.substring(0, 1000), // Limit issue length
        priority,
        status: 'pending',
        createdAt: new Date(),
        lastActivity: new Date()
      };

      this.supportQueue.set(roomId, requestData);
      await this.createChatRoom(roomId, 'support', [userId]);

      this.socketService.io.to('admin_room').emit('new_support_request', requestData);

      console.log(`New support request created: ${roomId}`);
      return requestData;
    } catch (error) {
      console.error('Error creating support request:', error);
      throw error;
    }
  }

  async assignSupportAgent(roomId, agentId) {
    try {
      const agent = await User.findById(agentId).select('name role');
      if (!agent || !['admin', 'support'].includes(agent.role)) {
        throw new Error('Invalid support agent');
      }

      const requestData = this.supportQueue.get(roomId);
      if (!requestData) {
        throw new Error('Support request not found');
      }

      requestData.assignedTo = agentId;
      requestData.assignedAt = new Date();
      requestData.status = 'assigned';
      requestData.lastActivity = new Date();

      const roomData = this.chatRooms.get(roomId);
      if (roomData) {
        roomData.participants.add(agentId);
      }

      this.socketService.io.to(`user_${requestData.userId}`).emit('support_assigned', {
        roomId,
        agent: {
          id: agent._id,
          name: agent.name
        }
      });

      this.socketService.io.to(`user_${agentId}`).emit('support_assignment', {
        roomId,
        request: requestData
      });

      console.log(`Support request ${roomId} assigned to ${agent.name}`);
      return requestData;
    } catch (error) {
      console.error('Error assigning support agent:', error);
      throw error;
    }
  }

  // ... (other existing methods remain the same but with bounds checking)

  async leaveChatRoom(socket, roomId, userId) {
    try {
      const roomData = this.chatRooms.get(roomId);
      if (roomData) {
        roomData.participants.delete(userId);
        
        const typingUsers = this.userTyping.get(roomId);
        if (typingUsers) {
          typingUsers.delete(userId);
        }

        // Clear typing timeout
        const timeoutKey = `${userId}_${roomId}`;
        const timeout = this.typingTimeouts.get(timeoutKey);
        if (timeout) {
          clearTimeout(timeout.timeoutId);
          this.typingTimeouts.delete(timeoutKey);
        }

        // Clean up empty rooms immediately
        if (roomData.participants.size === 0) {
          this.chatRooms.delete(roomId);
          this.messageHistory.delete(roomId);
          this.userTyping.delete(roomId);
        }
      }

      console.log(`User ${userId} left chat room: ${roomId}`);
    } catch (error) {
      console.error('Error leaving chat room:', error);
    }
  }

  async cleanupInactiveChats() {
    try {
      const now = new Date();
      let cleanedRooms = 0;

      for (const [roomId, roomData] of this.chatRooms.entries()) {
        const timeSinceLastActivity = now - new Date(roomData.lastActivity);
        
        if (timeSinceLastActivity > this.config.roomInactiveThreshold && roomData.participants.size === 0) {
          await this.forceCleanupRoom(roomId);
          cleanedRooms++;
        }
      }

      if (cleanedRooms > 0) {
        console.log(`Cleaned up ${cleanedRooms} inactive chat rooms`);
      }

      return cleanedRooms;
    } catch (error) {
      console.error('Error cleaning up inactive chats:', error);
      return 0;
    }
  }

  async cleanupSupportQueue() {
    try {
      const now = new Date();
      let cleanedRequests = 0;

      for (const [roomId, requestData] of this.supportQueue.entries()) {
        if (['resolved', 'closed'].includes(requestData.status)) {
          const timeSinceCreation = now - new Date(requestData.createdAt);
          if (timeSinceCreation > this.config.supportResolvedThreshold) {
            this.supportQueue.delete(roomId);
            cleanedRequests++;
          }
        }
      }

      if (cleanedRequests > 0) {
        console.log(`Cleaned up ${cleanedRequests} old support requests`);
      }
      
      return cleanedRequests;
    } catch (error) {
      console.error('Error cleaning up support queue:', error);
      return 0;
    }
  }

  // Enhanced stats method
  async getChatStats() {
    try {
      const memStats = this.logMemoryStats();
      
      return {
        ...memStats,
        config: {
          maxChatRooms: this.config.maxChatRooms,
          maxMessageHistoryPerRoom: this.config.maxMessageHistoryPerRoom,
          maxSupportRequests: this.config.maxSupportRequests,
          roomInactiveThreshold: this.config.roomInactiveThreshold / (1000 * 60 * 60) + ' hours',
          supportResolvedThreshold: this.config.supportResolvedThreshold / (1000 * 60 * 60 * 24) + ' days'
        },
        performance: {
          totalMessagesProcessed: this.stats.totalMessagesProcessed,
          peakConcurrentRooms: this.stats.peakConcurrentRooms,
          cleanupRuns: this.stats.cleanupRuns,
          lastCleanup: this.stats.lastCleanup,
          memoryWarnings: this.stats.memoryWarnings
        },
        capacity: {
          roomsUsage: Math.round((this.chatRooms.size / this.config.maxChatRooms) * 100) + '%',
          supportQueueUsage: Math.round((this.supportQueue.size / this.config.maxSupportRequests) * 100) + '%'
        }
      };
    } catch (error) {
      console.error('Error getting chat stats:', error);
      throw error;
    }
  }

  shutdown() {
    console.log('Shutting down RealtimeChatService...');
    
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    // Clear all typing timeouts
    for (const timeout of this.typingTimeouts.values()) {
      clearTimeout(timeout.timeoutId);
    }
    this.typingTimeouts.clear();

    // Notify all connected users about shutdown
    if (this.socketService.io) {
      for (const [roomId, roomData] of this.chatRooms.entries()) {
        const roomName = `chat_${roomData.type}_${roomId}`;
        this.socketService.io.to(roomName).emit('service_shutdown', {
          message: 'Chat service is shutting down',
          timestamp: new Date()
        });
      }
    }

    console.log('RealtimeChatService shutdown complete');
  }
}

module.exports = RealtimeChatService;