const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import User model
const User = require('../models/User');
const { connectDB } = require('../config/database');

const demoUsers = [
  {
    name: 'Demo Customer',
    email: 'demo@quicklocal.shop',
    password: 'demo123',
    role: 'customer',
    isVerified: true,
    isActive: true
  },
  {
    name: 'Test User',
    email: 'user@quicklocal.shop', 
    password: 'user123',
    role: 'customer',
    isVerified: true,
    isActive: true
  },
  {
    name: 'Admin User',
    email: 'admin@quicklocal.shop',
    password: 'admin123', 
    role: 'admin',
    isVerified: true,
    isActive: true
  },
  {
    name: 'Phone User',
    phone: '+919876543220',
    password: 'phone123',
    role: 'customer', 
    isVerified: true,
    isActive: true
  }
];

async function seedDemoUsers() {
  try {
    console.log('🚀 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB');

    console.log('🌱 Seeding demo users...');

    for (const userData of demoUsers) {
      try {
        // Check if user already exists
        let existingUser;
        if (userData.email) {
          existingUser = await User.findOne({ email: userData.email });
        } else if (userData.phone) {
          existingUser = await User.findOne({ phone: userData.phone });
        }

        if (existingUser) {
          console.log(`⚠️  User already exists: ${userData.email || userData.phone}`);
          // Update password for existing user
          const hashedPassword = await bcrypt.hash(userData.password, 12);
          existingUser.password = hashedPassword;
          existingUser.isVerified = true;
          existingUser.isActive = true;
          existingUser.role = userData.role;
          await existingUser.save();
          console.log(`🔄 Updated existing user: ${userData.email || userData.phone}`);
        } else {
          // Hash password before saving
          const hashedPassword = await bcrypt.hash(userData.password, 12);
          
          // Create new user
          const user = new User({
            ...userData,
            password: hashedPassword
          });

          await user.save();
          console.log(`✅ Created demo user: ${userData.email || userData.phone} (Role: ${userData.role})`);
        }
      } catch (error) {
        console.error(`❌ Failed to create user ${userData.email || userData.phone}:`, error.message);
      }
    }

    console.log('🎉 Demo user seeding completed!');
    console.log('\n📋 Demo Credentials:');
    console.log('   • demo@quicklocal.shop / demo123');
    console.log('   • user@quicklocal.shop / user123');  
    console.log('   • admin@quicklocal.shop / admin123');
    console.log('   • +919876543220 / phone123');
    console.log('\n🔗 Backend URL: https://quicklocal-backend.onrender.com/api/v1');

  } catch (error) {
    console.error('💥 Seeding failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('📞 Database connection closed');
    process.exit(0);
  }
}

// Run the seeding function
if (require.main === module) {
  seedDemoUsers();
}

module.exports = { seedDemoUsers };
