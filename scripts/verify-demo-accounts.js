#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

// Import models
const User = require('../models/User');

async function verifyDemoAccounts() {
  try {
    console.log('✅ Verifying and activating demo accounts...');
    
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
    
    // Demo accounts to verify
    const demoEmails = [
      'demo@quicklocal.shop',
      'user@quicklocal.shop', 
      'admin@quicklocal.shop',
      'phone@quicklocal.shop'
    ];
    
    // Verify all demo accounts
    for (const email of demoEmails) {
      const result = await User.updateOne(
        { email },
        {
          $set: {
            isVerified: true,
            isActive: true,
            verifiedAt: new Date()
          },
          $unset: {
            loginAttempts: 1,
            lockUntil: 1,
            emailVerificationToken: 1,
            emailVerificationExpires: 1
          }
        }
      );
      
      if (result.matchedCount > 0) {
        console.log(`✅ Verified and activated: ${email}`);
      } else {
        console.log(`❌ Not found: ${email}`);
      }
    }
    
    // Also verify phone user
    const phoneResult = await User.updateOne(
      { phone: '+919876543220' },
      {
        $set: {
          isVerified: true,
          isActive: true,
          verifiedAt: new Date()
        },
        $unset: {
          loginAttempts: 1,
          lockUntil: 1,
          emailVerificationToken: 1,
          emailVerificationExpires: 1
        }
      }
    );
    
    if (phoneResult.matchedCount > 0) {
      console.log(`✅ Verified and activated phone user: +919876543220`);
    }
    
    // Check final status
    console.log('\n📋 Final Demo Account Status:');
    for (const email of demoEmails) {
      const user = await User.findOne({ email });
      if (user) {
        console.log(`✅ ${email} - Active: ${user.isActive}, Verified: ${user.isVerified}, Role: ${user.role}`);
      }
    }
    
    const phoneUser = await User.findOne({ phone: '+919876543220' });
    if (phoneUser) {
      console.log(`✅ +919876543220 - Active: ${phoneUser.isActive}, Verified: ${phoneUser.isVerified}, Role: ${phoneUser.role}`);
    }
    
    console.log('\n🎉 Demo account verification completed!');
    console.log('\n🔐 Ready Demo Credentials:');
    console.log('📧 demo@quicklocal.shop / demo123 (Customer)');
    console.log('👤 user@quicklocal.shop / user123 (Customer)');
    console.log('👑 admin@quicklocal.shop / admin123 (Admin)');
    console.log('📱 +919876543220 / phone123 (Customer)');
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Database connection closed');
    process.exit(0);
  }
}

// Run the verification
verifyDemoAccounts();
