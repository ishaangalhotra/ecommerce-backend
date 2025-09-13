#!/usr/bin/env node
/**
 * Product Database Analysis Script
 * 
 * Analyzes the products collection to:
 * 1. Count total products
 * 2. Identify demo/test products
 * 3. Calculate memory usage
 * 4. Provide cleanup recommendations
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Import models
const Product = require('../models/Product');
const User = require('../models/User');

console.log('🔍 Starting Product Database Analysis...\n');

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

async function analyzeProducts() {
  console.log('\n📊 PRODUCT ANALYSIS');
  console.log('='.repeat(50));
  
  try {
    // Basic counts
    const totalProducts = await Product.countDocuments();
    const activeProducts = await Product.countDocuments({ status: 'active' });
    const inactiveProducts = await Product.countDocuments({ status: { $ne: 'active' } });
    
    console.log(`📦 Total Products: ${totalProducts}`);
    console.log(`✅ Active Products: ${activeProducts}`);
    console.log(`❌ Inactive Products: ${inactiveProducts}`);
    
    // Identify potential demo products
    const demoPatterns = [
      { name: /test/i },
      { name: /demo/i },
      { name: /sample/i },
      { name: /example/i },
      { description: /test/i },
      { description: /demo/i },
      { description: /sample/i },
      { name: /lorem/i },
      { description: /lorem/i },
      { name: /^product \d+$/i }, // Generic "Product 1", "Product 2" names
      { name: /^item \d+$/i },    // Generic "Item 1", "Item 2" names
    ];
    
    let totalDemoProducts = 0;
    const demoProductDetails = [];
    
    for (const pattern of demoPatterns) {
      const demoProducts = await Product.find(pattern).select('name description price createdAt').limit(100);
      if (demoProducts.length > 0) {
        console.log(`\n🧪 Found ${demoProducts.length} products matching pattern: ${JSON.stringify(pattern)}`);
        totalDemoProducts += demoProducts.length;
        demoProductDetails.push(...demoProducts.map(p => ({
          ...p.toObject(),
          matchedPattern: pattern
        })));
      }
    }
    
    console.log(`\n🎭 Total Demo/Test Products Found: ${totalDemoProducts}`);
    
    // Check for products with generic/placeholder data
    const productsWithNoImages = await Product.countDocuments({ 
      $or: [
        { images: { $size: 0 } },
        { images: { $exists: false } }
      ]
    });
    
    const productsWithZeroPrice = await Product.countDocuments({ price: 0 });
    const productsWithLowPrice = await Product.countDocuments({ 
      price: { $lt: 1, $gt: 0 } 
    });
    
    console.log(`📸 Products with no images: ${productsWithNoImages}`);
    console.log(`💰 Products with zero price: ${productsWithZeroPrice}`);
    console.log(`💸 Products with price < ₹1: ${productsWithLowPrice}`);
    
    // Memory usage estimation
    const sampleProduct = await Product.findOne().lean();
    if (sampleProduct) {
      const productSizeEstimate = JSON.stringify(sampleProduct).length;
      const totalMemoryEstimate = (productSizeEstimate * totalProducts) / (1024 * 1024); // MB
      const demoMemoryEstimate = (productSizeEstimate * totalDemoProducts) / (1024 * 1024); // MB
      
      console.log(`\n💾 MEMORY USAGE ESTIMATES`);
      console.log('='.repeat(30));
      console.log(`📏 Average product size: ~${productSizeEstimate} bytes`);
      console.log(`💾 Total products memory: ~${totalMemoryEstimate.toFixed(2)} MB`);
      console.log(`🗑️  Demo products memory: ~${demoMemoryEstimate.toFixed(2)} MB`);
      console.log(`📉 Potential memory savings: ~${demoMemoryEstimate.toFixed(2)} MB (${((demoMemoryEstimate/totalMemoryEstimate)*100).toFixed(1)}%)`);
    }
    
    // Category analysis
    const categoryStats = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    console.log(`\n📂 TOP CATEGORIES`);
    console.log('='.repeat(25));
    categoryStats.forEach(cat => {
      console.log(`${cat._id || 'Uncategorized'}: ${cat.count} products`);
    });
    
    // Date analysis
    const oldProducts = await Product.countDocuments({
      createdAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Older than 30 days
    });
    
    const recentProducts = await Product.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
    });
    
    console.log(`\n📅 PRODUCT AGE DISTRIBUTION`);
    console.log('='.repeat(30));
    console.log(`🕒 Products older than 30 days: ${oldProducts}`);
    console.log(`🆕 Products from last 7 days: ${recentProducts}`);
    
    // Seller analysis
    const productsWithoutSeller = await Product.countDocuments({
      $or: [
        { seller: { $exists: false } },
        { seller: null }
      ]
    });
    
    console.log(`\n👤 SELLER ANALYSIS`);
    console.log('='.repeat(20));
    console.log(`🚫 Products without seller: ${productsWithoutSeller}`);
    
    return {
      totalProducts,
      totalDemoProducts,
      demoProductDetails: demoProductDetails.slice(0, 20), // Limit output
      recommendations: generateRecommendations(totalProducts, totalDemoProducts, productsWithNoImages, productsWithZeroPrice)
    };
    
  } catch (error) {
    console.error('❌ Product analysis failed:', error.message);
    throw error;
  }
}

function generateRecommendations(totalProducts, demoProducts, noImageProducts, zeroPriceProducts) {
  const recommendations = [];
  
  if (demoProducts > 0) {
    recommendations.push(`🧹 Clean up ${demoProducts} demo/test products to save memory`);
  }
  
  if (noImageProducts > 10) {
    recommendations.push(`📸 Review ${noImageProducts} products without images - may be incomplete`);
  }
  
  if (zeroPriceProducts > 5) {
    recommendations.push(`💰 Review ${zeroPriceProducts} products with zero price - may be test data`);
  }
  
  if (totalProducts > 1000) {
    recommendations.push(`📊 Consider implementing product archiving for old/inactive products`);
  }
  
  if (recommendations.length === 0) {
    recommendations.push(`✅ Product database looks clean and optimized`);
  }
  
  return recommendations;
}

async function generateCleanupScript(analysisResults) {
  console.log(`\n🛠️  CLEANUP RECOMMENDATIONS`);
  console.log('='.repeat(35));
  
  analysisResults.recommendations.forEach((rec, index) => {
    console.log(`${index + 1}. ${rec}`);
  });
  
  if (analysisResults.totalDemoProducts > 0) {
    console.log(`\n📝 Sample demo products to be cleaned:`);
    analysisResults.demoProductDetails.slice(0, 5).forEach((product, index) => {
      console.log(`   ${index + 1}. "${product.name}" - ₹${product.price} (${product._id})`);
    });
    
    if (analysisResults.demoProductDetails.length > 5) {
      console.log(`   ... and ${analysisResults.demoProductDetails.length - 5} more`);
    }
  }
}

async function runAnalysis() {
  try {
    await connectToDatabase();
    
    console.log('🔍 Analyzing product database...');
    const results = await analyzeProducts();
    
    await generateCleanupScript(results);
    
    console.log(`\n✅ Analysis complete!`);
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Review the identified demo products above`);
    console.log(`   2. Run the cleanup script: node scripts/cleanup-demo-products.js`);
    console.log(`   3. Monitor memory usage after cleanup`);
    
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
  analyzeProducts,
  generateRecommendations
};
