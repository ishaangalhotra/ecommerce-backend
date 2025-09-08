const axios = require('axios');

async function testServer() {
  console.log('🔍 Testing backend server status...\n');
  
  const baseURL = 'https://quicklocal-backend.onrender.com';
  const endpoints = [
    { name: 'Health Check', url: '/health', method: 'GET' },
    { name: 'API Root', url: '/api/v1', method: 'GET' },
    { name: 'Products', url: '/api/v1/products', method: 'GET' },
    { name: 'Auth Login (POST)', url: '/api/v1/auth/login', method: 'POST', data: { identifier: 'demo@quicklocal.shop', password: 'demo123' } }
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint.name}...`);
      
      const config = {
        method: endpoint.method,
        url: baseURL + endpoint.url,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TestScript/1.0'
        }
      };
      
      if (endpoint.data) {
        config.data = endpoint.data;
      }
      
      const response = await axios(config);
      console.log(`✅ ${endpoint.name}: ${response.status} - OK`);
      
      if (endpoint.name === 'Health Check' && response.data) {
        console.log(`   Server Status: ${JSON.stringify(response.data, null, 2)}`);
      }
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ ${endpoint.name}: ${error.response.status} - ${error.response.data?.message || error.response.statusText}`);
        if (error.response.status === 429) {
          console.log('   ⚠️ Rate limiting detected at server level');
        }
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.log(`❌ ${endpoint.name}: Server not reachable (${error.code})`);
      } else {
        console.log(`❌ ${endpoint.name}: ${error.message}`);
      }
    }
    console.log('');
  }
}

testServer().catch(console.error);
