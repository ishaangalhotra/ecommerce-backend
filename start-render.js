#!/usr/bin/env node

// Memory-optimized startup for Render.com (CORRECTED)
process.env.CLUSTER_MODE = 'false';
process.env.MAX_WORKERS = '1';
process.env.DB_POOL_SIZE = '1';

// CORRECTED: Node.js memory optimization (removed invalid flag)
if (!process.env.NODE_OPTIONS) {
  process.env.NODE_OPTIONS = '--max-old-space-size=256 --expose-gc';
}

console.log('🚀 Starting QuickLocal with CORRECTED memory optimizations...');
console.log('Memory limit: 256MB');
console.log('Clustering: Disabled');
console.log('Workers: 1');
console.log('DB Pool: 1 connection');

// Memory monitoring
setInterval(() => {
  const usage = process.memoryUsage();
  const percent = Math.round((usage.heapUsed / usage.heapTotal) * 100);
  
  if (percent > 80) {
    console.warn(`⚠️ High memory: ${percent}% (${Math.round(usage.heapUsed/1024/1024)}MB)`);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
}, 30000);

// Start the main server
require('./server.js');
