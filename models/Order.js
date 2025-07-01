const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  items: [
    {
      productId: String,
      name: String,
      price: Number,
      quantity: Number,
    }
  ],
  totalAmount: {
    type: Number,
    required: true,
  },
  shippingAddress: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    default: "Placed",
  },
}, {
  timestamps: true
});

module.exports = mongoose.model("Order", orderSchema);
