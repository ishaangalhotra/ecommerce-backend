#!/usr/bin/env node
/**
 * Database Memory Analysis Script
 * 
 * Analyzes all collections to identify memory usage patterns and optimization opportunities
 */

require('dotenv').config();
const mongoose = require('mongoose');

console.log('🔍 Starting Database Memory Analysis...\n');

async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

async function analyzeCollections() {
  console.log('\n📊 COLLECTION ANALYSIS');
  console.log('='.repeat(50));
  
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    const collectionStats = [];
    
    for (const collection of collections) {
      try {
        const stats = await db.collection(collection.name).stats();
        const estimatedMemory = stats.size / (1024 * 1024); // MB
        
        collectionStats.push({
          name: collection.name,
          count: stats.count,
          size: stats.size,
          memoryMB: estimatedMemory,
          avgDocSize: stats.count > 0 ? stats.size / stats.count : 0,
          indexes: stats.nindexes
        });
        
        console.log(`📁 ${collection.name}:`);
        console.log(`   📊 Documents: ${stats.count}`);
        console.log(`   💾 Size: ${estimatedMemory.toFixed(2)} MB`);
        console.log(`   📏 Avg doc size: ${stats.count > 0 ? Math.round(stats.size / stats.count) : 0} bytes`);
        console.log(`   🔍 Indexes: ${stats.nindexes}`);
        console.log('');
        
      } catch (error) {
        console.log(`❌ Could not analyze ${collection.name}: ${error.message}`);
      }
    }
    
    // Sort by memory usage
    collectionStats.sort((a, b) => b.memoryMB - a.memoryMB);
    
    const totalMemory = collectionStats.reduce((sum, col) => sum + col.memoryMB, 0);
    const totalDocs = collectionStats.reduce((sum, col) => sum + col.count, 0);
    
    console.log(`📊 SUMMARY`);
    console.log('='.repeat(20));
    console.log(`💾 Total database size: ${totalMemory.toFixed(2)} MB`);
    console.log(`📄 Total documents: ${totalDocs}`);
    console.log(`🔝 Largest collection: ${collectionStats[0]?.name} (${collectionStats[0]?.memoryMB.toFixed(2)} MB)`);
    
    return collectionStats;
    
  } catch (error) {
    console.error('❌ Collection analysis failed:', error.message);
    throw error;
  }
}

async function analyzeSpecificCollections() {
  console.log('\n🔬 DETAILED COLLECTION ANALYSIS');
  console.log('='.repeat(40));
  
  // Import models dynamically
  const models = {};
  try {
    models.User = require('../models/User');
    models.Product = require('../models/Product');
    models.Order = require('../models/Order');
    models.Cart = require('../models/cart');
  } catch (error) {
    console.log('⚠️  Some models not available for detailed analysis');
  }
  
  // Analyze Users
  if (models.User) {
    try {
      const userCount = await models.User.countDocuments();
      const activeUsers = await models.User.countDocuments({ isActive: true });
      const usersWithImages = await models.User.countDocuments({ 
        profilePicture: { $exists: true, $ne: null, $ne: '' }
      });
      
      console.log(`👤 USERS ANALYSIS`);
      console.log(`   Total users: ${userCount}`);
      console.log(`   Active users: ${activeUsers}`);
      console.log(`   Users with profile pictures: ${usersWithImages}`);
      
      if (userCount > 0) {
        const sampleUser = await models.User.findOne().lean();
        const avgUserSize = JSON.stringify(sampleUser).length;
        console.log(`   Avg user document size: ~${avgUserSize} bytes`);
      }
      console.log('');
    } catch (error) {
      console.log(`❌ User analysis failed: ${error.message}`);
    }
  }
  
  // Analyze Orders
  if (models.Order) {
    try {
      const orderCount = await models.Order.countDocuments();
      const recentOrders = await models.Order.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      });
      
      console.log(`📦 ORDERS ANALYSIS`);
      console.log(`   Total orders: ${orderCount}`);
      console.log(`   Recent orders (30 days): ${recentOrders}`);
      
      if (orderCount > 0) {
        const sampleOrder = await models.Order.findOne().lean();
        const avgOrderSize = JSON.stringify(sampleOrder).length;
        console.log(`   Avg order document size: ~${avgOrderSize} bytes`);
      }
      console.log('');
    } catch (error) {
      console.log(`❌ Order analysis failed: ${error.message}`);
    }
  }
  
  // Analyze Carts
  if (models.Cart) {
    try {
      const cartCount = await models.Cart.countDocuments();
      const activeCarts = await models.Cart.countDocuments({
        updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      });
      const emptyCarts = await models.Cart.countDocuments({
        $or: [
          { items: { $size: 0 } },
          { items: { $exists: false } }
        ]
      });
      
      console.log(`🛒 CARTS ANALYSIS`);
      console.log(`   Total carts: ${cartCount}`);
      console.log(`   Active carts (7 days): ${activeCarts}`);
      console.log(`   Empty carts: ${emptyCarts}`);
      
      if (cartCount > 0) {
        const sampleCart = await models.Cart.findOne().lean();
        const avgCartSize = JSON.stringify(sampleCart).length;
        console.log(`   Avg cart document size: ~${avgCartSize} bytes`);
      }
      console.log('');
    } catch (error) {
      console.log(`❌ Cart analysis failed: ${error.message}`);
    }
  }
}

async function generateOptimizationRecommendations(collectionStats) {
  console.log(`\n💡 OPTIMIZATION RECOMMENDATIONS`);
  console.log('='.repeat(40));
  
  const recommendations = [];
  
  // Find collections with high memory usage
  const highMemoryCollections = collectionStats.filter(col => col.memoryMB > 1);
  if (highMemoryCollections.length > 0) {
    recommendations.push(`🔍 Review high-memory collections: ${highMemoryCollections.map(c => c.name).join(', ')}`);
  }
  
  // Find collections with many documents
  const highDocCollections = collectionStats.filter(col => col.count > 1000);
  if (highDocCollections.length > 0) {
    recommendations.push(`📊 Consider archiving old documents in: ${highDocCollections.map(c => c.name).join(', ')}`);
  }
  
  // Find collections with large average document size
  const largeDocCollections = collectionStats.filter(col => col.avgDocSize > 10000); // > 10KB
  if (largeDocCollections.length > 0) {
    recommendations.push(`📄 Review large document sizes in: ${largeDocCollections.map(c => c.name).join(', ')}`);
  }
  
  // Check for too many indexes
  const highIndexCollections = collectionStats.filter(col => col.indexes > 10);
  if (highIndexCollections.length > 0) {
    recommendations.push(`🔍 Review index usage in: ${highIndexCollections.map(c => c.name).join(', ')}`);
  }
  
  // General recommendations
  recommendations.push(`🧹 Clean up empty/old cart documents regularly`);
  recommendations.push(`📊 Implement document archiving for old orders/logs`);
  recommendations.push(`🗜️  Use lean() queries for read-only operations`);
  recommendations.push(`📈 Monitor memory usage with process.memoryUsage()`);
  
  recommendations.forEach((rec, index) => {
    console.log(`${index + 1}. ${rec}`);
  });
  
  return recommendations;
}

async function runAnalysis() {
  try {
    await connectToDatabase();
    
    const collectionStats = await analyzeCollections();
    await analyzeSpecificCollections();
    await generateOptimizationRecommendations(collectionStats);
    
    console.log(`\n✅ Database analysis complete!`);
    
  } catch (error) {
    console.error('\n💥 Analysis failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n📴 Disconnected from database');
  }
}

// Run analysis if called directly
if (require.main === module) {
  runAnalysis();
}

module.exports = {
  analyzeCollections,
  analyzeSpecificCollections,
  generateOptimizationRecommendations
};
