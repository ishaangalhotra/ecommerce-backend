const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const { connectDB } = require('../config/database');
const axios = require('axios');

// Test login directly without rate limits
async function testDirectLogin() {
  try {
    console.log('🚀 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB');

    console.log('🧹 Clearing account lockouts...');

    // Clear all lockouts from demo users
    const demoEmails = ['demo@quicklocal.shop', 'user@quicklocal.shop', 'admin@quicklocal.shop'];
    const demoPhone = '+919876543220';

    for (const email of demoEmails) {
      const user = await User.findOne({ email }).select('+loginAttempts +lockUntil');
      if (user) {
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();
        console.log(`   ✅ Cleared lockout for ${email}`);
      }
    }

    // Clear phone user lockout
    const phoneUser = await User.findOne({ phone: demoPhone }).select('+loginAttempts +lockUntil');
    if (phoneUser) {
      phoneUser.loginAttempts = 0;
      phoneUser.lockUntil = undefined;
      await phoneUser.save();
      console.log(`   ✅ Cleared lockout for ${demoPhone}`);
    }

    console.log('🧪 Testing login with fresh state...');

    // Test login with demo user
    const testCredentials = {
      identifier: 'demo@quicklocal.shop',
      password: 'demo123',
      remember: false
    };

    try {
      const response = await axios.post('https://quicklocal-backend.onrender.com/api/v1/auth/login', testCredentials, {
        headers: {
          'Content-Type': 'application/json',
          // Add bypass header to skip rate limiting if possible
          'X-Rate-Limit-Bypass': process.env.RATE_LIMIT_BYPASS_SECRET || 'test',
          'User-Agent': 'Testing/1.0'
        },
        timeout: 15000
      });

      if (response.status === 200) {
        console.log('✅ Login test SUCCESSFUL!');
        console.log(`   - User: ${response.data.user.name}`);
        console.log(`   - Role: ${response.data.user.role}`);
        console.log(`   - Token received: ${response.data.accessToken ? 'Yes' : 'No'}`);
        console.log('\n🎉 Your login system is working!');
      } else {
        console.log('❌ Login test failed with status:', response.status);
      }
    } catch (loginError) {
      if (loginError.response) {
        console.log('❌ Login test failed:');
        console.log(`   - Status: ${loginError.response.status}`);
        console.log(`   - Message: ${loginError.response.data.message || loginError.response.data}`);
        
        // Check if it's a rate limiting issue
        if (loginError.response.status === 429) {
          console.log('\n⚠️  Rate limiting is still active. The issue is with the rate limiter configuration.');
          console.log('   This suggests the backend rate limiter needs to be temporarily disabled for testing.');
        } else if (loginError.response.status === 401) {
          console.log('\n⚠️  Authentication failed. This could be a password hash issue.');
        }
      } else {
        console.log('❌ Network/Request error:', loginError.message);
      }
    }

  } catch (error) {
    console.error('💥 Script failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('📞 Database connection closed');
  }
}

// Run the test
if (require.main === module) {
  testDirectLogin();
}

module.exports = { testDirectLogin };
