#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

console.log('🔍 Checking QuickLocal Database');
console.log('===============================');

async function checkDatabase() {
    try {
        console.log('\n📡 Connecting to database...');
        
        // Connect to MongoDB
        const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
        const dbName = process.env.MONGO_DB_NAME || process.env.DB_NAME || 'quicklocal';

        if (!uri) {
            throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
        }

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
        console.log('📊 Database:', mongoose.connection.db.databaseName);

        // Import models
        const Product = require('../models/product');
        const Category = require('../models/Category');
        const User = require('../models/User');

        // Check products
        console.log('\n📦 Checking Products...');
        const products = await Product.find({}).populate('category', 'name').populate('seller', 'name email');
        
        console.log(`📊 Total Products: ${products.length}`);
        
        if (products.length > 0) {
            console.log('\n📋 Product Details:');
            products.forEach((product, index) => {
                console.log(`   ${index + 1}. ${product.name}`);
                console.log(`      - Price: ₹${product.price}`);
                console.log(`      - Status: ${product.status}`);
                console.log(`      - Stock: ${product.stock}`);
                console.log(`      - Category: ${product.category?.name || 'No category'}`);
                console.log(`      - Seller: ${product.seller?.name || 'Unknown seller'}`);
                console.log(`      - Created: ${product.createdAt.toLocaleDateString()}`);
                console.log('');
            });
        } else {
            console.log('⚠️  No products found in database');
        }

        // Check categories
        console.log('\n📂 Checking Categories...');
        const categories = await Category.find({});
        console.log(`📊 Total Categories: ${categories.length}`);
        
        if (categories.length > 0) {
            console.log('\n📋 Category Details:');
            categories.forEach((category, index) => {
                console.log(`   ${index + 1}. ${category.name} (${category.slug})`);
                console.log(`      - Active: ${category.isActive}`);
                console.log(`      - Product Count: ${category.productCount}`);
                console.log('');
            });
        } else {
            console.log('⚠️  No categories found in database');
        }

        // Check users
        console.log('\n👥 Checking Users...');
        const users = await User.find({}).select('name email role isActive');
        console.log(`📊 Total Users: ${users.length}`);
        
        if (users.length > 0) {
            console.log('\n📋 User Details:');
            users.forEach((user, index) => {
                console.log(`   ${index + 1}. ${user.name} (${user.email})`);
                console.log(`      - Role: ${user.role}`);
                console.log(`      - Active: ${user.isActive}`);
                console.log('');
            });
        } else {
            console.log('⚠️  No users found in database');
        }

        // Check active products specifically
        console.log('\n✅ Checking Active Products...');
        const activeProducts = await Product.find({ status: 'active' });
        console.log(`📊 Active Products: ${activeProducts.length}`);
        
        if (activeProducts.length === 0 && products.length > 0) {
            console.log('⚠️  All products are saved as "draft" instead of "active"');
            console.log('💡 This is why products are not showing on the website!');
        }

        console.log('\n🎯 Summary:');
        console.log('===========');
        console.log(`1. Total Products: ${products.length}`);
        console.log(`2. Active Products: ${activeProducts.length}`);
        console.log(`3. Categories: ${categories.length}`);
        console.log(`4. Users: ${users.length}`);

        if (activeProducts.length === 0 && products.length > 0) {
            console.log('\n🔧 Solution:');
            console.log('============');
            console.log('To make products visible on the website:');
            console.log('1. Update product status from "draft" to "active"');
            console.log('2. Or modify the seller dashboard to save products as "active" by default');
            console.log('3. Or update the products API to show draft products too');
        }

    } catch (error) {
        console.error('❌ Database check failed:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('\n📡 Database connection closed');
    }
}

// Run the check
checkDatabase();
