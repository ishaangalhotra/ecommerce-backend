const mongoose = require('mongoose');
const LocalDeliveryService = require('../services/LocalDeliveryService');
require('dotenv').config();

async function testLocalDeliveryService() {
  try {
    console.log('🧪 Testing LocalDeliveryService...');
    
    await mongoose.connect(process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to database');

    // Test location (Delhi area)
    const userLocation = {
      lat: 28.6139,
      lng: 77.2090
    };

    // Test 1: Find nearby products
    console.log('\n📍 Testing findNearbyProducts...');
    const nearbyProducts = await LocalDeliveryService.findNearbyProducts(userLocation, {
      maxDistance: 10000,
      limit: 5,
      sortBy: 'distance'
    });
    
    console.log(`✅ Found ${nearbyProducts.length} nearby products`);
    if (nearbyProducts.length > 0) {
      console.log('Sample product:', {
        name: nearbyProducts[0].name,
        distance: `${Math.round(nearbyProducts[0].deliveryDistance)}m`,
        estimatedTime: `${nearbyProducts[0].estimatedDeliveryTime} minutes`,
        deliveryFee: `₹${nearbyProducts[0].deliveryFee}`
      });
    }

    console.log('\n🎉 LocalDeliveryService tests completed!');
    
  } catch (error) {
    console.error('❌ Service test failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

testLocalDeliveryService();
