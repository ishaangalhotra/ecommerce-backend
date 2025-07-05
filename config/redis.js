// In your main application file (e.g., server.js)
const { createClient } = require('redis');

// Modern Redis connection (v4+)
const redisClient = createClient({
  url: 'redis://127.0.0.1:6379', // Explicit URL format
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 5000) // Exponential backoff
  }
});

// Error handling
redisClient.on('error', (err) => console.log('Redis Client Error:', err));

// Connect (wrap in async function if needed)
(async () => {
  try {
    await redisClient.connect();
    console.log('✅ Redis connected successfully!');
    
    // Test connection
    await redisClient.set('test_key', 'Hello Redis!');
    const value = await redisClient.get('test_key');
    console.log('Test value:', value); // Should log "Hello Redis!"
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err);
    process.exit(1); // Optional: Crash app if Redis is critical
  }
})();

// Export for use in other files
module.exports = redisClient;