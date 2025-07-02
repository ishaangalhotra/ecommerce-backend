const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config(); // Load environment variables from .env file

const userRoutes = require('./routes/users');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
// If you implement other routes (e.g., admin routes), import them here

const app = express();

// ✅ Enable CORS for your Vercel frontend
// IMPORTANT: Replace 'https://my-frontend-ifyr.vercel.app' with your ACTUAL Vercel frontend URL
app.use(cors({
  origin: 'https://my-frontend-ifyr.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Include all methods your frontend might use
  credentials: true // Allow cookies/auth headers to be sent
}));

// Middleware to parse JSON request bodies
app.use(express.json());

// Mount API routes
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB connected');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
  process.exit(1); // Exit process with failure
});

// Port binding for Render (and local development)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});