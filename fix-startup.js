#!/usr/bin/env node
/**
 * QuickLocal Backend Startup Fix Script
 * Fixes common issues and ensures proper initialization
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Starting QuickLocal Backend Fix Script...\n');

// Fix 1: Create missing directories
const requiredDirs = ['logs', 'uploads', 'temp', 'public'];
requiredDirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  }
});

// Fix 2: Check environment variables
const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'COOKIE_SECRET',
  'SESSION_SECRET'
];

let envIssues = [];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    envIssues.push(varName);
  }
});

if (envIssues.length > 0) {
  console.log(`⚠️  Missing environment variables: ${envIssues.join(', ')}`);
  console.log('   Please check your .env file\n');
} else {
  console.log('✅ All required environment variables present\n');
}

// Fix 3: Check route files
const routeFiles = [
  'routes/index.js',
  'routes/hybridAuth.js',
  'routes/products.js',
  'routes/users.js',
  'routes/orders.js'
];

let missingRoutes = [];
routeFiles.forEach(file => {
  if (!fs.existsSync(path.join(__dirname, file))) {
    missingRoutes.push(file);
  }
});

if (missingRoutes.length > 0) {
  console.log(`❌ Missing route files: ${missingRoutes.join(', ')}`);
} else {
  console.log('✅ All essential route files present');
}

// Fix 4: Check model files
const modelFiles = [
  'models/User.js',
  'models/Product.js',
  'models/Order.js'
];

let missingModels = [];
modelFiles.forEach(file => {
  if (!fs.existsSync(path.join(__dirname, file))) {
    missingModels.push(file);
  }
});

if (missingModels.length > 0) {
  console.log(`❌ Missing model files: ${missingModels.join(', ')}`);
} else {
  console.log('✅ All essential model files present');
}

// Fix 5: Check package.json and node_modules
if (!fs.existsSync(path.join(__dirname, 'package.json'))) {
  console.log('❌ package.json not found!');
} else if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
  console.log('⚠️  node_modules not found. Run: npm install');
} else {
  console.log('✅ Package files present');
}

// Fix 6: Memory optimization check
const nodeOptions = process.env.NODE_OPTIONS;
if (!nodeOptions || !nodeOptions.includes('--max-old-space-size')) {
  console.log('⚠️  Consider setting NODE_OPTIONS for memory optimization');
  console.log('   Example: NODE_OPTIONS="--max-old-space-size=450 --optimize-for-size"');
}

// Fix 7: Create a simple health check endpoint test
const testHealthCheck = async () => {
  try {
    const port = process.env.PORT || 10000;
    const response = await fetch(`http://localhost:${port}/health`);
    if (response.ok) {
      console.log('✅ Health check endpoint responding');
    } else {
      console.log('⚠️  Health check endpoint not responding properly');
    }
  } catch (error) {
    console.log('⚠️  Server not running or health check failed');
  }
};

console.log('\n🏁 Fix script completed!');
console.log('\n📋 Next Steps:');
console.log('1. Fix any missing files or environment variables');
console.log('2. Run: npm install (if needed)');
console.log('3. Run: npm start');
console.log('4. Test your API endpoints');

// Export for programmatic use
module.exports = {
  checkDirectories: () => requiredDirs.every(dir => fs.existsSync(path.join(__dirname, dir))),
  checkEnvVars: () => requiredEnvVars.every(varName => process.env[varName]),
  checkRoutes: () => routeFiles.every(file => fs.existsSync(path.join(__dirname, file))),
  missingRoutes,
  missingModels,
  envIssues
};
