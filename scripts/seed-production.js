#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Import models
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');

async function seedProductionDatabase() {
  try {
    console.log('🌱 Starting PRODUCTION database seeding...');
    
    // Connect to MongoDB using production URI
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    const dbName = process.env.MONGO_DB_NAME || process.env.DB_NAME || 'quicklocal-prod';
    
    if (!uri) {
      throw new Error('MONGODB_URI or MONGO_URI environment variable is required');
    }
    
    console.log('📡 Connecting to PRODUCTION MongoDB...');
    console.log('🗄️ Database:', dbName);
    
    await mongoose.connect(uri, {
      dbName,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      retryReads: true,
      bufferCommands: false
    });
    
    console.log('✅ Connected to PRODUCTION MongoDB successfully');
    
    // Check if demo users already exist
    const existingDemo = await User.findOne({ email: 'demo@quicklocal.shop' });
    const existingAdmin = await User.findOne({ email: 'admin@quicklocal.shop' });
    const existingUser = await User.findOne({ email: 'user@quicklocal.shop' });
    
    if (existingDemo && existingAdmin && existingUser) {
      console.log('✅ Demo users already exist. Skipping user creation.');
    } else {
      console.log('👥 Creating missing demo users...');
      
      // Create admin user if doesn't exist
      if (!existingAdmin) {
        console.log('👤 Creating admin user...');
        const adminPassword = await bcrypt.hash('admin123', 12);
        const adminUser = await User.create({
          name: 'Admin User',
          email: 'admin@quicklocal.shop',
          password: adminPassword,
          role: 'admin',
          phone: '+919876543210',
          isActive: true,
          emailVerified: true
        });
        console.log('✅ Admin user created:', adminUser.email);
      }
      
      // Create demo user if doesn't exist
      if (!existingDemo) {
        console.log('🎯 Creating demo user...');
        const demoPassword = await bcrypt.hash('demo123', 12);
        const demoUser = await User.create({
          name: 'Demo User',
          email: 'demo@quicklocal.shop',
          password: demoPassword,
          role: 'customer',
          phone: '+919876543213',
          isActive: true,
          emailVerified: true,
          location: {
            address: '123 Demo Street',
            city: 'Demo City',
            state: 'Demo State',
            pincode: '12345',
            coordinates: [0, 0]
          }
        });
        console.log('✅ Demo user created:', demoUser.email);
      }
      
      // Create regular user if doesn't exist
      if (!existingUser) {
        console.log('👤 Creating user account...');
        const userPassword = await bcrypt.hash('user123', 12);
        const userUser = await User.create({
          name: 'Regular User',
          email: 'user@quicklocal.shop',
          password: userPassword,
          role: 'customer',
          phone: '+919876543214',
          isActive: true,
          emailVerified: true,
          location: {
            address: '456 User Ave',
            city: 'User City',
            state: 'User State',
            pincode: '12345',
            coordinates: [0.001, 0.001]
          }
        });
        console.log('✅ Regular user created:', userUser.email);
      }
      
      // Create seller user if doesn't exist
      const existingSeller = await User.findOne({ email: 'seller@quicklocal.shop' });
      if (!existingSeller) {
        console.log('🏪 Creating seller user...');
        const sellerPassword = await bcrypt.hash('seller123', 12);
        const sellerUser = await User.create({
          name: 'Local Store',
          email: 'seller@quicklocal.shop',
          password: sellerPassword,
          role: 'seller',
          phone: '+919876543211',
          isActive: true,
          emailVerified: true,
          location: {
            address: '123 Main Street',
            city: 'Local City',
            state: 'Local State',
            pincode: '12345',
            coordinates: [0, 0]
          }
        });
        console.log('✅ Seller user created:', sellerUser.email);
      }
    }
    
    // Check and create categories if needed
    const categoryCount = await Category.countDocuments();
    if (categoryCount === 0) {
      console.log('📂 Creating categories...');
      const categories = await Category.create([
        {
          name: 'Fresh Produce',
          description: 'Fresh fruits and vegetables',
          slug: 'fresh-produce',
          icon: '🍎',
          order: 1,
          isActive: true,
          isFeatured: true
        },
        {
          name: 'Dairy & Bakery',
          description: 'Milk, cheese, bread, and baked goods',
          slug: 'dairy-bakery',
          icon: '🥛',
          order: 2,
          isActive: true,
          isFeatured: true
        },
        {
          name: 'Meat & Seafood',
          description: 'Fresh meat, poultry, and seafood',
          slug: 'meat-seafood',
          icon: '🥩',
          order: 3,
          isActive: true,
          isFeatured: false
        },
        {
          name: 'Pantry Essentials',
          description: 'Rice, pasta, oils, and cooking essentials',
          slug: 'pantry-essentials',
          icon: '🍚',
          order: 4,
          isActive: true,
          isFeatured: true
        },
        {
          name: 'Beverages',
          description: 'Soft drinks, juices, and water',
          slug: 'beverages',
          icon: '🥤',
          order: 5,
          isActive: true,
          isFeatured: false
        }
      ]);
      console.log('✅ Created', categories.length, 'categories');
    } else {
      console.log('✅ Categories already exist. Skipping category creation.');
    }
    
    // Check and create some sample products if needed
    const productCount = await Product.countDocuments();
    if (productCount === 0) {
      console.log('📦 Creating sample products...');
      const categories = await Category.find();
      const seller = await User.findOne({ role: 'seller' });
      
      if (categories.length > 0 && seller) {
        const products = await Product.create([
          {
            name: 'Fresh Organic Apples',
            description: 'Sweet and crisp organic apples, perfect for snacking',
            price: 299, // Price in paise (₹2.99)
            originalPrice: 349,
            images: [{
              url: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=400',
              alt: 'Fresh Organic Apples',
              isPrimary: true,
              order: 0
            }],
            category: categories[0]._id,
            seller: seller._id,
            stock: 50,
            unit: 'kg',
            tags: ['organic', 'fresh', 'fruits'],
            status: 'active',
            sellerLocation: {
              type: 'Point',
              coordinates: [77.2090, 28.6139] // Delhi coordinates
            }
          },
          {
            name: 'Whole Milk',
            description: 'Fresh whole milk from local dairy farms',
            price: 199,
            originalPrice: 229,
            images: [{
              url: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400',
              alt: 'Whole Milk',
              isPrimary: true,
              order: 0
            }],
            category: categories[1]._id,
            seller: seller._id,
            stock: 30,
            unit: 'liter',
            tags: ['dairy', 'fresh', 'local'],
            status: 'active',
            sellerLocation: {
              type: 'Point',
              coordinates: [77.2090, 28.6139]
            }
          }
        ]);
        console.log('✅ Created', products.length, 'sample products');
      }
    } else {
      console.log('✅ Products already exist. Skipping product creation.');
    }
    
    console.log('\n🎉 PRODUCTION database seeding completed successfully!');
    console.log('\n📋 Available Test Accounts:');
    console.log('👑 Admin: admin@quicklocal.shop / admin123');
    console.log('🎯 Demo: demo@quicklocal.shop / demo123');
    console.log('👤 User: user@quicklocal.shop / user123');
    console.log('🏪 Seller: seller@quicklocal.shop / seller123');
    
    console.log('\n🔗 Production API Endpoints:');
    console.log('🌍 Base: https://quicklocal-backend.onrender.com');
    console.log('📦 Products: https://quicklocal-backend.onrender.com/api/v1/products');
    console.log('📂 Categories: https://quicklocal-backend.onrender.com/api/v1/categories');
    console.log('🔐 Auth: https://quicklocal-backend.onrender.com/api/v1/auth/login');
    console.log('❤️  Health: https://quicklocal-backend.onrender.com/health');
    
  } catch (error) {
    console.error('❌ PRODUCTION seeding failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Database connection closed');
    process.exit(0);
  }
}

// Run seeding
seedProductionDatabase();
