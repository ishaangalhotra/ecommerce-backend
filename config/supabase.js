// Ensure environment variables are loaded
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

/**
 * Supabase Configuration for Hybrid Architecture
 * Handles authentication, real-time, and analytics
 */

// Supabase client setup
const supabaseUrl = process.env.SUPABASE_URL || 'https://pmvhsjezhuokwygvhhqk.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Enhanced validation with better error messages
if (!supabaseUrl) {
  console.warn('⚠️ SUPABASE_URL not found in environment variables');
}
if (!supabaseKey) {
  console.warn('⚠️ SUPABASE_ANON_KEY not found in environment variables');
}
if (!supabaseServiceKey) {
  console.warn('⚠️ SUPABASE_SERVICE_KEY not found in environment variables, admin functions will be limited');
}

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing required Supabase environment variables:');
  console.error('   SUPABASE_URL:', !!supabaseUrl ? '✓' : '✗');
  console.error('   SUPABASE_ANON_KEY:', !!supabaseKey ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_KEY:', !!supabaseServiceKey ? '✓' : '✗');
  throw new Error('Missing required Supabase environment variables');
}

// Regular client for auth and real-time
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: false, // Server-side doesn't need persistence
  },
  realtime: {
    params: {
      eventsPerSecond: 10, // Rate limit for memory optimization
    }
  }
});

// Admin client for user management
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  }
});

/**
 * Helper functions for hybrid architecture
 */
const SupabaseHelpers = {
  /**
   * Create user in Supabase Auth (for hybrid approach)
   */
  async createAuthUser({ email, password, userData }) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        user_metadata: userData,
        email_confirm: true // Auto-confirm emails in hybrid mode
      });

      if (error) throw error;

      logger.info('User created in Supabase Auth', {
        userId: data.user.id,
        email: data.user.email
      });

      return data.user;
    } catch (error) {
      logger.error('Failed to create Supabase user', error);
      throw error;
    }
  },

  /**
   * Update user in Supabase Auth
   */
  async updateAuthUser(userId, updates) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        updates
      );

      if (error) throw error;
      return data.user;
    } catch (error) {
      logger.error('Failed to update Supabase user', error);
      throw error;
    }
  },

  /**
   * Delete user from Supabase Auth
   */
  async deleteAuthUser(userId) {
    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw error;

      logger.info('User deleted from Supabase Auth', { userId });
      return true;
    } catch (error) {
      logger.error('Failed to delete Supabase user', error);
      throw error;
    }
  },

  /**
   * Verify Supabase JWT token
   */
  async verifySupabaseToken(token) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      
      if (error) throw error;
      return data.user;
    } catch (error) {
      logger.error('Failed to verify Supabase token', error);
      return null;
    }
  },

  /**
   * Sync user between MongoDB and Supabase
   */
  async syncUserToSupabase(mongoUser) {
    try {
      const userData = {
        name: mongoUser.name,
        role: mongoUser.role,
        phone: mongoUser.phone,
        profilePicture: mongoUser.profilePicture,
        walletBalance: mongoUser.walletBalance
      };

      if (mongoUser.supabaseId) {
        // Update existing user
        return await this.updateAuthUser(mongoUser.supabaseId, {
          user_metadata: userData
        });
      } else {
        // Create new user in Supabase
        const supabaseUser = await this.createAuthUser({
          email: mongoUser.email,
          password: require('crypto').randomBytes(32).toString('hex'), // Random password
          userData
        });

        // Update MongoDB with Supabase ID
        mongoUser.supabaseId = supabaseUser.id;
        await mongoUser.save();

        return supabaseUser;
      }
    } catch (error) {
      logger.error('Failed to sync user to Supabase', error);
      throw error;
    }
  },

  /**
   * Log analytics event to Supabase
   */
  async logAnalyticsEvent(eventName, eventData, userId = null) {
    try {
      const { error } = await supabase
        .from('analytics_events')
        .insert({
          event_name: eventName,
          event_data: eventData,
          user_id: userId,
          created_at: new Date().toISOString()
        });

      if (error) throw error;
      return true;
    } catch (error) {
      // Don't fail the main operation if analytics fails
      logger.error('Failed to log analytics event', error);
      return false;
    }
  }
};

module.exports = {
  supabase,
  supabaseAdmin,
  SupabaseHelpers
};
