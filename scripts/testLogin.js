const axios = require('axios');
require('dotenv').config();

const API_BASE_URL = process.env.API_URL || 'https://quicklocal-backend.onrender.com';

const testCredentials = [
  { identifier: 'demo@quicklocal.shop', password: 'demo123', description: 'Demo Customer' },
  { identifier: 'user@quicklocal.shop', password: 'user123', description: 'Test User' },
  { identifier: 'admin@quicklocal.shop', password: 'admin123', description: 'Admin User' },
  { identifier: '+919876543220', password: 'phone123', description: 'Phone User' }
];

async function testLogin(credentials) {
  try {
    console.log(`🧪 Testing login for: ${credentials.description} (${credentials.identifier})`);
    
    const response = await axios.post(`${API_BASE_URL}/api/v1/auth/login`, {
      identifier: credentials.identifier,
      password: credentials.password,
      remember: false
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.status === 200) {
      console.log(`✅ Login successful for ${credentials.description}`);
      console.log(`   - User: ${response.data.user.name}`);
      console.log(`   - Role: ${response.data.user.role}`);
      console.log(`   - Token: ${response.data.accessToken ? 'Generated' : 'Missing'}`);
      return true;
    } else {
      console.log(`❌ Login failed for ${credentials.description} - Status: ${response.status}`);
      return false;
    }
  } catch (error) {
    if (error.response) {
      console.log(`❌ Login failed for ${credentials.description}:`);
      console.log(`   - Status: ${error.response.status}`);
      console.log(`   - Message: ${error.response.data.message || error.response.data}`);
    } else if (error.request) {
      console.log(`❌ Network error for ${credentials.description}:`);
      console.log(`   - Error: ${error.message}`);
    } else {
      console.log(`❌ Error for ${credentials.description}: ${error.message}`);
    }
    return false;
  }
}

async function testAllLogins() {
  console.log('🚀 QuickLocal Login API Test');
  console.log(`🔗 Backend URL: ${API_BASE_URL}/api/v1`);
  console.log('=' .repeat(50));

  let successCount = 0;

  for (const credentials of testCredentials) {
    const success = await testLogin(credentials);
    if (success) successCount++;
    console.log(''); // Empty line for spacing
  }

  console.log('=' .repeat(50));
  console.log(`📊 Test Results: ${successCount}/${testCredentials.length} successful logins`);
  
  if (successCount === testCredentials.length) {
    console.log('🎉 All login tests passed! Your authentication system is working correctly.');
  } else {
    console.log('⚠️  Some login tests failed. Check the error messages above.');
  }
}

// Run the test
if (require.main === module) {
  testAllLogins();
}

module.exports = { testLogin, testAllLogins };
