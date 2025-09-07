// Quick Memory Fix for QuickLocal Backend
console.log('🔧 Applying quick memory fixes...');

// Force garbage collection if available
if (global.gc) {
    console.log('♻️ Running garbage collection...');
    global.gc();
    console.log('✅ Garbage collection completed');
} else {
    console.log('⚠️ Garbage collection not available. Restart with --expose-gc flag');
}

// Clear require cache for non-essential modules
const modulesToClear = [];
Object.keys(require.cache).forEach(key => {
    // Only clear non-essential modules
    if (key.includes('node_modules') && 
        !key.includes('express') && 
        !key.includes('mongoose') && 
        !key.includes('cors')) {
        modulesToClear.push(key);
    }
});

modulesToClear.forEach(key => {
    delete require.cache[key];
});

console.log(`🧹 Cleared ${modulesToClear.length} cached modules`);

// Memory usage report
const memUsage = process.memoryUsage();
const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

console.log('\n📊 Current Memory Usage:');
console.log(`Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
console.log(`Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`); 
console.log(`Usage: ${heapUsagePercent.toFixed(1)}%`);
console.log(`RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);

if (heapUsagePercent < 80) {
    console.log('✅ Memory usage is now within safe limits');
} else {
    console.log('⚠️ Memory usage still high - server restart recommended');
}

console.log('\n🚀 Quick fixes applied. Consider restarting the server for best results.');
