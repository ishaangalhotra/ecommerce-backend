const mongoose = require('mongoose');

// Import your existing Product model to extend it
const Product = require('./Product');

// Clone the existing schema to preserve all current functionality
const enhancedProductSchema = Product.schema.clone();

// Add new fields for local delivery without breaking existing data
enhancedProductSchema.add({
  // Location data for geospatial queries
  sellerLocation: {
    type: {
      type: String,
      default: 'Point',
      enum: ['Point']
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0],
      validate: {
        validator: function(coords) {
          return Array.isArray(coords) && coords.length === 2 &&
                 coords[0] >= -180 && coords[0] <= 180 && // longitude
                 coords[1] >= -90 && coords[1] <= 90;     // latitude
        },
        message: 'Coordinates must be [longitude, latitude] within valid ranges'
      }
    },
    address: { type: String, default: '' },
    locality: { type: String, default: '' },
    city: { type: String, default: '' },
    pincode: {
      type: String,
      default: ''
      // REMOVED: index: true
    },
    landmark: { type: String, default: '' }
  },

  // Delivery configuration
  deliveryConfig: {
    isLocalDeliveryEnabled: { type: Boolean, default: false },
    maxDeliveryRadius: {
      type: Number,
      default: 5000, // 5km in meters
      min: 500,      // minimum 500m
      max: 20000     // maximum 20km
    },
    preparationTime: {
      type: Number,
      default: 10,   // minutes
      min: 5,
      max: 60
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: 0
    },
    freeDeliveryThreshold: {
      type: Number,
      default: 500 // Free delivery above ₹500
    },
    availableTimeSlots: [{
      day: {
        type: String,
        enum: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
      },
      startTime: { type: String, default: '09:00' }, // "HH:MM" format
      endTime: { type: String, default: '21:00' },
      isAvailable: { type: Boolean, default: true },
      maxOrdersPerHour: { type: Number, default: 10 }
    }],
    expressDeliveryAvailable: { type: Boolean, default: true },
    expressDeliveryFee: { type: Number, default: 20 }
  },

  // Performance metrics for optimization
  deliveryMetrics: {
    totalDeliveries: { type: Number, default: 0 },
    averageDeliveryTime: { type: Number, default: 0 }, // in minutes
    successfulDeliveries: { type: Number, default: 0 },
    failedDeliveries: { type: Number, default: 0 },
    averageRating: { type: Number, default: 5.0, min: 1, max: 5 },
    lastDeliveryDate: { type: Date },
    fastestDelivery: { type: Number, default: 0 }, // in minutes
    slowestDelivery: { type: Number, default: 0 }  // in minutes
  }
});

// Add indexes for optimal performance
// REMOVED: enhancedProductSchema.index({ "sellerLocation": "2dsphere" }); // This is already inherited from product.js
enhancedProductSchema.index({
  "sellerLocation.pincode": 1,
  "deliveryConfig.isLocalDeliveryEnabled": 1,
  "status": 1,
  "stock": 1
});

// Pre-save middleware to set location from seller data
enhancedProductSchema.pre('save', async function(next) {
  if (this.isNew || this.isModified('seller')) {
    try {
      // Get seller location if not set
      if (this.sellerLocation.coordinates[0] === 0 && this.sellerLocation.coordinates[1] === 0) {
        const User = mongoose.model('User');
        const seller = await User.findById(this.seller);

        if (seller && seller.location && seller.location.coordinates && seller.location.coordinates.length === 2) {
          this.sellerLocation = {
            type: 'Point',
            coordinates: seller.location.coordinates,
            address: seller.location.address || '',
            locality: seller.location.locality || '',
            city: seller.location.city || '',
            pincode: seller.location.pincode || ''
          };
          this.deliveryConfig.isLocalDeliveryEnabled = true;
        }
      }
    } catch (error) {
      console.warn('Could not auto-set seller location:', error.message);
    }
  }
  next();
});

// Method to calculate delivery details
enhancedProductSchema.methods.calculateDeliveryDetails = function(userLocation) {
  if (!this.deliveryConfig.isLocalDeliveryEnabled) {
    return { canDeliver: false, reason: 'Local delivery not available' };
  }

  // Calculate distance using Haversine formula
  const distance = this.calculateDistance(userLocation, this.sellerLocation.coordinates);

  if (distance > this.deliveryConfig.maxDeliveryRadius) {
    return {
      canDeliver: false,
      reason: 'Outside delivery radius',
      distance
    };
  }

  // Calculate delivery time (preparation + travel time)
  const travelTime = Math.ceil(distance / 250); // ~15 km/h average speed
  const totalTime = this.deliveryConfig.preparationTime + travelTime;

  // Calculate delivery fee
  let deliveryFee = 0;
  if (distance > 2000) { // Free delivery under 2km
    deliveryFee = this.deliveryConfig.deliveryFee || 25;
  }

  return {
    canDeliver: true,
    distance: Math.round(distance),
    estimatedTime: totalTime,
    deliveryFee,
    preparationTime: this.deliveryConfig.preparationTime,
    travelTime
  };
};

// Method to calculate distance between two points
enhancedProductSchema.methods.calculateDistance = function([lng1, lat1], [lng2, lat2]) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lng2-lng1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
};

// Create the enhanced model
const ProductEnhanced = mongoose.model('ProductEnhanced', enhancedProductSchema);

module.exports = ProductEnhanced;