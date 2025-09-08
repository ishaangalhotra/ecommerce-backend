// Product Search & Filter System for QuickLocal Quick Commerce
// Optimized for fast product discovery

// ==================== FRONTEND SEARCH INTERFACE ====================

// 1. HTML Structure for Search & Filters
/*
<div class="search-container">
  <div class="search-bar">
    <input type="text" id="product-search" placeholder="Search for groceries, vegetables, fruits..." autocomplete="off">
    <button id="search-btn" type="button">
      <i class="fas fa-search"></i>
    </button>
    <div id="search-suggestions" class="search-suggestions"></div>
  </div>
  
  <div class="filter-container">
    <div class="filter-group">
      <label>Category:</label>
      <select id="category-filter">
        <option value="">All Categories</option>
        <option value="vegetables">Vegetables</option>
        <option value="fruits">Fruits</option>
        <option value="dairy">Dairy & Eggs</option>
        <option value="grocery">Grocery</option>
        <option value="snacks">Snacks</option>
        <option value="beverages">Beverages</option>
      </select>
    </div>
    
    <div class="filter-group">
      <label>Price Range:</label>
      <select id="price-filter">
        <option value="">All Prices</option>
        <option value="0-50">₹0 - ₹50</option>
        <option value="51-100">₹51 - ₹100</option>
        <option value="101-200">₹101 - ₹200</option>
        <option value="201-500">₹201 - ₹500</option>
        <option value="500+">₹500+</option>
      </select>
    </div>
    
    <div class="filter-group">
      <label>Availability:</label>
      <select id="availability-filter">
        <option value="">All Items</option>
        <option value="instock">In Stock Only</option>
        <option value="fastdelivery">Fast Delivery</option>
      </select>
    </div>
    
    <button id="clear-filters" class="btn-clear">Clear Filters</button>
  </div>
</div>

<div id="search-results" class="products-grid">
  <!-- Products will be populated here -->
</div>

<div id="no-results" class="no-results" style="display: none;">
  <h3>No products found</h3>
  <p>Try adjusting your search or filters</p>
</div>
*/

// 2. Frontend JavaScript Implementation
class ProductSearch {
  constructor() {
    this.searchInput = document.getElementById('product-search');
    this.searchBtn = document.getElementById('search-btn');
    this.suggestionsDiv = document.getElementById('search-suggestions');
    this.resultsContainer = document.getElementById('search-results');
    this.noResultsDiv = document.getElementById('no-results');
    
    this.filters = {
      category: document.getElementById('category-filter'),
      price: document.getElementById('price-filter'),
      availability: document.getElementById('availability-filter')
    };
    
    this.currentQuery = '';
    this.currentFilters = {};
    this.searchTimeout = null;
    
    this.init();
  }

  init() {
    // Real-time search as user types
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.performSearch(e.target.value);
      }, 300); // Debounce for 300ms
    });

    // Search button click
    this.searchBtn.addEventListener('click', () => {
      this.performSearch(this.searchInput.value);
    });

    // Enter key search
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.performSearch(this.searchInput.value);
      }
    });

    // Filter changes
    Object.values(this.filters).forEach(filter => {
      filter.addEventListener('change', () => {
        this.updateFilters();
        this.performSearch(this.currentQuery);
      });
    });

    // Clear filters
    document.getElementById('clear-filters')?.addEventListener('click', () => {
      this.clearFilters();
    });

    // Load initial products
    this.loadProducts();
  }

  async performSearch(query) {
    this.currentQuery = query.trim();
    
    if (this.currentQuery.length === 0) {
      this.loadProducts();
      return;
    }

    try {
      this.showLoading();
      
      const searchParams = new URLSearchParams({
        q: this.currentQuery,
        ...this.currentFilters
      });

      const response = await fetch(`/api/v1/products/search?${searchParams}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      if (data.success) {
        this.displayResults(data.products);
        this.trackSearch(this.currentQuery, data.products.length);
      } else {
        this.showError(data.message);
      }
    } catch (error) {
      console.error('Search error:', error);
      this.showError('Search failed. Please try again.');
    }
  }

  async loadProducts() {
    try {
      const response = await fetch('/api/v1/products', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      if (data.success) {
        this.displayResults(data.products);
      }
    } catch (error) {
      console.error('Load products error:', error);
    }
  }

  updateFilters() {
    this.currentFilters = {};
    
    if (this.filters.category.value) {
      this.currentFilters.category = this.filters.category.value;
    }
    
    if (this.filters.price.value) {
      this.currentFilters.priceRange = this.filters.price.value;
    }
    
    if (this.filters.availability.value) {
      this.currentFilters.availability = this.filters.availability.value;
    }
  }

  clearFilters() {
    Object.values(this.filters).forEach(filter => {
      filter.value = '';
    });
    this.currentFilters = {};
    this.performSearch(this.currentQuery);
  }

  displayResults(products) {
    if (!products || products.length === 0) {
      this.resultsContainer.style.display = 'none';
      this.noResultsDiv.style.display = 'block';
      return;
    }

    this.noResultsDiv.style.display = 'none';
    this.resultsContainer.style.display = 'grid';
    
    this.resultsContainer.innerHTML = products.map(product => `
      <div class="product-card" data-product-id="${product._id}">
        <div class="product-image">
          <img src="${product.images?.[0] || '/images/placeholder-product.jpg'}" 
               alt="${product.name}" 
               loading="lazy">
          ${product.stock === 0 ? '<div class="out-of-stock-badge">Out of Stock</div>' : ''}
          ${product.fastDelivery ? '<div class="fast-delivery-badge">Fast Delivery</div>' : ''}
        </div>
        
        <div class="product-info">
          <h3 class="product-name">${product.name}</h3>
          <p class="product-category">${product.category}</p>
          
          <div class="product-pricing">
            <span class="current-price">₹${product.price}</span>
            ${product.originalPrice && product.originalPrice > product.price ? 
              `<span class="original-price">₹${product.originalPrice}</span>
               <span class="discount-badge">${Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}% OFF</span>` 
              : ''}
          </div>
          
          <div class="product-actions">
            <button class="btn-add-cart" 
                    onclick="addToCart('${product._id}')" 
                    ${product.stock === 0 ? 'disabled' : ''}>
              ${product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
            </button>
            <button class="btn-wishlist" onclick="toggleWishlist('${product._id}')">
              <i class="far fa-heart"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  showLoading() {
    this.resultsContainer.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <p>Searching products...</p>
      </div>
    `;
  }

  showError(message) {
    this.resultsContainer.innerHTML = `
      <div class="error-container">
        <h3>Search Error</h3>
        <p>${message}</p>
        <button onclick="location.reload()" class="btn-retry">Try Again</button>
      </div>
    `;
  }

  trackSearch(query, resultsCount) {
    // Analytics tracking
    if (typeof gtag !== 'undefined') {
      gtag('event', 'search', {
        search_term: query,
        results_count: resultsCount
      });
    }
  }
}

// Initialize search when page loads
document.addEventListener('DOMContentLoaded', () => {
  new ProductSearch();
});

// ==================== BACKEND SEARCH ROUTES ====================
// Add this route to your products.js routes file

/*
// Enhanced product search route
router.get('/search', async (req, res) => {
  try {
    const { 
      q, 
      category, 
      priceRange, 
      availability, 
      page = 1, 
      limit = 20,
      sortBy = 'relevance'
    } = req.query;

    let query = { isActive: true };
    
    // Text search
    if (q && q.trim()) {
      query.$or = [
        { name: { $regex: q.trim(), $options: 'i' } },
        { description: { $regex: q.trim(), $options: 'i' } },
        { category: { $regex: q.trim(), $options: 'i' } },
        { tags: { $in: [new RegExp(q.trim(), 'i')] } }
      ];
    }

    // Category filter
    if (category && category !== '') {
      query.category = new RegExp(category, 'i');
    }

    // Price range filter
    if (priceRange && priceRange !== '') {
      if (priceRange === '500+') {
        query.price = { $gte: 500 };
      } else if (priceRange.includes('-')) {
        const [min, max] = priceRange.split('-').map(Number);
        query.price = { $gte: min, $lte: max };
      }
    }

    // Availability filter
    if (availability && availability !== '') {
      if (availability === 'instock') {
        query.stock = { $gt: 0 };
      } else if (availability === 'fastdelivery') {
        query.fastDelivery = true;
      }
    }

    // Sorting
    let sortOptions = {};
    switch (sortBy) {
      case 'price-low':
        sortOptions.price = 1;
        break;
      case 'price-high':
        sortOptions.price = -1;
        break;
      case 'newest':
        sortOptions.createdAt = -1;
        break;
      case 'rating':
        sortOptions.averageRating = -1;
        break;
      default:
        // Relevance sorting (text score if search query exists)
        if (q && q.trim()) {
          sortOptions = { score: { $meta: 'textScore' } };
        } else {
          sortOptions.createdAt = -1;
        }
    }

    // Execute search with pagination
    const skip = (page - 1) * limit;
    
    const products = await Product.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('seller', 'storeName rating')
      .lean();

    // Get total count for pagination
    const totalProducts = await Product.countDocuments(query);

    // Add search suggestions if query exists
    let suggestions = [];
    if (q && q.trim() && products.length < 5) {
      const suggestionQuery = {
        isActive: true,
        $or: [
          { name: { $regex: q.trim().substring(0, 3), $options: 'i' } },
          { category: { $regex: q.trim().substring(0, 3), $options: 'i' } }
        ]
      };
      
      suggestions = await Product.find(suggestionQuery)
        .select('name category')
        .limit(5)
        .lean();
    }

    res.json({
      success: true,
      products,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalProducts / limit),
        totalProducts,
        hasNext: skip + products.length < totalProducts,
        hasPrev: page > 1
      },
      suggestions,
      searchQuery: q,
      appliedFilters: {
        category,
        priceRange,
        availability
      }
    });

  } catch (error) {
    console.error('Product search error:', error);
    res.status(500).json({
      success: false,
      message: 'Product search failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Search error'
    });
  }
});

// Quick search suggestions route (for autocomplete)
router.get('/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({
        success: true,
        suggestions: []
      });
    }

    const suggestions = await Product.aggregate([
      {
        $match: {
          isActive: true,
          $or: [
            { name: { $regex: q.trim(), $options: 'i' } },
            { category: { $regex: q.trim(), $options: 'i' } }
          ]
        }
      },
      {
        $project: {
          name: 1,
          category: 1,
          images: { $arrayElemAt: ['$images', 0] },
          price: 1
        }
      },
      { $limit: 8 }
    ]);

    res.json({
      success: true,
      suggestions
    });

  } catch (error) {
    console.error('Search suggestions error:', error);
    res.json({
      success: true,
      suggestions: []
    });
  }
});
*/

// ==================== CSS STYLING ====================
/*
.search-container {
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  margin-bottom: 20px;
}

.search-bar {
  position: relative;
  margin-bottom: 20px;
}

.search-bar input {
  width: 100%;
  padding: 15px 50px 15px 20px;
  border: 2px solid #e1e5e9;
  border-radius: 25px;
  font-size: 16px;
  transition: border-color 0.3s;
}

.search-bar input:focus {
  outline: none;
  border-color: #007bff;
}

.search-bar button {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: #007bff;
  color: white;
  border: none;
  padding: 10px 15px;
  border-radius: 50%;
  cursor: pointer;
}

.filter-container {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  align-items: center;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.filter-group label {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
}

.filter-group select {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.btn-clear {
  background: #f8f9fa;
  color: #6c757d;
  border: 1px solid #ddd;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.products-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.product-card {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  transition: transform 0.2s;
}

.product-card:hover {
  transform: translateY(-2px);
}

.product-image {
  position: relative;
  height: 200px;
  overflow: hidden;
}

.product-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fast-delivery-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: #28a745;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.out-of-stock-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(255,255,255,0.9);
  color: #dc3545;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
}

.loading-container, .error-container, .no-results {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .filter-container {
    flex-direction: column;
    align-items: stretch;
  }
  
  .products-grid {
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 15px;
  }
}
*/
