require('dotenv').config();
const mongoose = require('mongoose');

async function testConnection() {
  try {
    console.log('Testing database connection...');
    console.log('Environment variables:');
    console.log('MONGO_URI:', process.env.MONGO_URI ? 'SET' : 'NOT SET');
    console.log('MONGO_DB_NAME:', process.env.MONGO_DB_NAME ? 'SET' : 'NOT SET');
    console.log('DB_NAME:', process.env.DB_NAME ? 'SET' : 'NOT SET');
    
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    const dbName = process.env.MONGO_DB_NAME || process.env.DB_NAME || 'quicklocal';
    
    if (!uri) {
      console.error('❌ No MongoDB URI found in environment variables');
      console.log('Please set MONGO_URI or MONGODB_URI in your .env file');
      return;
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
    
    console.log('✅ Connected to MongoDB successfully!');
    console.log('Database:', mongoose.connection.db.databaseName);
    console.log('Host:', mongoose.connection.host);
    console.log('Port:', mongoose.connection.port);
    
    // Test creating a collection
    const testCollection = mongoose.connection.db.collection('test_migration');
    await testCollection.insertOne({ test: true, timestamp: new Date() });
    console.log('✅ Database write test successful');
    
    await mongoose.disconnect();
    console.log('📡 Connection closed');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
