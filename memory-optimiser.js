#!/usr/bin/env node

/**
 * CORRECTED Memory Optimization Script for QuickLocal Backend
 * Fixes memory issues causing 503 errors - CORRECTED VERSION
 */

const fs = require('fs');
const path = require('path');

class MemoryOptimizer {
  constructor() {
    this.fixes = [];
    this.backupDir = path.join(__dirname, '../backups/memory-fix');
  }

  async optimize() {
    console.log('🧠 QuickLocal Memory Optimization (CORRECTED)');
    console.log('=============================================');
    
    try {
      this.ensureBackupDir();
      await this.analyzeCurrentConfig();
      await this.applyOptimizations();
      this.generateReport();
      
      console.log('\n✅ Memory optimization completed!');
      console.log('🔄 Please restart your Render service to apply changes.');
      
    } catch (error) {
      console.error('❌ Optimization failed:', error.message);
    }
  }

  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  async analyzeCurrentConfig() {
    console.log('\n🔍 Analyzing current configuration...');
    
    const serverPath = path.join(__dirname, '../server.js');
    const configPath = path.join(__dirname, '../config/config.js');
    
    // Check if files exist
    if (fs.existsSync(serverPath)) {
      const serverContent = fs.readFileSync(serverPath, 'utf8');
      
      if (serverContent.includes('cluster.isMaster') || serverContent.includes('cluster.isPrimary')) {
        this.fixes.push({
          issue: 'Cluster mode detected in server.js',
          impact: 'High memory usage from multiple worker processes',
          fix: 'Disable clustering for Render deployment'
        });
      }
    }
    
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      
      if (configContent.includes('CLUSTER_MODE') && !configContent.includes('CLUSTER_MODE: false')) {
        this.fixes.push({
          issue: 'Cluster mode not explicitly disabled',
          impact: 'May spawn multiple workers',
          fix: 'Set CLUSTER_MODE=false in environment'
        });
      }
    }
    
    console.log(`📊 Found ${this.fixes.length} potential memory issues`);
  }

  async applyOptimizations() {
    console.log('\n🔧 Applying memory optimizations...');
    
    // 1. Create optimized package.json scripts
    await this.optimizePackageJson();
    
    // 2. Create environment-specific configs
    await this.createRenderConfig();
    
    // 3. Create memory-efficient startup script
    await this.createOptimizedStartup();
    
    // 4. Create Render environment variables file
    await this.createRenderEnvVars();
    
    console.log('✅ Optimizations applied');
  }

  async optimizePackageJson() {
    const packagePath = path.join(__dirname, '../package.json');
    
    if (!fs.existsSync(packagePath)) {
      console.log('⚠️ package.json not found, skipping package optimization');
      return;
    }
    
    const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    // Backup original
    fs.writeFileSync(
      path.join(this.backupDir, 'package.json.backup'),
      JSON.stringify(packageContent, null, 2)
    );
    
    // Add memory-optimized scripts (CORRECTED NODE_OPTIONS)
    packageContent.scripts = {
      ...packageContent.scripts,
      'start:render': 'NODE_ENV=production CLUSTER_MODE=false node server.js',
      'start:optimized': 'NODE_ENV=production node render-optimized.js',
      'memory:check': 'node -e "const m=process.memoryUsage();console.log(`Memory: ${Math.round(m.heapUsed/1024/1024)}MB/${Math.round(m.heapTotal/1024/1024)}MB (${Math.round(m.heapUsed/m.heapTotal*100)}%)`)"'
    };
    
    // CORRECTED: Remove invalid --optimize-for-size flag
    packageContent.scripts['start:memory-optimized'] = 
      'NODE_ENV=production NODE_OPTIONS="--max-old-space-size=256 --expose-gc" CLUSTER_MODE=false node server.js';
    
    fs.writeFileSync(packagePath, JSON.stringify(packageContent, null, 2));
    console.log('📦 Package.json optimized (CORRECTED)');
  }

  async createRenderConfig() {
    const renderConfigPath = path.join(__dirname, '../render.yaml');
    // CORRECTED: Remove invalid --optimize-for-size flag
    const renderConfig = `
# Render.com Configuration - Memory Optimized (CORRECTED)
services:
  - type: web
    name: quicklocal-backend
    env: node
    buildCommand: npm install
    startCommand: npm run start:render
    envVars:
      - key: NODE_ENV
        value: production
      - key: CLUSTER_MODE
        value: false
      - key: MAX_WORKERS
        value: 1
      - key: NODE_OPTIONS
        value: "--max-old-space-size=256 --expose-gc"
      - key: DB_POOL_SIZE
        value: 1
      - key: MEMORY_WARNING_THRESHOLD
        value: 70
      - key: MEMORY_CRITICAL_THRESHOLD
        value: 85
    scaling:
      minInstances: 1
      maxInstances: 1
`;
    
    fs.writeFileSync(renderConfigPath, renderConfig.trim());
    console.log('🌐 Render configuration created (CORRECTED)');
  }

  async createOptimizedStartup() {
    // CORRECTED: Remove invalid --optimize-for-size flag
    const startupScript = `#!/usr/bin/env node

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
    console.warn(\`⚠️ High memory: \${percent}% (\${Math.round(usage.heapUsed/1024/1024)}MB)\`);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
}, 30000);

// Start the main server
require('./server.js');
`;
    
    const startupPath = path.join(__dirname, '../start-render.js');
    fs.writeFileSync(startupPath, startupScript);
    fs.chmodSync(startupPath, '755');
    console.log('🎯 CORRECTED optimized startup script created');
  }

  async createRenderEnvVars() {
    const envVarsPath = path.join(__dirname, '../render-env-vars.txt');
    const envVars = `
# CORRECTED Environment Variables for Render
# Copy these to your Render dashboard environment variables section

NODE_ENV=production
CLUSTER_MODE=false
MAX_WORKERS=1

# CORRECTED: Valid Node.js options only
NODE_OPTIONS=--max-old-space-size=256 --expose-gc

# Database optimization (CRITICAL for memory)
DB_POOL_SIZE=1
DB_CONNECT_TIMEOUT_MS=5000
DB_SOCKET_TIMEOUT_MS=20000

# Memory thresholds
MEMORY_WARNING_THRESHOLD=70
MEMORY_CRITICAL_THRESHOLD=85

# Request limits
MAX_REQUEST_SIZE=1mb
MAX_FILE_SIZE=2097152

# Feature toggles (disable memory-heavy features)
WEBSOCKETS_ENABLED=false
METRICS_ENABLED=false
DETAILED_LOGGING=false

# Session optimization
SESSION_MAX_AGE=1800000
SESSION_CHECK_PERIOD=600000
`;
    
    fs.writeFileSync(envVarsPath, envVars.trim());
    console.log('📝 CORRECTED environment variables file created');
  }

  generateReport() {
    console.log('\n📋 CORRECTED Optimization Report');
    console.log('=================================');
    
    console.log('\n🔧 Applied Fixes:');
    this.fixes.forEach((fix, index) => {
      console.log(`${index + 1}. ${fix.issue}`);
      console.log(`   Impact: ${fix.impact}`);
      console.log(`   Fix: ${fix.fix}\n`);
    });
    
    console.log('📁 Files Created/Modified:');
    console.log('- package.json (added CORRECTED memory-optimized scripts)');
    console.log('- render.yaml (CORRECTED Render deployment config)');
    console.log('- start-render.js (CORRECTED optimized startup script)');
    console.log('- render-env-vars.txt (environment variables to copy)');
    
    console.log('\n🚨 CRITICAL CORRECTION MADE:');
    console.log('- Removed invalid --optimize-for-size flag');
    console.log('- This flag was causing build failures');
    console.log('- Now using only valid Node.js options');
    
    console.log('\n🚀 Next Steps:');
    console.log('1. Copy environment variables from render-env-vars.txt to Render dashboard');
    console.log('2. Update Render start command to: npm run start:render');
    console.log('3. Push changes to your Git repository');
    console.log('4. Restart your Render service');
    
    console.log('\n🎯 Expected Results:');
    console.log('- Build will succeed (no invalid Node.js flags)');
    console.log('- Memory usage should drop from 92% to 40-60%');
    console.log('- API endpoints should become stable');
    console.log('- 503 errors should be resolved');
  }
}

// Memory check utility (CORRECTED)
class MemoryChecker {
  static check() {
    const memUsage = process.memoryUsage();
    const usage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
    
    console.log('📊 Current Memory Usage:');
    console.log(`Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    console.log(`Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
    console.log(`RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
    console.log(`Usage: ${usage}%`);
    
    if (usage > 90) {
      console.log('🚨 CRITICAL: Memory usage too high!');
      return 'critical';
    } else if (usage > 75) {
      console.log('⚠️ WARNING: Memory usage elevated');
      return 'warning';
    } else {
      console.log('✅ Memory usage is healthy');
      return 'healthy';
    }
  }
}

// Run optimization if called directly
if (require.main === module) {
  const optimizer = new MemoryOptimizer();
  optimizer.optimize().catch(console.error);
}

module.exports = { MemoryOptimizer, MemoryChecker };