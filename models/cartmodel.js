const mongoose = require('mongoose');
const Product = require('./Product');

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Cart must belong to a user'],
    unique: true,
    index: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Item must have a product'],
      validate: {
        validator: async function(productId) {
          const product = await Product.findById(productId);
          return !!product;
        },
        message: 'Product does not exist'
      }
    },
    quantity: {
      type: Number,
      required: [true, 'Item must have a quantity'],
      min: [1, 'Quantity must be at least 1'],
      validate: {
        validator: Number.isInteger,
        message: 'Quantity must be an integer'
      }
    },
    priceAtAddition: {
      type: Number,
      min: 0
    }
  }],
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    index: { expires: 0 } // TTL index
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Document middleware
cartSchema.pre('save', async function(next) {
  try {
    // Set expiration
    this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    // Populate price at addition for new items
    const newItems = this.items.filter(item => !item.priceAtAddition);
    if (newItems.length > 0) {
      const productIds = newItems.map(item => item.product);
      const products = await Product.find({ _id: { $in: productIds } });
      
      const productMap = products.reduce((map, product) => {
        map[product._id] = product.price;
        return map;
      }, {});
      
      this.items.forEach(item => {
        if (!item.priceAtAddition && productMap[item.product]) {
          item.priceAtAddition = productMap[item.product];
        }
      });
    }
    
    next();
  } catch (err) {
    next(err);
  }
});

// Virtuals
cartSchema.virtual('itemCount').get(function() {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

cartSchema.virtual('totalPrice').get(function() {
  return this.items.reduce((sum, item) => sum + (item.quantity * (item.priceAtAddition || 0)), 0);
});

module.exports = mongoose.model('Cart', cartSchema);