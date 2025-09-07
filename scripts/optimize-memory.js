#!/usr/bin/env node

/**
 * QuickLocal Memory Optimization Script
 * Fixes critical memory issues in production
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 QuickLocal Memory Optimization Starting...\n');

// 1. Update package.json with memory-optimized start script
function updatePackageJson() {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const package = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    // Add memory-optimized scripts
    package.scripts = {
        ...package.scripts,
        "start": "node --max-old-space-size=512 --optimize-for-size --gc-interval=100 server.js",
        "start:memory-safe": "node --max-old-space-size=256 --optimize-for-size --gc-interval=50 server.js",
        "start:prod": "NODE_ENV=production node --max-old-space-size=512 --optimize-for-size server.js"
    };
    
    fs.writeFileSync(packagePath, JSON.stringify(package, null, 2));
    console.log('✅ Updated package.json with memory-optimized start scripts');
}

// 2. Create memory monitoring middleware
function createMemoryMiddleware() {
    const middlewarePath = path.join(__dirname, '..', 'middleware', 'memory-monitor.js');
    
    const middlewareContent = `
/**
 * Memory Monitoring Middleware
 * Prevents memory leaks and optimizes performance
 */

const memoryThreshold = {
    warning: 70,  // 70% heap usage warning
    critical: 85, // 85% heap usage critical
    emergency: 90 // 90% emergency cleanup
};

let lastGC = Date.now();
const gcInterval = 30000; // Force GC every 30 seconds if needed

function memoryMonitor(req, res, next) {
    const memUsage = process.memoryUsage();
    const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    // Add memory info to response headers (for debugging)
    res.set('X-Memory-Usage', Math.round(heapUsagePercent) + '%');
    res.set('X-Heap-Used', Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB');
    
    // Emergency memory cleanup
    if (heapUsagePercent > memoryThreshold.emergency) {
        console.warn('🚨 EMERGENCY: Memory usage at', heapUsagePercent.toFixed(1) + '%');
        
        // Force garbage collection
        if (global.gc) {
            global.gc();
            console.log('♻️ Emergency garbage collection triggered');
        }
        
        // Clear require cache for non-core modules (careful!)
        Object.keys(require.cache).forEach(key => {
            if (key.includes('node_modules') && !key.includes('express')) {
                delete require.cache[key];
            }
        });
    }
    
    // Regular GC trigger
    else if (heapUsagePercent > memoryThreshold.critical && Date.now() - lastGC > gcInterval) {
        if (global.gc) {
            global.gc();
            lastGC = Date.now();
            console.log('♻️ Preventive garbage collection at', heapUsagePercent.toFixed(1) + '%');
        }
    }
    
    // Warning logs
    else if (heapUsagePercent > memoryThreshold.warning) {
        console.warn('⚠️ Memory usage high:', heapUsagePercent.toFixed(1) + '%');
    }
    
    next();
}

// Cleanup function for graceful shutdown
function memoryCleanup() {
    console.log('🧹 Performing memory cleanup...');
    
    // Clear all timeouts and intervals
    const highestTimeoutId = setTimeout(() => {}, 0);
    for (let i = 0; i < highestTimeoutId; i++) {
        clearTimeout(i);
        clearInterval(i);
    }
    
    // Force final garbage collection
    if (global.gc) {
        global.gc();
        console.log('✅ Final garbage collection completed');
    }
}

module.exports = {
    memoryMonitor,
    memoryCleanup,
    memoryThreshold
};
`;
    
    fs.writeFileSync(middlewarePath, middlewareContent);
    console.log('✅ Created memory monitoring middleware');
}

// 3. Create optimized server configuration
function createOptimizedConfig() {
    const configPath = path.join(__dirname, '..', 'config', 'memory-config.js');
    
    const configContent = `
/**
 * Memory-Optimized Configuration for QuickLocal
 */

module.exports = {
    // Reduce connection pool sizes
    database: {
        maxPoolSize: 5,        // Reduced from default 10
        minPoolSize: 1,        // Reduced from default 5
        maxIdleTimeMS: 30000,  // Close idle connections faster
        serverSelectionTimeoutMS: 5000
    },
    
    // Optimize Express settings
    express: {
        'trust proxy': 1,
        'view cache': true,
        'x-powered-by': false
    },
    
    // Memory limits for file uploads
    upload: {
        limits: {
            fileSize: 5 * 1024 * 1024,  // 5MB max
            files: 5,                   // Max 5 files
            fieldSize: 1024 * 1024      // 1MB field size
        }
    },
    
    // Cache settings
    cache: {
        maxAge: 300000,        // 5 minutes
        maxSize: 100,          // Max 100 cached items
        checkPeriod: 60000     // Cleanup every minute
    },
    
    // Rate limiting (helps reduce memory pressure)
    rateLimiting: {
        windowMs: 15 * 60 * 1000,  // 15 minutes
        max: 100,                   // Reduced from higher limits
        standardHeaders: true,
        legacyHeaders: false
    }
};
`;
    
    fs.writeFileSync(configPath, configContent);
    console.log('✅ Created optimized configuration');
}

// 4. Create emergency restart script
function createRestartScript() {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'emergency-restart.js');
    
    const scriptContent = `
/**
 * Emergency Server Restart Script
 * Use when memory usage becomes critical
 */

const { execSync } = require('child_process');

console.log('🚨 Emergency restart initiated...');

try {
    // Kill existing processes
    console.log('🔄 Stopping existing processes...');
    
    // For PM2
    try {
        execSync('pm2 restart all', { stdio: 'inherit' });
        console.log('✅ PM2 processes restarted');
    } catch (error) {
        console.log('ℹ️ PM2 not available, trying direct restart');
        
        // For direct node processes
        try {
            execSync('taskkill /f /im node.exe', { stdio: 'inherit' });
            console.log('✅ Node processes terminated');
            
            // Wait a moment
            setTimeout(() => {
                execSync('npm start', { stdio: 'inherit' });
                console.log('✅ Server restarted');
            }, 2000);
        } catch (e) {
            console.log('⚠️ Manual restart required');
        }
    }
    
} catch (error) {
    console.error('❌ Restart failed:', error.message);
    console.log('📋 Manual restart steps:');
    console.log('1. Stop the current server process');
    console.log('2. Run: npm run start:memory-safe');
}
`;
    
    fs.writeFileSync(scriptPath, scriptContent);
    console.log('✅ Created emergency restart script');
}

// 5. Update .env with memory settings
function updateEnvSettings() {
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = '';
    
    try {
        envContent = fs.readFileSync(envPath, 'utf8');
    } catch (error) {
        console.log('⚠️ .env file not found, creating new one');
    }
    
    // Add memory optimization settings
    const memorySettings = `
# Memory Optimization Settings
NODE_OPTIONS=--max-old-space-size=512 --optimize-for-size
UV_THREADPOOL_SIZE=4
NODE_ENV=production

# Reduced limits to save memory
MAX_REQUEST_SIZE=10mb
MAX_UPLOAD_SIZE=5mb
CONNECTION_POOL_SIZE=5
CACHE_MAX_SIZE=100
`;
    
    // Only add if not already present
    if (!envContent.includes('NODE_OPTIONS')) {
        envContent += memorySettings;
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Updated .env with memory optimization settings');
    } else {
        console.log('ℹ️ Memory settings already present in .env');
    }
}

// Run all optimizations
async function runOptimizations() {
    try {
        updatePackageJson();
        createMemoryMiddleware();
        createOptimizedConfig();
        createRestartScript();
        updateEnvSettings();
        
        console.log('\n🎉 Memory optimization complete!');
        console.log('\n📋 Next steps:');
        console.log('1. Restart your server with: npm run start:memory-safe');
        console.log('2. Monitor memory usage in your admin dashboard');
        console.log('3. If issues persist, run: node scripts/emergency-restart.js');
        
    } catch (error) {
        console.error('❌ Optimization failed:', error);
    }
}

runOptimizations();
