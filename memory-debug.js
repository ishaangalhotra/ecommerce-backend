const fs = require('fs');
const path = require('path');
const os = require('os');

class MemoryDebugger {
    constructor() {
        this.startTime = Date.now();
        this.memoryLog = [];
        this.heapSnapshots = [];
        this.logFile = path.join(__dirname, 'memory-debug.log');
        
        // Clear previous log
        if (fs.existsSync(this.logFile)) {
            fs.unlinkSync(this.logFile);
        }
        
        console.log('🧠 Memory Debugger initialized');
        this.logSystemInfo();
    }

    logSystemInfo() {
        const systemInfo = {
            timestamp: new Date().toISOString(),
            platform: os.platform(),
            arch: os.arch(),
            totalMemory: Math.round(os.totalmem() / 1024 / 1024),
            freeMemory: Math.round(os.freemem() / 1024 / 1024),
            nodeVersion: process.version,
            pid: process.pid
        };

        console.log('💻 System Info:', systemInfo);
        this.writeToLog('SYSTEM_INFO', systemInfo);
    }

    captureMemorySnapshot() {
        const memUsage = process.memoryUsage();
        const systemMem = {
            total: Math.round(os.totalmem() / 1024 / 1024),
            free: Math.round(os.freemem() / 1024 / 1024),
            used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024)
        };

        const snapshot = {
            timestamp: new Date().toISOString(),
            uptime: Math.round((Date.now() - this.startTime) / 1000),
            memory: {
                heap: {
                    used: Math.round(memUsage.heapUsed / 1024 / 1024),
                    total: Math.round(memUsage.heapTotal / 1024 / 1024)
                },
                external: Math.round(memUsage.external / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024),
                arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024)
            },
            system: systemMem,
            usage: {
                heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
                systemUsagePercent: Math.round((systemMem.used / systemMem.total) * 100)
            }
        };

        this.memoryLog.push(snapshot);
        return snapshot;
    }

    analyzeMemoryTrend() {
        if (this.memoryLog.length < 2) return null;

        const recent = this.memoryLog.slice(-5);
        const first = recent[0];
        const last = recent[recent.length - 1];

        const heapGrowth = last.memory.heap.used - first.memory.heap.used;
        const externalGrowth = last.memory.external - first.memory.external;
        const rssGrowth = last.memory.rss - first.memory.rss;

        return {
            timespan: last.uptime - first.uptime,
            growth: {
                heap: heapGrowth,
                external: externalGrowth,
                rss: rssGrowth
            },
            trend: {
                heap: heapGrowth > 5 ? 'INCREASING' : heapGrowth < -5 ? 'DECREASING' : 'STABLE',
                external: externalGrowth > 2 ? 'INCREASING' : externalGrowth < -2 ? 'DECREASING' : 'STABLE',
                rss: rssGrowth > 10 ? 'INCREASING' : rssGrowth < -10 ? 'DECREASING' : 'STABLE'
            }
        };
    }

    checkForMemoryLeaks() {
        const snapshot = this.captureMemorySnapshot();
        const trend = this.analyzeMemoryTrend();

        // Memory leak indicators
        const alerts = [];

        if (snapshot.memory.heap.used > 200) {
            alerts.push(`🚨 HIGH HEAP USAGE: ${snapshot.memory.heap.used}MB`);
        }

        if (snapshot.memory.external > 50) {
            alerts.push(`🚨 HIGH EXTERNAL MEMORY: ${snapshot.memory.external}MB`);
        }

        if (snapshot.usage.systemUsagePercent > 85) {
            alerts.push(`🚨 HIGH SYSTEM MEMORY: ${snapshot.usage.systemUsagePercent}%`);
        }

        if (trend && trend.growth.heap > 20) {
            alerts.push(`📈 HEAP GROWING RAPIDLY: +${trend.growth.heap}MB`);
        }

        if (trend && trend.growth.external > 10) {
            alerts.push(`📈 EXTERNAL MEMORY GROWING: +${trend.growth.external}MB`);
        }

        const logEntry = {
            timestamp: snapshot.timestamp,
            snapshot,
            trend,
            alerts,
            recommendations: this.getRecommendations(snapshot, alerts)
        };

        if (alerts.length > 0) {
            console.log('\n🚨 MEMORY ALERTS:');
            alerts.forEach(alert => console.log(`   ${alert}`));
        }

        console.log(`💾 Memory Status: Heap ${snapshot.memory.heap.used}MB/${snapshot.memory.heap.total}MB, External ${snapshot.memory.external}MB, RSS ${snapshot.memory.rss}MB`);

        this.writeToLog('MEMORY_CHECK', logEntry);
        return logEntry;
    }

    getRecommendations(snapshot, alerts) {
        const recommendations = [];

        if (snapshot.memory.heap.used > 200) {
            recommendations.push('Consider implementing object pooling and memory optimization');
            recommendations.push('Review for memory leaks in event listeners and timers');
        }

        if (snapshot.memory.external > 50) {
            recommendations.push('Check for large buffer allocations and file operations');
            recommendations.push('Review database connection pooling and caching strategies');
        }

        if (alerts.some(alert => alert.includes('GROWING'))) {
            recommendations.push('Implement garbage collection monitoring');
            recommendations.push('Review for circular references and unclosed resources');
        }

        return recommendations;
    }

    forceGarbageCollection() {
        if (global.gc) {
            console.log('🗑️ Forcing garbage collection...');
            const before = process.memoryUsage();
            global.gc();
            const after = process.memoryUsage();
            
            const freed = {
                heap: Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024),
                external: Math.round((before.external - after.external) / 1024 / 1024),
                rss: Math.round((before.rss - after.rss) / 1024 / 1024)
            };

            console.log(`✅ GC Complete - Freed: Heap ${freed.heap}MB, External ${freed.external}MB, RSS ${freed.rss}MB`);
            return freed;
        } else {
            console.log('⚠️ Garbage collection not available. Start Node with --expose-gc flag');
            return null;
        }
    }

    generateReport() {
        const report = {
            generatedAt: new Date().toISOString(),
            uptime: Math.round((Date.now() - this.startTime) / 1000),
            totalSnapshots: this.memoryLog.length,
            currentSnapshot: this.captureMemorySnapshot(),
            trend: this.analyzeMemoryTrend(),
            summary: this.generateSummary()
        };

        const reportFile = path.join(__dirname, `memory-report-${Date.now()}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        
        console.log(`📊 Memory report generated: ${reportFile}`);
        return report;
    }

    generateSummary() {
        if (this.memoryLog.length === 0) return null;

        const snapshots = this.memoryLog;
        const heapUsages = snapshots.map(s => s.memory.heap.used);
        const externalUsages = snapshots.map(s => s.memory.external);

        return {
            heap: {
                min: Math.min(...heapUsages),
                max: Math.max(...heapUsages),
                avg: Math.round(heapUsages.reduce((a, b) => a + b, 0) / heapUsages.length)
            },
            external: {
                min: Math.min(...externalUsages),
                max: Math.max(...externalUsages),
                avg: Math.round(externalUsages.reduce((a, b) => a + b, 0) / externalUsages.length)
            }
        };
    }

    writeToLog(type, data) {
        const logEntry = `[${new Date().toISOString()}] ${type}: ${JSON.stringify(data)}\n`;
        fs.appendFileSync(this.logFile, logEntry);
    }

    startContinuousMonitoring(intervalMs = 30000) {
        console.log(`🔄 Starting continuous monitoring (${intervalMs/1000}s intervals)`);
        
        const interval = setInterval(() => {
            this.checkForMemoryLeaks();
        }, intervalMs);

        // Cleanup on exit
        process.on('SIGINT', () => {
            console.log('\n🛑 Stopping memory monitoring...');
            clearInterval(interval);
            this.generateReport();
            process.exit(0);
        });

        return interval;
    }
}

// Export for use in other modules
module.exports = MemoryDebugger;

// If run directly, start monitoring
if (require.main === module) {
    const memoryDebugger = new MemoryDebugger();
    
    // Initial check
    memoryDebugger.checkForMemoryLeaks();
    
    // Start continuous monitoring
    memoryDebugger.startContinuousMonitoring(30000); // Every 30 seconds
    
    // Manual checks every 5 minutes
    setInterval(() => {
        console.log('\n📋 === DETAILED MEMORY ANALYSIS ===');
        const report = memoryDebugger.generateReport();
        
        if (report.currentSnapshot.usage.systemUsagePercent > 85) {
            console.log('🚨 CRITICAL: High memory usage detected!');
            memoryDebugger.forceGarbageCollection();
        }
    }, 300000); // Every 5 minutes
}
