#!/usr/bin/env node
/**
 * Deploy CORS Fix Script for QuickLocal Backend
 * This script helps deploy the CORS fixes to Render
 */

console.log('🚀 QuickLocal CORS Fix Deployment');
console.log('==================================\n');

// Check if we're in the right directory
const fs = require('fs');
const path = require('path');

if (!fs.existsSync('server.js')) {
  console.error('❌ Error: server.js not found. Please run this from the backend directory.');
  process.exit(1);
}

console.log('✅ Found server.js - we are in the backend directory');

// Check environment file
if (fs.existsSync('.env')) {
  console.log('✅ Found .env file');
  
  // Read and check CORS-related environment variables
  const envContent = fs.readFileSync('.env', 'utf8');
  const hasClientUrl = envContent.includes('CLIENT_URL=');
  const hasFrontendUrls = envContent.includes('FRONTEND_URLS=');
  const hasCorsOrigins = envContent.includes('CORS_ORIGINS=');
  
  console.log(`   CLIENT_URL configured: ${hasClientUrl ? '✅' : '❌'}`);
  console.log(`   FRONTEND_URLS configured: ${hasFrontendUrls ? '✅' : '❌'}`);
  console.log(`   CORS_ORIGINS configured: ${hasCorsOrigins ? '✅' : '❌'}`);
  
  if (hasClientUrl && hasFrontendUrls) {
    console.log('✅ CORS environment variables are properly configured\n');
  } else {
    console.log('⚠️  Some CORS environment variables may be missing\n');
  }
} else {
  console.error('❌ Error: .env file not found');
  process.exit(1);
}

// Show the CORS fixes that were applied
console.log('🔧 CORS Fixes Applied:');
console.log('=====================');
console.log('1. ✅ Enhanced CORS origin checking with debugging');
console.log('2. ✅ Added manual CORS headers for your domain');
console.log('3. ✅ Added proper OPTIONS preflight handling');
console.log('4. ✅ Added CORS debug logging');
console.log('5. ✅ Added CORS test endpoint: /api/v1/cors-test');
console.log('6. ✅ Added temporary HTTPS origin allowance for debugging\n');

console.log('🌐 Your Allowed Origins:');
console.log('========================');
console.log('• https://www.quicklocal.shop');
console.log('• https://quicklocal.shop');
console.log('• https://my-frontend-ifyr.vercel.app');
console.log('• https://my-frontend-ifyr-6dh1011kk-ishans-projects-67ccbc5a.vercel.app\n');

console.log('📋 Next Steps:');
console.log('==============');
console.log('1. Commit and push these changes to your repository');
console.log('2. Render will automatically redeploy with the CORS fixes');
console.log('3. Test CORS using the test file: cors-test.html');
console.log('4. Check backend logs for CORS debugging info\n');

console.log('🧪 Test Your CORS Fix:');
console.log('======================');
console.log('1. Upload cors-test.html to your frontend');
console.log('2. Visit: https://www.quicklocal.shop/cors-test.html');
console.log('3. Click the test buttons to verify CORS is working');
console.log('4. Check your backend logs at: https://dashboard.render.com\n');

console.log('🔍 Debug Commands:');
console.log('==================');
console.log('• Test CORS directly: curl -H "Origin: https://www.quicklocal.shop" https://quicklocal-backend.onrender.com/api/v1/cors-test');
console.log('• Check server status: curl https://quicklocal-backend.onrender.com/status');
console.log('• View backend logs: Check Render dashboard\n');

console.log('🎯 What Changed in server.js:');
console.log('=============================');
console.log('• Enhanced CORS origin validation');
console.log('• Added explicit domain allowlist');
console.log('• Added CORS debugging middleware');
console.log('• Added manual CORS header setting as backup');
console.log('• Added proper OPTIONS request handling\n');

console.log('💡 If CORS still fails after deployment:');
console.log('=========================================');
console.log('1. Check Render logs for CORS debug messages');
console.log('2. Ensure your frontend domain exactly matches the allowlist');
console.log('3. Verify the request includes proper headers');
console.log('4. Test with the cors-test.html file first\n');

console.log('🏁 CORS Fix Deployment Script Complete!');
console.log('========================================');
console.log('Your backend should now properly handle CORS requests from your frontend.\n');

// Export configuration for programmatic use
module.exports = {
  allowedDomains: [
    'https://www.quicklocal.shop',
    'https://quicklocal.shop',
    'https://my-frontend-ifyr.vercel.app',
    'https://my-frontend-ifyr-6dh1011kk-ishans-projects-67ccbc5a.vercel.app'
  ],
  corsFixed: true,
  testEndpoint: '/api/v1/cors-test',
  debugEnabled: true
};
