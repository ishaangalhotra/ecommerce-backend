const mongoose = require('mongoose');

const migration = {
  async up() {
    const db = mongoose.connection.db;
    
    console.log('Creating geospatial indexes...');
    
    // Products geospatial index
    await db.collection('products').createIndex({ 
      "sellerLocation": "2dsphere" 
    });
    console.log('✅ Created products geospatial index');
    
    // Products compound index for local delivery queries
    await db.collection('products').createIndex({
      "sellerLocation.pincode": 1,
      "status": 1,
      "stock": 1,
      "createdAt": -1
    });
    console.log('✅ Created products compound index');
    
    // Cart user index (ensure uniqueness)
    try {
      await db.collection('carts').createIndex({ 
        "user": 1 
      }, { unique: true });
      console.log('✅ Created cart user index');
    } catch (error) {
      if (error.code !== 11000) { // Index already exists
        throw error;
      }
      console.log('ℹ️ Cart user index already exists');
    }
    
    // Orders tracking index
    await db.collection('orders').createIndex({
      "seller": 1,
      "status": 1,
      "createdAt": -1
    });
    console.log('✅ Created orders tracking index');
    
    // Users location index for sellers
    await db.collection('users').createIndex({
      "role": 1,
      "location.pincode": 1,
      "isActive": 1
    });
    console.log('✅ Created users location index');
    
    console.log('All geospatial indexes created successfully!');
  },
  
  async down() {
    const db = mongoose.connection.db;
    
    try {
      await db.collection('products').dropIndex("sellerLocation_2dsphere");
      await db.collection('products').dropIndex("sellerLocation.pincode_1_status_1_stock_1_createdAt_-1");
      await db.collection('carts').dropIndex("user_1");
      await db.collection('orders').dropIndex("seller_1_status_1_createdAt_-1");
      await db.collection('users').dropIndex("role_1_location.pincode_1_isActive_1");
      
      console.log('Rolled back geospatial indexes');
    } catch (error) {
      console.warn('Some indexes may not exist:', error.message);
    }
  }
};

module.exports = migration;
