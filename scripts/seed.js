require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Import models
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seeding...');
    
    // Connect to MongoDB
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    const dbName = process.env.MONGO_DB_NAME || process.env.DB_NAME || 'quicklocal';
    
    if (!uri) {
      throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
    }
    
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(uri, {
      dbName,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 30000,
      retryWrites: true,
      retryReads: true,
      bufferCommands: false
    });
    
    console.log('✅ Connected to MongoDB successfully');
    
    // Clear existing data
    console.log('🧹 Clearing existing data...');
    await User.deleteMany({});
    await Category.deleteMany({});
    await Product.deleteMany({});
    
    // Create admin user
    console.log('👤 Creating admin user...');
    const adminPassword = await bcrypt.hash('admin123', 12);
    const adminUser = await User.create({
      name: 'Admin User',
      email: 'admin@quicklocal.com',
      password: adminPassword,
      role: 'admin',
      phone: '+919876543210',
      isActive: true,
      emailVerified: true
    });
    console.log('✅ Admin user created:', adminUser.email);
    
    // Create seller user
    console.log('🏪 Creating seller user...');
    const sellerPassword = await bcrypt.hash('seller123', 12);
    const sellerUser = await User.create({
      name: 'Local Store',
      email: 'seller@quicklocal.com',
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
    
    // Create customer user
    console.log('👤 Creating customer user...');
    const customerPassword = await bcrypt.hash('customer123', 12);
    const customerUser = await User.create({
      name: 'John Customer',
      email: 'customer@quicklocal.com',
      password: customerPassword,
      role: 'customer',
      phone: '+919876543212',
      isActive: true,
      emailVerified: true,
      location: {
        address: '456 Customer Ave',
        city: 'Local City',
        state: 'Local State',
        pincode: '12345',
        coordinates: [0.001, 0.001]
      }
    });
    console.log('✅ Customer user created:', customerUser.email);
    
    // Create categories
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
    
    // Create products
    console.log('📦 Creating products...');
    const products = await Product.create([
      {
        name: 'Fresh Organic Apples',
        description: 'Sweet and crisp organic apples, perfect for snacking',
        price: 2.99,
        originalPrice: 3.49,
        images: [{
          url: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=400',
          alt: 'Fresh Organic Apples',
          isPrimary: true,
          order: 0
        }],
        category: categories[0]._id,
        seller: sellerUser._id,
        stock: 50,
        unit: 'kg',
        tags: ['organic', 'fresh', 'fruits'],
        status: 'active',
        sellerLocation: {
          type: 'Point',
          coordinates: [0, 0]
        }
      },
      {
        name: 'Whole Milk',
        description: 'Fresh whole milk from local dairy farms',
        price: 1.99,
        originalPrice: 2.29,
        images: [{
          url: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400',
          alt: 'Whole Milk',
          isPrimary: true,
          order: 0
        }],
        category: categories[1]._id,
        seller: sellerUser._id,
        stock: 30,
        unit: 'liter',
        tags: ['dairy', 'fresh', 'local'],
        status: 'active',
        sellerLocation: {
          type: 'Point',
          coordinates: [0, 0]
        }
      },
      {
        name: 'Fresh Bread',
        description: 'Artisan bread baked fresh daily',
        price: 3.49,
        originalPrice: 3.99,
        images: [{
          url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400',
          alt: 'Fresh Bread',
          isPrimary: true,
          order: 0
        }],
        category: categories[1]._id,
        seller: sellerUser._id,
        stock: 25,
        unit: 'piece',
        tags: ['bakery', 'fresh', 'artisan'],
        status: 'active',
        sellerLocation: {
          type: 'Point',
          coordinates: [0, 0]
        }
      },
      {
        name: 'Chicken Breast',
        description: 'Fresh boneless chicken breast, perfect for grilling',
        price: 8.99,
        originalPrice: 10.99,
        images: [{
          url: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=400',
          alt: 'Chicken Breast',
          isPrimary: true,
          order: 0
        }],
        category: categories[2]._id,
        seller: sellerUser._id,
        stock: 15,
        unit: 'kg',
        tags: ['meat', 'fresh', 'protein'],
        status: 'active',
        sellerLocation: {
          type: 'Point',
          coordinates: [0, 0]
        }
      },
      {
        name: 'Basmati Rice',
        description: 'Premium long-grain basmati rice',
        price: 4.99,
        originalPrice: 5.99,
        images: [{
          url: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400',
          alt: 'Basmati Rice',
          isPrimary: true,
          order: 0
        }],
        category: categories[3]._id,
        seller: sellerUser._id,
        stock: 40,
        unit: 'kg',
        tags: ['pantry', 'rice', 'staple'],
        status: 'active',
        sellerLocation: {
          type: 'Point',
          coordinates: [0, 0]
        }
      }
    ]);
    console.log('✅ Created', products.length, 'products');
    
    console.log('\n🎉 Database seeding completed successfully!');
    console.log('\n📋 Test Accounts:');
    console.log('Admin: admin@quicklocal.com / admin123');
    console.log('Seller: seller@quicklocal.com / seller123');
    console.log('Customer: customer@quicklocal.com / customer123');
    
    console.log('\n🔗 API Endpoints:');
    console.log('Products: http://localhost:10000/api/v1/products');
    console.log('Categories: http://localhost:10000/api/v1/categories');
    console.log('Auth: http://localhost:10000/api/v1/auth/login');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Database connection closed');
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
