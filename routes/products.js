const express = require('express');
const router = express.Router();

// ==================== BASIC PRODUCTS ROUTES ====================

// GET /api/products - List all products
router.get('/', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Products API is working!',
      data: {
        products: [
          {
            id: '1',
            name: 'Sample Product 1',
            price: 299.99,
            category: 'Electronics',
            stock: 50,
            image: 'https://via.placeholder.com/300x300?text=Product+1'
          },
          {
            id: '2', 
            name: 'Sample Product 2',
            price: 199.99,
            category: 'Clothing',
            stock: 25,
            image: 'https://via.placeholder.com/300x300?text=Product+2'
          }
        ],
        count: 2,
        page: 1,
        totalPages: 1
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error retrieving products',
      error: error.message,
      requestId: req.requestId
    });
  }
});

// GET /api/products/:id - Get single product
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    res.json({
      success: true,
      message: 'Product retrieved successfully',
      data: {
        product: {
          id: id,
          name: `Sample Product ${id}`,
          description: `This is a detailed description for product ${id}`,
          price: 299.99,
          category: 'Electronics',
          stock: 50,
          images: [
            `https://via.placeholder.com/400x400?text=Product+${id}+Image+1`,
            `https://via.placeholder.com/400x400?text=Product+${id}+Image+2`
          ],
          rating: 4.5,
          reviews: 23,
          seller: {
            name: 'Sample Seller',
            rating: 4.8
          }
        }
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error retrieving product',
      error: error.message,
      requestId: req.requestId
    });
  }
});

// GET /api/products/category/:category - Get products by category
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    
    res.json({
      success: true,
      message: `Products in ${category} category`,
      data: {
        category: category,
        products: [
          {
            id: '1',
            name: `${category} Product 1`,
            price: 299.99,
            stock: 30,
            image: `https://via.placeholder.com/300x300?text=${category}+1`
          },
          {
            id: '2',
            name: `${category} Product 2`, 
            price: 199.99,
            stock: 15,
            image: `https://via.placeholder.com/300x300?text=${category}+2`
          }
        ],
        count: 2
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error retrieving category products',
      error: error.message,
      requestId: req.requestId
    });
  }
});

// GET /api/products/search - Search products
router.get('/search', async (req, res) => {
  try {
    const { q, category, minPrice, maxPrice } = req.query;
    
    res.json({
      success: true,
      message: 'Search results',
      data: {
        query: q,
        filters: {
          category,
          minPrice,
          maxPrice
        },
        products: [
          {
            id: '1',
            name: `Search Result for "${q}"`,
            price: 299.99,
            category: 'Electronics',
            stock: 20,
            image: 'https://via.placeholder.com/300x300?text=Search+Result'
          }
        ],
        count: 1,
        totalResults: 1
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error searching products',
      error: error.message,
      requestId: req.requestId
    });
  }
});

// POST /api/products - Create new product (basic version)
router.post('/', async (req, res) => {
  try {
    const { name, price, category, description } = req.body;
    
    // Basic validation
    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, price, category',
        requestId: req.requestId
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: {
        product: {
          id: Date.now().toString(),
          name,
          price,
          category,
          description,
          stock: 0,
          createdAt: new Date().toISOString()
        }
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating product',
      error: error.message,
      requestId: req.requestId
    });
  }
});

// GET /api/products/test/health - Test endpoint
router.get('/test/health', (req, res) => {
  res.json({
    success: true,
    message: 'Products route health check passed!',
    status: 'OK',
    redis: process.env.DISABLE_REDIS === 'true' ? 'disabled' : 'enabled',
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  });
});

module.exports = router;