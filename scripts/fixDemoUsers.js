const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import User model
const User = require('../models/User');
const { connectDB } = require('../config/database');

const demoCredentials = [
  { identifier: 'demo@quicklocal.shop', password: 'demo123', name: 'Demo Customer', role: 'customer' },
  { identifier: 'user@quicklocal.shop', password: 'user123', name: 'Test User', role: 'customer' },
  { identifier: 'admin@quicklocal.shop', password: 'admin123', name: 'Admin User', role: 'admin' },
  { identifier: '+919876543220', password: 'phone123', name: 'Phone User', role: 'customer' }
];

async function fixDemoUsers() {
  try {
    console.log('🚀 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB');

    console.log('🔧 Fixing demo users...');

    for (const cred of demoCredentials) {
      try {
        // Find user by email or phone
        let user;
        if (cred.identifier.includes('@')) {
          user = await User.findOne({ email: cred.identifier }).select('+password +loginAttempts +lockUntil');
        } else {
          user = await User.findOne({ phone: cred.identifier }).select('+password +loginAttempts +lockUntil');
        }

        if (user) {
          console.log(`🔍 Found user: ${user.name} (${cred.identifier})`);
          
          // Reset lockout
          if (user.loginAttempts > 0 || user.lockUntil) {
            user.loginAttempts = 0;
            user.lockUntil = undefined;
            console.log(`   ✅ Reset login attempts and lockout`);
          }

          // Update password (hash it properly)
          const hashedPassword = await bcrypt.hash(cred.password, 12);
          user.password = hashedPassword;
          console.log(`   ✅ Updated password`);

          // Ensure user is active and verified
          user.isActive = true;
          user.isVerified = true;
          user.role = cred.role;

          await user.save();
          console.log(`   ✅ Saved user: ${cred.identifier}`);

          // Test password comparison
          const passwordCorrect = await bcrypt.compare(cred.password, hashedPassword);
          console.log(`   🧪 Password test: ${passwordCorrect ? 'PASS' : 'FAIL'}`);
          
        } else {
          console.log(`❌ User not found: ${cred.identifier} - Creating new user`);
          
          // Create user if not found
          const hashedPassword = await bcrypt.hash(cred.password, 12);
          
          const userData = {
            name: cred.name,
            password: hashedPassword,
            role: cred.role,
            isVerified: true,
            isActive: true,
            loginAttempts: 0
          };

          // Add email or phone
          if (cred.identifier.includes('@')) {
            userData.email = cred.identifier;
          } else {
            userData.phone = cred.identifier;
          }

          const newUser = new User(userData);
          await newUser.save();
          console.log(`   ✅ Created new user: ${cred.identifier}`);
        }

      } catch (error) {
        console.error(`❌ Failed to fix user ${cred.identifier}:`, error.message);
      }
    }

    console.log('\n🎉 Demo user fixes completed!');
    console.log('\n📋 Updated Demo Credentials:');
    console.log('   • demo@quicklocal.shop / demo123');
    console.log('   • user@quicklocal.shop / user123');
    console.log('   • admin@quicklocal.shop / admin123');
    console.log('   • +919876543220 / phone123');

  } catch (error) {
    console.error('💥 Fix operation failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('📞 Database connection closed');
    process.exit(0);
  }
}

// Run the fix function
if (require.main === module) {
  fixDemoUsers();
}

module.exports = { fixDemoUsers };
