#!/usr/bin/env node
/**
 * MongoDB Index Cleanup Script
 * Fixes IndexKeySpecsConflict errors by dropping and recreating problematic indexes
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

const cleanupIndexes = async () => {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    
    // Collections that might have index conflicts
    const collectionsToClean = ['products', 'productenhanceds', 'categories'];
    
    for (const collectionName of collectionsToClean) {
      try {
        console.log(`\n📋 Processing collection: ${collectionName}`);
        
        // Check if collection exists
        const collections = await db.listCollections({ name: collectionName }).toArray();
        if (collections.length === 0) {
          console.log(`⚠️  Collection ${collectionName} does not exist, skipping...`);
          continue;
        }

        const collection = db.collection(collectionName);
        
        // List all indexes
        const indexes = await collection.indexes();
        console.log(`📊 Found ${indexes.length} indexes in ${collectionName}:`);
        indexes.forEach(index => {
          console.log(`   - ${index.name}: ${JSON.stringify(index.key)}`);
        });

        // Drop problematic slug indexes
        const slugIndexes = indexes.filter(index => 
          index.name.includes('slug') || 
          JSON.stringify(index.key).includes('slug')
        );

        for (const index of slugIndexes) {
          if (index.name !== '_id_') { // Never drop the _id index
            try {
              console.log(`🗑️  Dropping index: ${index.name}`);
              await collection.dropIndex(index.name);
              console.log(`✅ Successfully dropped: ${index.name}`);
            } catch (dropError) {
              console.warn(`⚠️  Could not drop ${index.name}:`, dropError.message);
            }
          }
        }

        // Recreate slug index properly
        if (slugIndexes.length > 0) {
          try {
            console.log(`🔄 Creating new unique slug index for ${collectionName}...`);
            await collection.createIndex(
              { slug: 1 }, 
              { 
                unique: true, 
                sparse: true,
                name: `${collectionName}_slug_unique`
              }
            );
            console.log(`✅ Created unique slug index for ${collectionName}`);
          } catch (createError) {
            console.warn(`⚠️  Could not create slug index for ${collectionName}:`, createError.message);
          }
        }

      } catch (error) {
        console.error(`❌ Error processing ${collectionName}:`, error.message);
      }
    }

    console.log('\n🧹 Index cleanup completed!');

  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Self-executing async function
(async () => {
  await cleanupIndexes();
  process.exit(0);
})();
