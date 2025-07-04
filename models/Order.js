const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Product name is required'] 
  },
  qty: { 
    type: Number, 
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1']
  },
  image: { 
    type: String, 
    required: [true, 'Product image is required'] 
  },
  price: { 
    type: Number, 
    required: [true, 'Product price is required'],
    min: [0, 'Price must be at least 0']
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product reference is required']
  }
});

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required']
  },
  orderItems: [orderItemSchema],
  shippingAddress: {
    address: { 
      type: String, 
      required: [true, 'Address is required'] 
    },
    city: { 
      type: String, 
      required: [true, 'City is required'] 
    },
    postalCode: { 
      type: String, 
      required: [true, 'Postal code is required'] 
    },
    country: { 
      type: String, 
      required: [true, 'Country is required'] 
    }
  },
  paymentMethod: {
    type: String,
    required: [true, 'Payment method is required'],
    enum: ['Credit Card', 'PayPal', 'COD'],
    default: 'COD'
  },
  paymentResult: {
    id: String,
    status: String,
    update_time: String,
    email_address: String
  },
  itemsPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  taxPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  shippingPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  totalPrice: {
    type: Number,
    required: true,
    default: 0.0
  },
  isPaid: {
    type: Boolean,
    required: true,
    default: false
  },
  paidAt: Date,
  isDelivered: {
    type: Boolean,
    required: true,
    default: false
  },
  deliveredAt: Date,
  status: {
    type: String,
    enum: ['Processing', 'Shipped', 'Delivered', 'Cancelled'],
    default: 'Processing'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Update product stock when order is created
orderSchema.pre('save', async function(next) {
  if (!this.isModified('orderItems')) return next();
  
  await Promise.all(
    this.orderItems.map(async item => {
      const product = await mongoose.model('Product').findById(item.product);
      product.stock -= item.qty;
      await product.save();
    })
  );
  next();
});

module.exports = mongoose.model('Order', orderSchema);