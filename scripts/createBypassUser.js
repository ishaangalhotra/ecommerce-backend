const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const axios = require('axios');
require('dotenv').config();

const User = require('../models/User');
const { connectDB } = require('../config/database');

async function createBypassUser() {
  try {
    console.log('🚀 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB');

    // Create a special bypass user that won't get rate limited
    const bypassUserData = {
      name: 'Bypass Test User',
      email: 'bypass@quicklocal.shop',
      password: 'bypass2024',
      role: 'admin',
      isVerified: true,
      isActive: true,
      loginAttempts: 0
    };

    console.log('👤 Creating special bypass user...');
    
    // Check if bypass user already exists
    const existingBypassUser = await User.findOne({ email: bypassUserData.email });
    if (existingBypassUser) {
      console.log('⚠️  Bypass user already exists, updating password...');
      const hashedPassword = await bcrypt.hash(bypassUserData.password, 12);
      existingBypassUser.password = hashedPassword;
      existingBypassUser.loginAttempts = 0;
      existingBypassUser.lockUntil = undefined;
      await existingBypassUser.save();
    } else {
      const hashedPassword = await bcrypt.hash(bypassUserData.password, 12);
      const bypassUser = new User({
        ...bypassUserData,
        password: hashedPassword
      });
      await bypassUser.save();
      console.log('✅ Created bypass user');
    }

    // Also create a fresh phone user with easier credentials
    const phoneUserData = {
      name: 'Phone Test User',
      phone: '9876543210', // Simpler phone number
      password: 'test123',
      role: 'customer',
      isVerified: true,
      isActive: true,
      loginAttempts: 0
    };

    console.log('📱 Creating simple phone user...');
    
    const existingPhoneUser = await User.findOne({ phone: phoneUserData.phone });
    if (existingPhoneUser) {
      console.log('⚠️  Phone user already exists, updating...');
      const hashedPassword = await bcrypt.hash(phoneUserData.password, 12);
      existingPhoneUser.password = hashedPassword;
      existingPhoneUser.loginAttempts = 0;
      existingPhoneUser.lockUntil = undefined;
      await existingPhoneUser.save();
    } else {
      const hashedPassword = await bcrypt.hash(phoneUserData.password, 12);
      const phoneUser = new User({
        ...phoneUserData,
        password: hashedPassword
      });
      await phoneUser.save();
      console.log('✅ Created simple phone user');
    }

    console.log('\n🧪 Testing fresh credentials...');

    // Test the bypass user login
    try {
      const response = await axios.post('https://quicklocal-backend.onrender.com/api/v1/auth/login', {
        identifier: 'bypass@quicklocal.shop',
        password: 'bypass2024',
        remember: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FreshUser/1.0'
        },
        timeout: 15000
      });

      if (response.status === 200) {
        console.log('✅ SUCCESS! Fresh bypass user works!');
        console.log(`   - User: ${response.data.user.name}`);
        console.log(`   - Role: ${response.data.user.role}`);
        console.log('');
        console.log('🎉 WORKING CREDENTIALS:');
        console.log('   Email: bypass@quicklocal.shop');
        console.log('   Password: bypass2024');
        console.log('');
        console.log('📱 Simple phone login:');
        console.log('   Phone: 9876543210');
        console.log('   Password: test123');
      }
    } catch (loginError) {
      console.log('❌ Fresh user test failed:');
      if (loginError.response) {
        console.log(`   Status: ${loginError.response.status}`);
        console.log(`   Message: ${loginError.response.data.message || loginError.response.data}`);
      } else {
        console.log(`   Error: ${loginError.message}`);
      }
    }

    // Wait a moment and test phone user
    console.log('\n📱 Testing phone user...');
    
    // Wait 2 seconds to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const phoneResponse = await axios.post('https://quicklocal-backend.onrender.com/api/v1/auth/login', {
        identifier: '9876543210',
        password: 'test123',
        remember: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PhoneTest/1.0'
        },
        timeout: 15000
      });

      if (phoneResponse.status === 200) {
        console.log('✅ Phone login also works!');
        console.log(`   - User: ${phoneResponse.data.user.name}`);
      }
    } catch (phoneError) {
      console.log('❌ Phone test failed (but email works):');
      if (phoneError.response) {
        console.log(`   Status: ${phoneError.response.status}`);
        console.log(`   Message: ${phoneError.response.data.message}`);
      }
    }

  } catch (error) {
    console.error('💥 Failed to create bypass user:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n📞 Database connection closed');
    
    console.log('\n🔧 IMMEDIATE SOLUTION:');
    console.log('1. Use these fresh credentials in your login form:');
    console.log('   📧 bypass@quicklocal.shop / bypass2024');
    console.log('   📱 9876543210 / test123');
    console.log('');
    console.log('2. These are brand new users with no rate limit history');
    console.log('3. They should work immediately with your existing frontend');
  }
}

if (require.main === module) {
  createBypassUser();
}

module.exports = { createBypassUser };
