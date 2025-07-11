const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true // Faster querying by user
    },
    products: [
      {
        productId: { 
          type: mongoose.Schema.Types.ObjectId, 
          ref: "Product",
          required: true 
        },
        name: { type: String, required: true }, // Reduces DB lookups
        price: { type: Number, required: true }, // Snapshot of price at order time
        qty: { 
          type: Number, 
          required: true,
          min: [1, "Quantity cannot be less than 1"],
          max: [100, "Quantity cannot exceed 100"] 
        },
      },
    ],
    shipping: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      zip: { type: String, required: true },
      country: { type: String, default: "India" }, // Example default
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["COD", "Card", "UPI", "Wallet"], // Restricted values
      default: "COD",
    },
    total: {
      type: Number,
      required: true,
      min: [0, "Total cannot be negative"],
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
      default: "pending",
      index: true // Faster filtering by status
    },
    // placedAt: { type: Date, default: Date.now } → Replaced by timestamps
  },
  { timestamps: true } // Adds createdAt and updatedAt automatically
);

// Indexes for faster queries
orderSchema.index({ user: 1, status: 1 }); // Compound index

module.exports = mongoose.model("Order", orderSchema);