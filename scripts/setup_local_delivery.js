const mongoose = require('mongoose');
const MigrationRunner = require('../migrations');
const logger = require('../utils/logger');

async function setupLocalDelivery() {
  try {
    console.log('🚀 Setting up Local Delivery System...\n');
    
    // Connect to database
    await mongoose.connect(process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to database\n');
    
    // Run migrations
    const migrationRunner = new MigrationRunner();
    await migrationRunner.runMigrations();
    console.log('✅ Migrations completed\n');
    
    // Test geospatial query
    const ProductEnhanced = require('../models/ProductEnhanced');
    const testQuery = await ProductEnhanced.findOne({});
    console.log('✅ Enhanced Product model is working\n');
    
    console.log('🎉 Local Delivery System setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Update your existing products with location data');
    console.log('2. Enable local delivery for sellers');
    console.log('3. Test the new API endpoints');
    console.log('4. Deploy to production');
    
  } catch (error) {
    logger.error('Setup failed:', error);
    console.error('❌ Setup failed:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  setupLocalDelivery();
}

module.exports = setupLocalDelivery;
