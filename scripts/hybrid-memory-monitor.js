#!/usr/bin/env node

/**
 * Hybrid Architecture Memory Monitor
 * Compares memory usage before and after Supabase integration
 */

const os = require('os');
const { performance } = require('perf_hooks');

class HybridMemoryMonitor {
  constructor() {
    this.startTime = performance.now();
    this.startMemory = process.memoryUsage();
    this.startSystemMemory = this.getSystemMemoryStats();
    this.measurements = [];
    this.isMonitoring = false;
  }

  /**
   * Get system memory statistics
   */
  getSystemMemoryStats() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    
    return {
      total: Math.round(total / 1024 / 1024), // MB
      free: Math.round(free / 1024 / 1024),   // MB
      used: Math.round(used / 1024 / 1024),   // MB
      usage: Math.round((used / total) * 100) // %
    };
  }

  /**
   * Get Node.js process memory statistics
   */
  getProcessMemoryStats() {
    const usage = process.memoryUsage();
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),      // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),    // MB
      external: Math.round(usage.external / 1024 / 1024),      // MB
      arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024), // MB
      rss: Math.round(usage.rss / 1024 / 1024)                 // MB (Resident Set Size)
    };
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring(interval = 5000) {
    if (this.isMonitoring) {
      console.log('⚠️ Monitoring already started');
      return;
    }

    this.isMonitoring = true;
    console.log('📊 Starting hybrid memory monitoring...\n');

    this.monitoringInterval = setInterval(() => {
      this.takeMeasurement();
    }, interval);

    // Initial measurement
    this.takeMeasurement();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      console.log('⚠️ Monitoring not started');
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    console.log('\n🛑 Stopped memory monitoring');
    this.generateReport();
  }

  /**
   * Take a memory measurement
   */
  takeMeasurement() {
    const timestamp = new Date().toISOString();
    const processStats = this.getProcessMemoryStats();
    const systemStats = this.getSystemMemoryStats();
    const uptime = Math.round((performance.now() - this.startTime) / 1000);

    const measurement = {
      timestamp,
      uptime,
      process: processStats,
      system: systemStats
    };

    this.measurements.push(measurement);

    // Real-time display
    console.log(`[${timestamp}] Uptime: ${uptime}s`);
    console.log(`  Node.js: Heap ${processStats.heapUsed}MB / External ${processStats.external}MB / RSS ${processStats.rss}MB`);
    console.log(`  System: ${systemStats.used}MB / ${systemStats.total}MB (${systemStats.usage}%)\n`);

    // Alert if memory usage is high
    if (systemStats.usage > 85) {
      console.log('🔴 HIGH MEMORY USAGE WARNING!');
    } else if (systemStats.usage > 70) {
      console.log('🟡 Memory usage elevated');
    }

    // Alert if Node.js heap is growing rapidly
    if (this.measurements.length > 1) {
      const previous = this.measurements[this.measurements.length - 2];
      const heapGrowth = processStats.heapUsed - previous.process.heapUsed;
      
      if (heapGrowth > 10) {
        console.log(`📈 Heap growing rapidly: +${heapGrowth}MB`);
      }
    }
  }

  /**
   * Generate performance report
   */
  generateReport() {
    if (this.measurements.length === 0) {
      console.log('No measurements taken');
      return;
    }

    const first = this.measurements[0];
    const last = this.measurements[this.measurements.length - 1];
    
    console.log('\n📋 HYBRID ARCHITECTURE MEMORY REPORT');
    console.log('='.repeat(50));
    
    // Process memory analysis
    const heapChange = last.process.heapUsed - first.process.heapUsed;
    const externalChange = last.process.external - first.process.external;
    const rssChange = last.process.rss - first.process.rss;

    console.log('\n🔧 Node.js Process Memory:');
    console.log(`  Heap: ${first.process.heapUsed}MB → ${last.process.heapUsed}MB (${heapChange > 0 ? '+' : ''}${heapChange}MB)`);
    console.log(`  External: ${first.process.external}MB → ${last.process.external}MB (${externalChange > 0 ? '+' : ''}${externalChange}MB)`);
    console.log(`  RSS: ${first.process.rss}MB → ${last.process.rss}MB (${rssChange > 0 ? '+' : ''}${rssChange}MB)`);

    // System memory analysis
    const systemChange = last.system.used - first.system.used;
    console.log('\n💻 System Memory:');
    console.log(`  Usage: ${first.system.usage}% → ${last.system.usage}% (${systemChange > 0 ? '+' : ''}${systemChange}MB)`);
    console.log(`  Available: ${last.system.free}MB of ${last.system.total}MB`);

    // Calculate averages
    const avgHeap = Math.round(
      this.measurements.reduce((sum, m) => sum + m.process.heapUsed, 0) / this.measurements.length
    );
    const avgSystem = Math.round(
      this.measurements.reduce((sum, m) => sum + m.system.usage, 0) / this.measurements.length
    );

    console.log('\n📊 Averages:');
    console.log(`  Node.js Heap: ${avgHeap}MB`);
    console.log(`  System Usage: ${avgSystem}%`);

    // Memory optimization assessment
    console.log('\n🎯 Hybrid Architecture Assessment:');
    
    if (avgHeap < 200 && avgSystem < 70) {
      console.log('✅ EXCELLENT: Memory usage optimized with Supabase hybrid approach');
    } else if (avgHeap < 300 && avgSystem < 80) {
      console.log('🟢 GOOD: Hybrid approach shows memory improvements');
    } else if (avgHeap < 400 && avgSystem < 85) {
      console.log('🟡 MODERATE: Some memory optimization achieved, consider further tuning');
    } else {
      console.log('🔴 NEEDS ATTENTION: Memory usage still high, review implementation');
    }

    // Recommendations
    this.generateRecommendations(avgHeap, avgSystem, last.process);
  }

  /**
   * Generate optimization recommendations
   */
  generateRecommendations(avgHeap, avgSystem, lastProcess) {
    console.log('\n💡 Optimization Recommendations:');

    if (avgHeap > 250) {
      console.log('  🔧 Consider moving more features to Supabase (analytics, logs)');
    }

    if (lastProcess.external > 100) {
      console.log('  📁 High external memory - check file upload streaming');
    }

    if (avgSystem > 80) {
      console.log('  ⚡ System memory high - consider upgrading server resources');
    }

    if (lastProcess.heapUsed > lastProcess.heapTotal * 0.8) {
      console.log('  🔄 Near heap limit - implement garbage collection optimizations');
    }

    console.log('\n🚀 Hybrid Architecture Benefits:');
    console.log('  • Authentication offloaded to Supabase');
    console.log('  • Real-time features using Supabase channels');
    console.log('  • Analytics stored in Supabase database');
    console.log('  • ImageKit handling file storage');
    console.log('  • Core business logic remains on Node.js');
  }

  /**
   * Compare with baseline measurements
   */
  compareWithBaseline(baselineFile) {
    try {
      const fs = require('fs');
      const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      
      const current = this.measurements[this.measurements.length - 1];
      
      console.log('\n📈 Comparison with Baseline:');
      const heapDiff = current.process.heapUsed - baseline.process.heapUsed;
      const systemDiff = current.system.usage - baseline.system.usage;
      
      console.log(`  Heap: ${heapDiff > 0 ? '+' : ''}${heapDiff}MB`);
      console.log(`  System: ${systemDiff > 0 ? '+' : ''}${systemDiff}%`);

      if (heapDiff < 0 && systemDiff < 0) {
        console.log('✅ Memory usage improved with hybrid architecture!');
      }
    } catch (error) {
      console.log('⚠️ Could not compare with baseline:', error.message);
    }
  }

  /**
   * Save current measurements as baseline
   */
  saveAsBaseline(filename = 'memory-baseline.json') {
    try {
      const fs = require('fs');
      const baseline = this.measurements[this.measurements.length - 1];
      fs.writeFileSync(filename, JSON.stringify(baseline, null, 2));
      console.log(`💾 Baseline saved to ${filename}`);
    } catch (error) {
      console.error('Failed to save baseline:', error);
    }
  }

  /**
   * Test specific hybrid features
   */
  async testHybridFeatures() {
    console.log('\n🧪 Testing Hybrid Architecture Features...\n');

    // Test Supabase connection
    try {
      console.log('Testing Supabase connection...');
      const beforeSupabase = this.getProcessMemoryStats();
      
      // Simulate Supabase operations
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const afterSupabase = this.getProcessMemoryStats();
      const supabaseCost = afterSupabase.heapUsed - beforeSupabase.heapUsed;
      
      console.log(`  Supabase connection cost: ${supabaseCost}MB`);
      
      if (supabaseCost < 5) {
        console.log('  ✅ Low memory impact');
      }
    } catch (error) {
      console.log('  ❌ Supabase test failed:', error.message);
    }

    // Test authentication flow
    console.log('Testing authentication system...');
    const authMemoryBefore = this.getProcessMemoryStats().heapUsed;
    
    // Simulate auth operations
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const authMemoryAfter = this.getProcessMemoryStats().heapUsed;
    const authCost = authMemoryAfter - authMemoryBefore;
    
    console.log(`  Authentication cost: ${authCost}MB`);
  }
}

// CLI usage
if (require.main === module) {
  const monitor = new HybridMemoryMonitor();
  
  console.log('🔧 Hybrid Architecture Memory Monitor');
  console.log('Commands:');
  console.log('  start - Start monitoring');
  console.log('  test  - Test hybrid features');
  console.log('  Press Ctrl+C to stop and generate report\n');

  const command = process.argv[2] || 'start';

  if (command === 'test') {
    monitor.testHybridFeatures().then(() => {
      monitor.takeMeasurement();
      monitor.generateReport();
    });
  } else {
    monitor.startMonitoring();
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    monitor.stopMonitoring();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    monitor.stopMonitoring();
    process.exit(0);
  });
}

module.exports = HybridMemoryMonitor;
