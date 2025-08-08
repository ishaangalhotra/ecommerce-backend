#!/usr/bin/env node

const http = require('http');
const https = require('https');

console.log('🏥 QuickLocal Health Check');
console.log('==========================');

async function checkServerHealth() {
  try {
    console.log('\n📡 Checking server health...');
    
    const options = {
      hostname: 'localhost',
      port: 10000,
      path: '/health',
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          console.log('\n📊 Health Status:');
          console.log(`   Overall Status: ${health.status}`);
          console.log(`   Uptime: ${health.uptime}s`);
          console.log(`   Environment: ${health.environment}`);
          console.log(`   Version: ${health.version}`);
          
          console.log('\n🔍 Detailed Checks:');
          
          // Database
          const db = health.checks.database;
          console.log(`   Database: ${db.status} (${db.responseTime}ms)`);
          console.log(`   DB Connection: ${db.connectionState === 1 ? 'Connected' : 'Disconnected'}`);
          
          // Memory
          const memory = health.checks.memory;
          console.log(`   Memory: ${memory.status} (${memory.usage}% used)`);
          console.log(`   Heap Used: ${memory.heapUsed}MB / ${memory.heapTotal}MB`);
          console.log(`   RSS: ${memory.rss}MB`);
          
          // System
          const system = health.checks.system;
          console.log(`   System: ${system.status}`);
          console.log(`   Free Memory: ${system.freeMemory}%`);
          console.log(`   CPU Load: ${system.systemLoad}`);
          
          // Routes
          const routes = health.checks.routes;
          console.log(`   Routes: ${routes.status} (${routes.loaded} loaded, ${routes.failed} failed)`);
          
          // Features
          const features = health.checks.features;
          console.log(`   Features: ${features.status} (${features.healthy}/${features.total} healthy)`);
          
          // Recommendations
          console.log('\n💡 Recommendations:');
          
          if (memory.status === 'critical') {
            console.log('   ⚠️  Memory usage is critical!');
            console.log('   - Consider restarting the server');
            console.log('   - Check for memory leaks in the application');
            console.log('   - Increase server memory if possible');
          }
          
          if (system.status === 'warning') {
            console.log('   ⚠️  System resources are low!');
            console.log('   - Free up system memory');
            console.log('   - Close unnecessary applications');
            console.log('   - Consider upgrading server resources');
          }
          
          if (features.status === 'critical') {
            console.log('   ⚠️  Some features are not working!');
            console.log('   - Check Redis connection');
            console.log('   - Verify WebSocket configuration');
            console.log('   - Review compression and rate limiting settings');
          }
          
          if (health.status === 'healthy') {
            console.log('   ✅ Server is healthy!');
          } else {
            console.log('   ❌ Server has health issues that need attention.');
          }
          
        } catch (error) {
          console.error('❌ Failed to parse health response:', error.message);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Failed to connect to server:', error.message);
      console.log('\n💡 Troubleshooting:');
      console.log('   - Make sure the server is running on port 10000');
      console.log('   - Check if the server started without errors');
      console.log('   - Verify the health endpoint is accessible');
    });

    req.on('timeout', () => {
      console.error('❌ Request timeout - server may be unresponsive');
    });

    req.end();

  } catch (error) {
    console.error('❌ Health check failed:', error.message);
  }
}

async function optimizeMemory() {
  console.log('\n🧠 Memory Optimization Tips:');
  console.log('============================');
  
  console.log('1. Restart the server to clear memory:');
  console.log('   npm run dev');
  
  console.log('\n2. Check for memory leaks:');
  console.log('   - Monitor memory usage over time');
  console.log('   - Look for growing memory patterns');
  console.log('   - Check for unclosed database connections');
  
  console.log('\n3. Optimize database queries:');
  console.log('   - Use proper indexes (already fixed)');
  console.log('   - Limit query results');
  console.log('   - Use projection to select only needed fields');
  
  console.log('\n4. Reduce memory usage:');
  console.log('   - Set NODE_ENV=production for production');
  console.log('   - Use --max-old-space-size flag to limit heap');
  console.log('   - Enable garbage collection logging');
  
  console.log('\n5. Monitor with tools:');
  console.log('   - Use node --inspect for debugging');
  console.log('   - Monitor with PM2 or similar process manager');
  console.log('   - Set up memory monitoring alerts');
}

async function checkEnvironment() {
  console.log('\n🔧 Environment Check:');
  console.log('====================');
  
  const env = process.env.NODE_ENV || 'development';
  console.log(`   Environment: ${env}`);
  
  if (env === 'development') {
    console.log('   ℹ️  Development mode - higher memory usage expected');
    console.log('   💡 Consider using production mode for better performance');
  }
  
  const memoryLimit = process.env.NODE_OPTIONS;
  if (memoryLimit) {
    console.log(`   Memory Limit: ${memoryLimit}`);
  } else {
    console.log('   Memory Limit: Not set (using default)');
  }
}

// Run all checks
async function runHealthCheck() {
  await checkEnvironment();
  await checkServerHealth();
  await optimizeMemory();
  
  console.log('\n🎯 Next Steps:');
  console.log('===============');
  console.log('1. If memory is critical, restart the server');
  console.log('2. Monitor memory usage after restart');
  console.log('3. Consider production optimizations');
  console.log('4. Set up proper monitoring and alerting');
  
  console.log('\n✅ Health check completed!');
}

// Run if called directly
if (require.main === module) {
  runHealthCheck();
}

module.exports = { checkServerHealth, optimizeMemory, checkEnvironment };
