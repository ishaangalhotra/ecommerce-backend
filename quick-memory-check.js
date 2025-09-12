const MemoryDebugger = require('./memory-debug.js');

console.log('🧠 QuickLocal Backend - Quick Memory Analysis');
console.log('=============================================\n');

const memoryDebugger = new MemoryDebugger();

// Perform initial analysis
const report = memoryDebugger.checkForMemoryLeaks();

console.log('\n📊 Memory Analysis Summary:');
console.log('============================');
console.log(`🎯 Heap Usage: ${report.snapshot.memory.heap.used}MB / ${report.snapshot.memory.heap.total}MB (${report.snapshot.usage.heapUsagePercent}%)`);
console.log(`🔗 External Memory: ${report.snapshot.memory.external}MB`);
console.log(`📦 RSS (Resident Set Size): ${report.snapshot.memory.rss}MB`);
console.log(`🖥️  System Memory: ${report.snapshot.usage.systemUsagePercent}% used`);
console.log(`⏱️  Process Uptime: ${report.snapshot.uptime} seconds`);

if (report.alerts.length > 0) {
    console.log('\n🚨 ALERTS:');
    report.alerts.forEach(alert => console.log(`   ${alert}`));
}

if (report.recommendations.length > 0) {
    console.log('\n💡 RECOMMENDATIONS:');
    report.recommendations.forEach(rec => console.log(`   • ${rec}`));
}

// Generate a quick report
const quickReport = memoryDebugger.generateReport();
console.log(`\n📋 Detailed report saved: memory-report-${Date.now()}.json`);

console.log('\n🎯 Next Steps:');
console.log('==============');
console.log('1. 🌐 For Chrome DevTools debugging:');
console.log('   • Stop current server (Ctrl+C in server terminal)');
console.log('   • Run: node --inspect=0.0.0.0:9229 --expose-gc server.js');
console.log('   • Open chrome://inspect in Chrome');

console.log('\n2. 📊 For continuous monitoring:');
console.log('   • Run: node memory-debug.js');

console.log('\n3. 🔍 If memory keeps growing:');
console.log('   • Check database connection pooling');
console.log('   • Review event listeners cleanup');
console.log('   • Monitor large object allocations');

process.exit(0);
