const User = require('../models/User');
const Order = require('../models/Order');

class RealtimeChatService {
  constructor(socketService) {
    this.socketService = socketService;
    this.chatRooms = new Map(); // roomId -> room data
    this.userTyping = new Map(); // roomId -> Set of typing users
    this.messageHistory = new Map(); // roomId -> message history
    this.supportQueue = new Map(); // support requests
  }

  async createChatRoom(roomId, type, participants = []) {
    try {
      const roomData = {
        id: roomId,
        type, // 'support', 'order', 'general'
        participants: new Set(participants),
        createdAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0
      };

      this.chatRooms.set(roomId, roomData);
      this.messageHistory.set(roomId, []);
      this.userTyping.set(roomId, new Set());

      console.log(`💬 Created chat room: ${roomId} (${type})`);
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
      }

      const roomName = `chat_${type}_${roomId}`;
      socket.join(roomName);

      // Send room info to user
      socket.emit('joined_chat', {
        roomId,
        type,
        participants: Array.from(roomData.participants),
        messageCount: roomData.messageCount
      });

      // Send recent message history
      const history = this.messageHistory.get(roomId) || [];
      if (history.length > 0) {
        socket.emit('chat_history', {
          roomId,
          messages: history.slice(-50) // Last 50 messages
        });
      }

      console.log(`👤 User ${userId} joined chat room: ${roomId}`);
      return roomData;
    } catch (error) {
      console.error('Error joining chat room:', error);
      throw error;
    }
  }

  async sendMessage(socket, roomId, type, message, userId) {
    try {
      const roomName = `chat_${type}_${roomId}`;
      const user = await User.findById(userId).select('name role');
      
      if (!user) {
        throw new Error('User not found');
      }

      const messageData = {
        id: Date.now().toString(),
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

      // Store message in history
      let history = this.messageHistory.get(roomId) || [];
      history.push(messageData);
      
      // Keep only last 100 messages
      if (history.length > 100) {
        history = history.slice(-100);
      }
      this.messageHistory.set(roomId, history);

      // Update room activity
      const roomData = this.chatRooms.get(roomId);
      if (roomData) {
        roomData.lastActivity = new Date();
        roomData.messageCount++;
      }

      // Broadcast to room
      this.socketService.io.to(roomName).emit('new_message', messageData);

      // Handle special message types
      if (type === 'support') {
        await this.handleSupportMessage(roomId, messageData);
      } else if (type === 'order') {
        await this.handleOrderMessage(roomId, messageData);
      }

      console.log(`💬 Message sent in room ${roomId} by ${user.name}`);
      return messageData;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async handleSupportMessage(roomId, messageData) {
    try {
      // Notify admin team about new support message
      this.socketService.io.to('admin_room').emit('support_message', {
        roomId,
        message: messageData,
        timestamp: new Date()
      });

      // Add to support queue if not already there
      if (!this.supportQueue.has(roomId)) {
        this.supportQueue.set(roomId, {
          roomId,
          createdAt: new Date(),
          lastMessage: messageData,
          status: 'pending'
        });
      }
    } catch (error) {
      console.error('Error handling support message:', error);
    }
  }

  async handleOrderMessage(roomId, messageData) {
    try {
      // Extract order ID from room ID
      const orderId = roomId.replace('order_', '');
      
      // Notify seller about order-specific message
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
      typingUsers.add(userId);
      this.userTyping.set(roomId, typingUsers);

      socket.to(roomName).emit('user_typing', {
        userId,
        userName: user.name,
        roomId
      });
    } catch (error) {
      console.error('Error handling typing:', error);
    }
  }

  async handleStopTyping(socket, roomId, type, userId) {
    try {
      const roomName = `chat_${type}_${roomId}`;
      const user = await User.findById(userId).select('name');
      
      if (!user) return;

      const typingUsers = this.userTyping.get(roomId) || new Set();
      typingUsers.delete(userId);
      this.userTyping.set(roomId, typingUsers);

      socket.to(roomName).emit('user_stop_typing', {
        userId,
        userName: user.name,
        roomId
      });
    } catch (error) {
      console.error('Error handling stop typing:', error);
    }
  }

  async createSupportRequest(userId, issue, priority = 'medium') {
    try {
      const user = await User.findById(userId).select('name email');
      if (!user) {
        throw new Error('User not found');
      }

      const roomId = `support_${Date.now()}`;
      const requestData = {
        roomId,
        userId,
        userName: user.name,
        userEmail: user.email,
        issue,
        priority,
        status: 'pending',
        createdAt: new Date()
      };

      // Add to support queue
      this.supportQueue.set(roomId, requestData);

      // Create chat room
      await this.createChatRoom(roomId, 'support', [userId]);

      // Notify admin team
      this.socketService.io.to('admin_room').emit('new_support_request', requestData);

      console.log(`🆘 New support request created: ${roomId}`);
      return requestData;
    } catch (error) {
      console.error('Error creating support request:', error);
      throw error;
    }
  }

  async assignSupportAgent(roomId, agentId) {
    try {
      const agent = await User.findById(agentId).select('name role');
      if (!agent || agent.role !== 'admin') {
        throw new Error('Invalid support agent');
      }

      const requestData = this.supportQueue.get(roomId);
      if (!requestData) {
        throw new Error('Support request not found');
      }

      requestData.assignedTo = agentId;
      requestData.assignedAt = new Date();
      requestData.status = 'assigned';

      // Add agent to chat room
      const roomData = this.chatRooms.get(roomId);
      if (roomData) {
        roomData.participants.add(agentId);
      }

      // Notify user and agent
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

      console.log(`👨‍💼 Support request ${roomId} assigned to ${agent.name}`);
      return requestData;
    } catch (error) {
      console.error('Error assigning support agent:', error);
      throw error;
    }
  }

  async getSupportQueue() {
    return Array.from(this.supportQueue.values());
  }

  async getChatHistory(roomId, limit = 50) {
    const history = this.messageHistory.get(roomId) || [];
    return history.slice(-limit);
  }

  async getActiveChats(userId) {
    const activeChats = [];
    
    for (const [roomId, roomData] of this.chatRooms) {
      if (roomData.participants.has(userId)) {
        activeChats.push({
          roomId,
          type: roomData.type,
          lastActivity: roomData.lastActivity,
          messageCount: roomData.messageCount,
          participants: Array.from(roomData.participants)
        });
      }
    }

    return activeChats;
  }

  async leaveChatRoom(socket, roomId, userId) {
    try {
      const roomData = this.chatRooms.get(roomId);
      if (roomData) {
        roomData.participants.delete(userId);
        
        // Remove from typing users
        const typingUsers = this.userTyping.get(roomId);
        if (typingUsers) {
          typingUsers.delete(userId);
        }

        // Clean up empty rooms
        if (roomData.participants.size === 0) {
          this.chatRooms.delete(roomId);
          this.messageHistory.delete(roomId);
          this.userTyping.delete(roomId);
        }
      }

      console.log(`👤 User ${userId} left chat room: ${roomId}`);
    } catch (error) {
      console.error('Error leaving chat room:', error);
    }
  }

  async getChatStats() {
    try {
      const stats = {
        totalRooms: this.chatRooms.size,
        activeSupportRequests: this.supportQueue.size,
        totalMessages: 0,
        typingUsers: 0
      };

      // Calculate total messages
      for (const history of this.messageHistory.values()) {
        stats.totalMessages += history.length;
      }

      // Calculate typing users
      for (const typingSet of this.userTyping.values()) {
        stats.typingUsers += typingSet.size;
      }

      return stats;
    } catch (error) {
      console.error('Error getting chat stats:', error);
      throw error;
    }
  }

  async cleanupInactiveChats() {
    try {
      const now = new Date();
      const inactiveThreshold = 24 * 60 * 60 * 1000; // 24 hours
      let cleanedRooms = 0;

      for (const [roomId, roomData] of this.chatRooms) {
        const timeSinceLastActivity = now - roomData.lastActivity;
        
        if (timeSinceLastActivity > inactiveThreshold && roomData.participants.size === 0) {
          this.chatRooms.delete(roomId);
          this.messageHistory.delete(roomId);
          this.userTyping.delete(roomId);
          cleanedRooms++;
        }
      }

      if (cleanedRooms > 0) {
        console.log(`🧹 Cleaned up ${cleanedRooms} inactive chat rooms`);
      }

      return cleanedRooms;
    } catch (error) {
      console.error('Error cleaning up inactive chats:', error);
      throw error;
    }
  }
}

module.exports = RealtimeChatService;
