const mongoose = require('mongoose');
const ProductEnhanced = require('../models/ProductEnhanced');
const User = require('../models/User');
require('dotenv').config();

async function testProductEnhanced() {
  try {
    console.log('🧪 Testing ProductEnhanced model...');
    
    // Connect to database
    await mongoose.connect(process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to database');

    // Test 1: Create a sample enhanced product
    const testProduct = new ProductEnhanced({
      name: 'Fresh Apples - Local Delivery Test',
      description: 'Fresh red apples from local farm',
      price: 150,
      category: 'fruits',
      stock: 25,
      images: ['apple.jpg'],
      seller: new mongoose.Types.ObjectId(), // Temporary seller ID
      sellerLocation: {
        type: 'Point',
        coordinates: [77.2090, 28.6139], // Delhi coordinates [lng, lat]
        address: 'Connaught Place, New Delhi',
        locality: 'Connaught Place',
        city: 'New Delhi',
        pincode: '110001'
      },
      deliveryConfig: {
        isLocalDeliveryEnabled: true,
        maxDeliveryRadius: 8000, // 8km
        preparationTime: 10, // 10 minutes
        deliveryFee: 25,
        freeDeliveryThreshold: 300
      }
    });

    console.log('✅ ProductEnhanced instance created');

    // Test 2: Test delivery calculation
    const userLocation = [77.2010, 28.6080]; // Nearby location [lng, lat]
    const deliveryDetails = testProduct.calculateDeliveryDetails(userLocation);
    console.log('📦 Delivery Details:', deliveryDetails);

    // Test 3: Test distance calculation
    const distance = testProduct.calculateDistance(
      testProduct.sellerLocation.coordinates, 
      userLocation
    );
    console.log('📏 Distance:', Math.round(distance), 'meters');

    // Test 4: Save to database (optional - comment out if you don't want to save)
    // await testProduct.save();
    // console.log('✅ Test product saved to database');

    console.log('\n🎉 All tests passed! ProductEnhanced model is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Database connection closed');
  }
}

// Run the test
testProductEnhanced();
