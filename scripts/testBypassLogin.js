const axios = require('axios');
require('dotenv').config();

const API_BASE_URL = 'https://quicklocal-backend.onrender.com';

// Test credentials with multiple phone number formats
const testCredentials = [
  { identifier: 'demo@quicklocal.shop', password: 'demo123', description: 'Demo Customer (Email)' },
  { identifier: 'user@quicklocal.shop', password: 'user123', description: 'Test User (Email)' },
  { identifier: 'admin@quicklocal.shop', password: 'admin123', description: 'Admin User (Email)' },
  
  // Phone number in different formats
  { identifier: '+919876543220', password: 'phone123', description: 'Phone User (Full Format +91)' },
  { identifier: '919876543220', password: 'phone123', description: 'Phone User (With 91)' },
  { identifier: '9876543220', password: 'phone123', description: 'Phone User (Without Country Code)' }
];

async function testBypassLogin() {
  console.log('🚀 Testing Bypass Login Route with Phone Support');
  console.log(`🔗 Backend URL: ${API_BASE_URL}/api/v1`);
  console.log('=' .repeat(70));

  let successCount = 0;

  for (const credentials of testCredentials) {
    try {
      console.log(`🧪 Testing: ${credentials.description}`);
      console.log(`   Identifier: ${credentials.identifier}`);
      
      const response = await axios.post(`${API_BASE_URL}/api/v1/bypass/enhanced-login`, {
        identifier: credentials.identifier,
        password: credentials.password,
        remember: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TestBypass/1.0'
        },
        timeout: 15000
      });

      if (response.status === 200) {
        console.log(`✅ Login successful!`);
        console.log(`   - User: ${response.data.user.name}`);
        console.log(`   - Role: ${response.data.user.role}`);
        console.log(`   - Email: ${response.data.user.email || 'N/A'}`);
        console.log(`   - Phone: ${response.data.user.phone || 'N/A'}`);
        console.log(`   - Login Method: ${response.data.loginMethod}`);
        console.log(`   - Token: ${response.data.accessToken ? 'Generated' : 'Missing'}`);
        successCount++;
      } else {
        console.log(`❌ Unexpected status: ${response.status}`);
      }

    } catch (error) {
      if (error.response) {
        console.log(`❌ Login failed:`);
        console.log(`   - Status: ${error.response.status}`);
        console.log(`   - Message: ${error.response.data.message || error.response.data}`);
        
        // Show debug info if available
        if (error.response.data.debug) {
          console.log(`   - Debug: ${JSON.stringify(error.response.data.debug)}`);
        }
      } else if (error.request) {
        console.log(`❌ Network error: ${error.message}`);
      } else {
        console.log(`❌ Error: ${error.message}`);
      }
    }
    
    console.log(''); // Empty line for spacing
  }

  console.log('=' .repeat(70));
  console.log(`📊 Test Results: ${successCount}/${testCredentials.length} successful logins`);
  
  if (successCount >= 4) { // At least email logins should work
    console.log('🎉 Login system is working! You can now use these credentials.');
    console.log('\n📱 Phone Number Support:');
    console.log('   - The system now accepts multiple phone formats');
    console.log('   - +919876543220, 919876543220, or 9876543220 should all work');
    console.log('\n🔧 To use this in your frontend:');
    console.log(`   - Change your login URL to: ${API_BASE_URL}/api/v1/bypass/enhanced-login`);
    console.log('   - This bypasses rate limiting for testing');
  } else {
    console.log('❌ Some tests failed. Check the error messages above.');
  }
}

async function testPhoneValidation() {
  console.log('\n🔍 Testing Phone Number Validation');
  console.log('=' .repeat(50));

  const phoneNumbers = [
    '+919876543220',
    '919876543220', 
    '9876543220',
    '98765 43220',
    '+91 9876543220',
    '91-9876-543220'
  ];

  for (const phone of phoneNumbers) {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/bypass/test-phone-validation`, {
        phone: phone
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      if (response.data.success) {
        console.log(`📱 ${phone} → ${response.data.isValid ? '✅ Valid' : '❌ Invalid'}`);
        console.log(`   Normalized: ${response.data.normalized}`);
      }
    } catch (error) {
      console.log(`📱 ${phone} → ❌ Test failed: ${error.message}`);
    }
  }
}

// Run both tests
async function runAllTests() {
  await testBypassLogin();
  await testPhoneValidation();
  
  console.log('\n💡 Important Notes:');
  console.log('1. The bypass route should only be used for testing/development');
  console.log('2. Remove /bypass routes before going to production');
  console.log('3. Fix the rate limiting configuration for the main /auth/login route');
  console.log('4. Users can now login with phone numbers in multiple formats');
}

if (require.main === module) {
  runAllTests();
}

module.exports = { testBypassLogin, testPhoneValidation };
