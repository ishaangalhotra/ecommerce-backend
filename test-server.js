// Simple server test
require('dotenv').config();

console.log('Testing server startup...');

try {
  // Test basic imports
  const express = require('express');
  const mongoose = require('mongoose');
  
  console.log('✅ Basic imports successful');
  
  // Test server creation
  const { QuickLocalServer } = require('./server.js');
  console.log('✅ Server class imported successfully');
  
  // Test configuration
  const { QuickLocalConfig } = require('./server.js');
  const config = new QuickLocalConfig();
  console.log('✅ Configuration loaded successfully');
  
  console.log('✅ All tests passed - server should start successfully');
  
} catch (error) {
  console.error('❌ Test failed:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}
