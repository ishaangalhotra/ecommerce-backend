const mongoose = require('mongoose');

const migration = {
  async up() {
    const db = mongoose.connection.db;
    
    console.log('Enhancing product schema...');
    
    // Add text index for product search
    await db.collection('products').createIndex({
      "name": "text",
      "description": "text",
      "tags": "text"
    });
    console.log('✅ Created product text search index');
    
    // Add index for category-based queries
    await db.collection('products').createIndex({
      "category": 1,
      "status": 1,
      "averageRating": -1
    });
    console.log('✅ Created product category index');
    
    // Add index for seller-based queries
    await db.collection('products').createIndex({
      "seller": 1,
      "status": 1,
      "createdAt": -1
    });
    console.log('✅ Created product seller index');
    
    // Add index for price range queries
    await db.collection('products').createIndex({
      "price": 1,
      "status": 1,
      "stock": 1
    });
    console.log('✅ Created product price index');
    
    // Add index for reviews
    await db.collection('reviews').createIndex({
      "product": 1,
      "rating": -1,
      "createdAt": -1
    });
    console.log('✅ Created reviews index');
    
    // Add index for orders
    await db.collection('orders').createIndex({
      "user": 1,
      "status": 1,
      "createdAt": -1
    });
    console.log('✅ Created orders user index');
    
    // Add index for notifications
    await db.collection('notifications').createIndex({
      "user": 1,
      "isRead": 1,
      "createdAt": -1
    });
    console.log('✅ Created notifications index');
    
    console.log('All product schema enhancements completed!');
  },
  
  async down() {
    const db = mongoose.connection.db;
    
    try {
      await db.collection('products').dropIndex("name_text_description_text_tags_text");
      await db.collection('products').dropIndex("category_1_status_1_averageRating_-1");
      await db.collection('products').dropIndex("seller_1_status_1_createdAt_-1");
      await db.collection('products').dropIndex("price_1_status_1_stock_1");
      await db.collection('reviews').dropIndex("product_1_rating_-1_createdAt_-1");
      await db.collection('orders').dropIndex("user_1_status_1_createdAt_-1");
      await db.collection('notifications').dropIndex("user_1_isRead_1_createdAt_-1");
      
      console.log('Rolled back product schema enhancements');
    } catch (error) {
      console.warn('Some indexes may not exist:', error.message);
    }
  }
};

module.exports = migration;
