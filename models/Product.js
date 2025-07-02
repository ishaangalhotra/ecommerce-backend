const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  price: { type: Number, required: true },
  imageUrl: { type: String, required: true },
  countInStock: { type: Number, default: 0 },
  category: { type: String },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
}, {
  timestamps: true
});

module.exports = mongoose.model("Product", productSchema);
