#!/usr/bin/env node
// Simple test to identify route loading issues

console.log('🧪 Testing route imports...\n');

const testImport = (moduleName, modulePath) => {
  try {
    console.log(`Testing ${moduleName}...`);
    const module = require(modulePath);
    console.log(`✅ ${moduleName} imported successfully`);
    if (module && typeof module === 'object') {
      console.log(`   Exports: ${Object.keys(module).join(', ')}`);
    }
    return true;
  } catch (error) {
    console.error(`❌ ${moduleName} failed:`, error.message);
    return false;
  }
};

// Test individual route files
console.log('\n=== Testing Route Files ===');
testImport('hybridAuth routes', './routes/hybridAuth');
testImport('users routes', './routes/users');
testImport('products routes', './routes/products');
testImport('main routes index', './routes');

console.log('\n=== Testing Middleware ===');
testImport('hybridAuth middleware', './middleware/hybridAuth');
testImport('authMiddleware (deprecated)', './middleware/authMiddleware');

console.log('\n=== Testing Models ===');
testImport('User model', './models/User');

console.log('\n=== Testing Config ===');
testImport('Supabase config', './config/supabase');

console.log('\n✅ Route testing completed');
