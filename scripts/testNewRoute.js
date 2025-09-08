const axios = require('axios');
require('dotenv').config();

const API_BASE_URL = process.env.API_URL || 'https://quicklocal-backend.onrender.com';

const testCredentials = [
  { identifier: 'demo@quicklocal.shop', password: 'demo123', description: 'Demo Customer' },
  { identifier: 'user@quicklocal.shop', password: 'user123', description: 'Test User' },
  { identifier: 'admin@quicklocal.shop', password: 'admin123', description: 'Admin User' },
  { identifier: '+919876543220', password: 'phone123', description: 'Phone User' }
];

async function testNewLoginRoute() {
  console.log('🚀 Testing New Login Route (No Rate Limiting)');
  console.log(`🔗 Backend URL: ${API_BASE_URL}/api/v1`);
  console.log('=' .repeat(60));

  let successCount = 0;

  for (const credentials of testCredentials) {
    try {
      console.log(`🧪 Testing: ${credentials.description} (${credentials.identifier})`);
      
      const response = await axios.post(`${API_BASE_URL}/api/v1/test/test-login`, {
        identifier: credentials.identifier,
        password: credentials.password
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TestScript/1.0'
        },
        timeout: 15000
      });

      if (response.status === 200) {
        console.log(`✅ Login successful!`);
        console.log(`   - User: ${response.data.user.name}`);
        console.log(`   - Role: ${response.data.user.role}`);
        console.log(`   - Token: ${response.data.accessToken ? 'Generated' : 'Missing'}`);
        console.log(`   - Message: ${response.data.message}`);
        successCount++;
      } else {
        console.log(`❌ Unexpected status: ${response.status}`);
      }

    } catch (error) {
      if (error.response) {
        console.log(`❌ Login failed:`);
        console.log(`   - Status: ${error.response.status}`);
        console.log(`   - Message: ${error.response.data.message || error.response.data}`);
      } else if (error.request) {
        console.log(`❌ Network error: ${error.message}`);
      } else {
        console.log(`❌ Error: ${error.message}`);
      }
    }
    
    console.log(''); // Empty line for spacing
  }

  console.log('=' .repeat(60));
  console.log(`📊 Test Results: ${successCount}/${testCredentials.length} successful logins`);
  
  if (successCount === testCredentials.length) {
    console.log('🎉 All login tests passed! Your authentication system is working correctly.');
    console.log('💡 Now you can update your frontend to use the correct credentials.');
  } else if (successCount > 0) {
    console.log('⚠️  Some login tests passed. Check the failing credentials.');
  } else {
    console.log('❌ All login tests failed. Check the server logs and database.');
  }

  console.log('\n🔧 Next Steps:');
  console.log('1. If tests pass: Update your frontend login.html to use the working credentials');
  console.log('2. Remove the test route from production once the issue is resolved');
  console.log('3. Fix the rate limiting configuration to prevent future lockouts');
}

// Run the test
if (require.main === module) {
  testNewLoginRoute();
}

module.exports = { testNewLoginRoute };
