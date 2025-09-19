#!/usr/bin/env node

/**
 * Dependency Health Check Script
 * Verifies all required dependencies are installed and compatible
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 QuickLocal Backend - Dependency Health Check\n');

// Read package.json
const packagePath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Critical dependencies that must be available
const criticalDeps = [
  'express',
  'mongoose',
  'dotenv',
  'cors',
  'bcryptjs',
  'jsonwebtoken',
  'helmet',
  'compression',
  'express-rate-limit'
];

// Check Node.js version
console.log('🔧 Environment Check:');
try {
  const nodeVersion = process.version;
  console.log(`✅ Node.js: ${nodeVersion}`);
  
  const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
  console.log(`✅ NPM: v${npmVersion}`);
} catch (error) {
  console.log('❌ Failed to check Node.js/NPM versions');
}

console.log('\n📦 Dependencies Check:');

// Check if node_modules exists
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.log('❌ node_modules folder not found');
  console.log('💡 Run: npm install');
  process.exit(1);
}

// Check critical dependencies
let allGood = true;
criticalDeps.forEach(dep => {
  const depPath = path.join(nodeModulesPath, dep);
  if (fs.existsSync(depPath)) {
    const installedVersion = require(path.join(depPath, 'package.json')).version;
    const requiredVersion = packageJson.dependencies[dep] || packageJson.devDependencies[dep];
    console.log(`✅ ${dep}: v${installedVersion} (required: ${requiredVersion})`);
  } else {
    console.log(`❌ ${dep}: Not installed`);
    allGood = false;
  }
});

// Check environment file
console.log('\n🔐 Environment Check:');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  console.log('✅ .env file found');
  
  // Check critical environment variables
  require('dotenv').config();
  const criticalEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'COOKIE_SECRET',
    'SESSION_SECRET'
  ];
  
  criticalEnvVars.forEach(envVar => {
    if (process.env[envVar]) {
      console.log(`✅ ${envVar}: Set`);
    } else {
      console.log(`❌ ${envVar}: Not set`);
      allGood = false;
    }
  });
} else {
  console.log('❌ .env file not found');
  console.log('💡 Copy .env.example to .env and configure it');
  allGood = false;
}

// Final result
console.log('\n📊 Health Check Summary:');
if (allGood) {
  console.log('✅ All checks passed! Your backend is ready to run.');
  console.log('\n🚀 To start the server run:');
  console.log('   npm start');
  console.log('   or');
  console.log('   node start-optimized.js');
} else {
  console.log('❌ Some issues found. Please fix them before starting the server.');
  console.log('\n🔧 Common fixes:');
  console.log('   npm install              # Install missing dependencies');
  console.log('   cp .env.example .env     # Create environment file');
  console.log('   npm run setup           # Run full setup');
}

process.exit(allGood ? 0 : 1);
