#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

// Import models
const User = require('../models/User');

async function resetAccountLockouts() {
  try {
    console.log('🔓 Resetting account lockouts and login attempts...');
    
    // Connect to MongoDB using production URI
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    const dbName = process.env.MONGO_DB_NAME || process.env.DB_NAME || 'quicklocal-prod';
    
    if (!uri) {
      throw new Error('MONGODB_URI or MONGO_URI environment variable is required');
    }
    
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(uri, {
      dbName,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      retryReads: true,
      bufferCommands: false
    });
    
    console.log('✅ Connected to MongoDB successfully');
    
    // Reset all account lockouts and login attempts
    const result = await User.updateMany(
      {
        $or: [
          { loginAttempts: { $exists: true } },
          { lockUntil: { $exists: true } }
        ]
      },
      {
        $unset: {
          loginAttempts: 1,
          lockUntil: 1
        }
      }
    );
    
    console.log(`🔓 Reset lockouts for ${result.modifiedCount} accounts`);
    
    // Check demo accounts status
    const demoAccounts = [
      'demo@quicklocal.shop',
      'user@quicklocal.shop', 
      'admin@quicklocal.shop',
      'phone@quicklocal.shop'
    ];
    
    console.log('\n📋 Demo Account Status:');
    for (const email of demoAccounts) {
      const user = await User.findOne({ email });
      if (user) {
        console.log(`✅ ${email} - Active: ${user.isActive}, Verified: ${user.isVerified}, Attempts: ${user.loginAttempts || 0}`);
      } else {
        console.log(`❌ ${email} - Not found`);
      }
    }
    
    // Check phone demo user
    const phoneUser = await User.findOne({ phone: '+919876543220' });
    if (phoneUser) {
      console.log(`✅ +919876543220 (${phoneUser.email}) - Active: ${phoneUser.isActive}, Verified: ${phoneUser.isVerified}, Attempts: ${phoneUser.loginAttempts || 0}`);
    } else {
      console.log(`❌ +919876543220 - Not found`);
    }
    
    console.log('\n🎉 Account lockout reset completed!');
    console.log('\n🔐 Demo Credentials Ready:');
    console.log('📧 demo@quicklocal.shop / demo123');
    console.log('👤 user@quicklocal.shop / user123');
    console.log('👑 admin@quicklocal.shop / admin123');
    console.log('📱 +919876543220 / phone123');
    
  } catch (error) {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Database connection closed');
    process.exit(0);
  }
}

// Run the reset
resetAccountLockouts();
