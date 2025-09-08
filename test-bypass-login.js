const axios = require('axios');

async function testBypassLogin() {
  console.log('🧪 Testing bypass login endpoint...\n');
  
  const baseURL = 'https://quicklocal-backend.onrender.com';
  const testCases = [
    {
      name: 'Email Login (demo@quicklocal.shop)',
      data: { identifier: 'demo@quicklocal.shop', password: 'demo123', remember: false }
    },
    {
      name: 'Phone Login (+919876543220)', 
      data: { identifier: '+919876543220', password: 'demo123', remember: false }
    },
    {
      name: 'Phone Login (919876543220)',
      data: { identifier: '919876543220', password: 'demo123', remember: false }
    },
    {
      name: 'Phone Login (9876543220)',
      data: { identifier: '9876543220', password: 'demo123', remember: false }
    }
  ];

  for (const testCase of testCases) {
    try {
      console.log(`Testing ${testCase.name}...`);
      
      const response = await axios.post(
        baseURL + '/api/v1/bypass/enhanced-login',
        testCase.data,
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'BypassTest/1.0'
          },
          timeout: 15000
        }
      );
      
      if (response.status === 200) {
        console.log(`✅ ${testCase.name}: SUCCESS`);
        console.log(`   - User: ${response.data.user.name}`);
        console.log(`   - Role: ${response.data.user.role}`);
        console.log(`   - Method: ${response.data.loginMethod}`);
        console.log(`   - Token received: ${!!response.data.accessToken}`);
        console.log(`   - Message: ${response.data.message}`);
      } else {
        console.log(`❌ ${testCase.name}: Unexpected status ${response.status}`);
      }
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ ${testCase.name}: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
        if (error.response.status === 429) {
          console.log('   ⚠️ Rate limiting still active');
        }
        if (error.response.status === 404) {
          console.log('   ⚠️ Bypass route not available on server');
        }
      } else {
        console.log(`❌ ${testCase.name}: ${error.message}`);
      }
    }
    console.log('');
  }
}

testBypassLogin().catch(console.error);
