const mongoose = require('mongoose');

const migration = {
  async up() {
    const db = mongoose.connection.db;
    console.log('Enhancing product schema...');

    // === TEXT INDEX: SKIP HERE ===
    // We intentionally do NOT create a text index from the migration.
    // The Product model defines a weighted text index (name, description, tags, brand)
    // and that should be the single source of truth. Creating a separate text
    // index here caused the conflict you saw.
    const existingIndexes = await db.collection('products').listIndexes().toArray();
    const hasAnyTextIndex = existingIndexes.some(i =>
      Object.values(i.key || {}).some(v => v === 'text')
    );
    if (hasAnyTextIndex) {
      console.log('🔍 Text index already exists on products — skipping creation (model-level index will own it).');
    } else {
      console.log('ℹ️ No text index currently exists. Skipping creation so Mongoose model can create the weighted index instead.');
    }

    // === Keep the rest of the useful indexes (with explicit names) ===
    await db.collection('products').createIndex(
      { category: 1, status: 1, averageRating: -1 },
      { name: 'products_category_status_rating' }
    );
    console.log('✅ Created product category index');

    await db.collection('products').createIndex(
      { seller: 1, status: 1, createdAt: -1 },
      { name: 'products_seller_status_createdAt' }
    );
    console.log('✅ Created product seller index');

    await db.collection('products').createIndex(
      { price: 1, status: 1, stock: 1 },
      { name: 'products_price_status_stock' }
    );
    console.log('✅ Created product price index');

    await db.collection('reviews').createIndex(
      { product: 1, rating: -1, createdAt: -1 },
      { name: 'reviews_product_rating_createdAt' }
    );
    console.log('✅ Created reviews index');

    await db.collection('orders').createIndex(
      { user: 1, status: 1, createdAt: -1 },
      { name: 'orders_user_status_createdAt' }
    );
    console.log('✅ Created orders user index');

    await db.collection('notifications').createIndex(
      { user: 1, isRead: 1, createdAt: -1 },
      { name: 'notifications_user_isRead_createdAt' }
    );
    console.log('✅ Created notifications index');

    console.log('All product schema enhancements completed!');
  },

  async down() {
    const db = mongoose.connection.db;

    try {
      // helper: drop an index if it exists on a collection
      const dropIfPresent = async (collectionName, indexName) => {
        const coll = db.collection(collectionName);
        const idxs = await coll.listIndexes().toArray();
        const found = idxs.find(i => i.name === indexName);
        if (found) {
          await coll.dropIndex(found.name);
          console.log(`Dropped ${collectionName} index ${found.name}`);
        } else {
          console.log(`No index named "${indexName}" on ${collectionName} - skipping`);
        }
      };

      await dropIfPresent('products', 'products_category_status_rating');
      await dropIfPresent('products', 'products_seller_status_createdAt');
      await dropIfPresent('products', 'products_price_status_stock');
      await dropIfPresent('reviews', 'reviews_product_rating_createdAt');
      await dropIfPresent('orders', 'orders_user_status_createdAt');
      await dropIfPresent('notifications', 'notifications_user_isRead_createdAt');

      // If a SIMPLE 3-field text index (name+description+tags) exists and *only* that,
      // drop it. But DO NOT drop a different text index (like the weighted one with 'brand').
      const prodIdxs = await db.collection('products').listIndexes().toArray();
      const textIdx = prodIdxs.find(i => Object.values(i.key || {}).some(v => v === 'text'));
      if (textIdx) {
        const keys = Object.keys(textIdx.key);
        const simpleSet = ['name', 'description', 'tags'];
        const isSimple = simpleSet.every(k => keys.includes(k)) && keys.length === simpleSet.length;
        if (isSimple) {
          await db.collection('products').dropIndex(textIdx.name);
          console.log(`Dropped simple products text index ${textIdx.name}`);
        } else {
          console.log(`Found a text index (${textIdx.name}) but fields differ — leaving it intact to avoid removing the model-defined weighted index.`);
        }
      }

      console.log('Rolled back product schema enhancements');
    } catch (error) {
      console.warn('Some indexes may not exist or drop failed:', error.message);
    }
  }
};

module.exports = migration;
