#!/usr/bin/env node
require('dotenv').config();

async function testLogin() {
  try {
    console.log('🧪 Testing Email and Phone Login System');
    console.log('📡 Backend URL:', process.env.API_URL || 'https://quicklocal-backend.onrender.com');
    
    const baseURL = process.env.API_URL || 'https://quicklocal-backend.onrender.com';
    
    // Test cases
    const testCases = [
      {
        name: 'Email Login - Demo User',
        identifier: 'demo@quicklocal.shop',
        password: 'demo123'
      },
      {
        name: 'Email Login - Admin User',
        identifier: 'admin@quicklocal.shop',
        password: 'admin123'
      },
      {
        name: 'Phone Login - Demo User',
        identifier: '+919876543220',
        password: 'phone123'
      },
      {
        name: 'Phone Login - Different Format',
        identifier: '9876543220',
        password: 'phone123'
      }
    ];
    
    for (const testCase of testCases) {
      console.log(`\n🔍 Testing: ${testCase.name}`);
      console.log(`📧 Identifier: ${testCase.identifier}`);
      
      try {
        const response = await fetch(`${baseURL}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            identifier: testCase.identifier,
            password: testCase.password,
            remember: false
          })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          console.log(`✅ SUCCESS: ${testCase.name}`);
          console.log(`👤 User: ${data.user.name} (${data.user.role})`);
          console.log(`🔑 Token: ${data.accessToken ? 'Generated' : 'Missing'}`);
        } else {
          console.log(`❌ FAILED: ${testCase.name}`);
          console.log(`📝 Error: ${data.message}`);
        }
      } catch (error) {
        console.log(`💥 ERROR: ${testCase.name}`);
        console.log(`📝 Details: ${error.message}`);
      }
    }
    
    // Test validation endpoint
    console.log('\n🧪 Testing Validation Endpoint');
    const validationTests = [
      { identifier: 'test@email.com', expected: 'email' },
      { identifier: '+919876543210', expected: 'phone' },
      { identifier: '9876543210', expected: 'phone' },
      { identifier: 'invalid', expected: 'error' }
    ];
    
    for (const test of validationTests) {
      try {
        const response = await fetch(`${baseURL}/api/v1/auth/test-login-validation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ identifier: test.identifier })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          console.log(`✅ ${test.identifier} → ${data.type} (${data.message})`);
        } else {
          console.log(`❌ ${test.identifier} → Validation failed: ${data.message}`);
        }
      } catch (error) {
        console.log(`💥 ${test.identifier} → Error: ${error.message}`);
      }
    }
    
    console.log('\n🎉 Login system testing completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testLogin();
