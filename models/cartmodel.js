const mongoose = require('mongoose');
const Product = require('./productModel'); // Make sure productModel path is correct

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Cart must belong to a user'],
    index: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Cart must contain a product'],
    index: true
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1'],
    max: [100, 'Cannot add more than 100 units of a single product'],
    validate: {
      validator: Number.isInteger,
      message: 'Quantity must be an integer'
    }
  },
  priceAtAddition: {
    type: Number,
    required: [true, 'Price snapshot is required'],
    min: [0, 'Price cannot be negative']
  },
  size: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: [20, 'Size cannot exceed 20 characters']
  },
  color: {
    type: String,
    trim: true,
    maxlength: [30, 'Color description cannot exceed 30 characters']
  },
  selectedVariants: [{
    name: {
      type: String,
      required: [true, 'Variant name is required'],
      trim: true
    },
    value: {
      type: String,
      required: [true, 'Variant value is required'],
      trim: true
    }
  }],
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days TTL
    index: { expires: 0 } // TTL index
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual property
cartSchema.virtual('currentTotal').get(function() {
  return this.quantity * this.priceAtAddition;
});

// Indexes
cartSchema.index({ user: 1, product: 1, size: 1, color: 1 }, { unique: true });

// Middleware
cartSchema.pre('save', async function(next) {
  if (this.isNew) {
    const product = await Product.findById(this.product);
    if (!product) throw new Error('Product not found');
    if (product.stock < this.quantity) {
      throw new Error(`Only ${product.stock} units available`);
    }
    this.priceAtAddition = product.discountedPrice || product.price;
  }
  next();
});

cartSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'product',
    select: 'name price discountedPrice images stock slug'
  });
  next();
});

// Static Methods
cartSchema.statics.getCartSummary = async function(userId) {
  return this.aggregate([
    { $match: { user: mongoose.Types.ObjectId(userId) } },
    {
      $lookup: {
        from: 'products',
        localField: 'product',
        foreignField: '_id',
        as: 'productDetails'
      }
    },
    { $unwind: '$productDetails' },
    {
      $group: {
        _id: null,
        totalItems: { $sum: '$quantity' },
        subtotal: {
          $sum: {
            $multiply: [
              '$quantity',
              { $ifNull: ['$productDetails.discountedPrice', '$productDetails.price'] }
            ]
          }
        },
        savings: {
          $sum: {
            $cond: [
              { $gt: ['$productDetails.discountedPrice', 0] },
              { $multiply: [
                '$quantity',
                { $subtract: ['$productDetails.price', '$productDetails.discountedPrice'] }
              ]},
              0
            ]
          }
        }
      }
    },
    {
      $project: {
        _id: 0,
        totalItems: 1,
        subtotal: 1,
        savings: 1,
        total: { $add: ['$subtotal', 50] } // Example shipping
      }
    }
  ]);
};

const Cart = mongoose.model('Cart', cartSchema);
module.exports = Cart;