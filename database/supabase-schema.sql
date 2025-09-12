-- Supabase Schema for Hybrid Architecture
-- Run this in your Supabase SQL editor to create the required tables

-- Enable Row Level Security by default
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 1. Analytics Events Table (Replaces Winston for some events)
CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_name TEXT NOT NULL,
    event_data JSONB,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_compound ON analytics_events(event_name, user_id, created_at DESC);

-- 2. Order Updates Table (Real-time order tracking)
CREATE TABLE IF NOT EXISTS order_updates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for order updates
CREATE INDEX IF NOT EXISTS idx_order_updates_order_id ON order_updates(order_id);
CREATE INDEX IF NOT EXISTS idx_order_updates_user ON order_updates(user_id);
CREATE INDEX IF NOT EXISTS idx_order_updates_status ON order_updates(status);
CREATE INDEX IF NOT EXISTS idx_order_updates_updated ON order_updates(updated_at DESC);

-- 3. Chat Messages Table (Real-time chat)
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    from_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    to_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    chat_type TEXT DEFAULT 'direct' CHECK (chat_type IN ('direct', 'support', 'group')),
    metadata JSONB,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for chat queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_from_user ON chat_messages(from_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_to_user ON chat_messages(to_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(from_user_id, to_user_id, created_at DESC);

-- 4. Delivery Tracking Table (Real-time delivery updates)
CREATE TABLE IF NOT EXISTS delivery_tracking (
    id TEXT PRIMARY KEY, -- Use external delivery ID
    customer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    delivery_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    order_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled')),
    current_location JSONB, -- {lat, lng, address}
    estimated_delivery TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for delivery tracking
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_customer ON delivery_tracking(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_agent ON delivery_tracking(delivery_agent_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order ON delivery_tracking(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_status ON delivery_tracking(status);

-- 5. User Notifications Table (Push notifications)
CREATE TABLE IF NOT EXISTS user_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('order', 'delivery', 'payment', 'promotion', 'system')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

-- Add indexes for notifications
CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_type ON user_notifications(type);
CREATE INDEX IF NOT EXISTS idx_user_notifications_read ON user_notifications(read);
CREATE INDEX IF NOT EXISTS idx_user_notifications_created ON user_notifications(created_at DESC);

-- 6. System Logs Table (Lightweight logging alternative)
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info', 'debug')),
    message TEXT NOT NULL,
    metadata JSONB,
    source TEXT, -- Which service/controller generated the log
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for system logs
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_source ON system_logs(source);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_user ON system_logs(user_id);

-- 7. User Activity Logs (Track user actions efficiently)
CREATE TABLE IF NOT EXISTS user_activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    resource_type TEXT, -- 'product', 'order', 'user', etc.
    resource_id TEXT,
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for activity logs
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user ON user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_action ON user_activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_resource ON user_activity_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created ON user_activity_logs(created_at DESC);

-- Row Level Security (RLS) Policies

-- Analytics Events - Only authenticated users can read their own events
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own analytics events" ON analytics_events
    FOR SELECT USING (auth.uid() = user_id);

-- Order Updates - Users can only see their own order updates
ALTER TABLE order_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own order updates" ON order_updates
    FOR SELECT USING (auth.uid() = user_id);

-- Chat Messages - Users can see messages they sent or received
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their chat messages" ON chat_messages
    FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

-- Delivery Tracking - Users can see their own deliveries
ALTER TABLE delivery_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their deliveries" ON delivery_tracking
    FOR SELECT USING (auth.uid() = customer_id OR auth.uid() = delivery_agent_id);

-- User Notifications - Users can see their own notifications
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their notifications" ON user_notifications
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their notifications" ON user_notifications
    FOR UPDATE USING (auth.uid() = user_id);

-- System Logs - Only service role can access (no RLS needed for admin table)
-- User Activity Logs - Users can view their own activity
ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own activity" ON user_activity_logs
    FOR SELECT USING (auth.uid() = user_id);

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at columns
CREATE TRIGGER update_order_updates_updated_at 
    BEFORE UPDATE ON order_updates 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_delivery_tracking_updated_at 
    BEFORE UPDATE ON delivery_tracking 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a function to clean up old logs (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
    -- Keep only last 30 days of analytics events
    DELETE FROM analytics_events 
    WHERE created_at < NOW() - INTERVAL '30 days';
    
    -- Keep only last 7 days of system logs (except errors)
    DELETE FROM system_logs 
    WHERE created_at < NOW() - INTERVAL '7 days' 
    AND level != 'error';
    
    -- Keep only last 90 days of user activity logs
    DELETE FROM user_activity_logs 
    WHERE created_at < NOW() - INTERVAL '90 days';
    
    -- Keep only last 30 days of read notifications
    DELETE FROM user_notifications 
    WHERE read = true 
    AND created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Create views for common queries (performance optimization)

-- Recent user activity view
CREATE OR REPLACE VIEW recent_user_activity AS
SELECT 
    ual.user_id,
    ual.action,
    ual.resource_type,
    ual.resource_id,
    ual.created_at,
    au.email as user_email
FROM user_activity_logs ual
JOIN auth.users au ON ual.user_id = au.id
WHERE ual.created_at > NOW() - INTERVAL '24 hours'
ORDER BY ual.created_at DESC;

-- Unread notifications count per user
CREATE OR REPLACE VIEW unread_notifications_count AS
SELECT 
    user_id,
    COUNT(*) as unread_count
FROM user_notifications
WHERE read = false
GROUP BY user_id;

-- Daily analytics summary
CREATE OR REPLACE VIEW daily_analytics_summary AS
SELECT 
    DATE(created_at) as date,
    event_name,
    COUNT(*) as event_count,
    COUNT(DISTINCT user_id) as unique_users
FROM analytics_events
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), event_name
ORDER BY date DESC, event_count DESC;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Comment the tables
COMMENT ON TABLE analytics_events IS 'Stores user and system analytics events for memory-efficient tracking';
COMMENT ON TABLE order_updates IS 'Real-time order status updates for customer notifications';
COMMENT ON TABLE chat_messages IS 'Chat messages between users, customers, and support';
COMMENT ON TABLE delivery_tracking IS 'Real-time delivery location and status tracking';
COMMENT ON TABLE user_notifications IS 'Push notifications and in-app messages for users';
COMMENT ON TABLE system_logs IS 'Lightweight system logging alternative to reduce memory usage';
COMMENT ON TABLE user_activity_logs IS 'Track user actions and behavior for analytics and security';
