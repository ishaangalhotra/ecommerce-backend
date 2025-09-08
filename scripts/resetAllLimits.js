const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const User = require('../models/User');
const { connectDB } = require('../config/database');

async function resetAllLimits() {
  try {
    console.log('🚀 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB');

    console.log('🧹 Resetting ALL user account locks and login attempts...');
    
    // Reset ALL users, not just demo users
    const result = await User.updateMany(
      {}, // All users
      {
        $unset: {
          lockUntil: 1
        },
        $set: {
          loginAttempts: 0
        }
      }
    );

    console.log(`✅ Reset limits for ${result.modifiedCount} users`);

    // Also specifically check and fix our demo users
    const demoUsers = [
      'demo@quicklocal.shop',
      'user@quicklocal.shop', 
      'admin@quicklocal.shop'
    ];

    const demoPhone = '+919876543220';

    console.log('🔧 Specifically checking demo users...');
    
    for (const email of demoUsers) {
      const user = await User.findOne({ email }).select('+loginAttempts +lockUntil +password');
      if (user) {
        console.log(`   📧 ${email}:`);
        console.log(`      - Login attempts: ${user.loginAttempts || 0}`);
        console.log(`      - Lock until: ${user.lockUntil || 'Not locked'}`);
        console.log(`      - Has password: ${!!user.password}`);
        console.log(`      - Is active: ${user.isActive}`);
        console.log(`      - Is verified: ${user.isVerified}`);
      }
    }

    // Check phone user
    const phoneUser = await User.findOne({ phone: demoPhone }).select('+loginAttempts +lockUntil +password');
    if (phoneUser) {
      console.log(`   📱 ${demoPhone}:`);
      console.log(`      - Login attempts: ${phoneUser.loginAttempts || 0}`);
      console.log(`      - Lock until: ${phoneUser.lockUntil || 'Not locked'}`);
      console.log(`      - Has password: ${!!phoneUser.password}`);
      console.log(`      - Is active: ${phoneUser.isActive}`);
      console.log(`      - Is verified: ${phoneUser.isVerified}`);
    }

    console.log('\n🧪 Testing login after reset...');
    
    // Test one login to see if it works now
    try {
      const testResponse = await axios.post('https://quicklocal-backend.onrender.com/api/v1/auth/login', {
        identifier: 'demo@quicklocal.shop',
        password: 'demo123',
        remember: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ResetScript/1.0'
        },
        timeout: 15000
      });

      if (testResponse.status === 200) {
        console.log('✅ SUCCESS! Login now works after reset');
        console.log(`   - User: ${testResponse.data.user.name}`);
        console.log(`   - Role: ${testResponse.data.user.role}`);
      }
    } catch (loginError) {
      if (loginError.response) {
        console.log('❌ Login still failing:');
        console.log(`   - Status: ${loginError.response.status}`);
        console.log(`   - Message: ${loginError.response.data.message || loginError.response.data}`);
        
        if (loginError.response.status === 429) {
          console.log('⚠️  Rate limiting is still active at the server level');
          console.log('   This suggests the backend needs to restart or Redis cache needs clearing');
        }
      } else {
        console.log('❌ Network error:', loginError.message);
      }
    }

  } catch (error) {
    console.error('💥 Reset failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('📞 Database connection closed');
  }
}

// Run the reset
if (require.main === module) {
  resetAllLimits();
}

module.exports = { resetAllLimits };
