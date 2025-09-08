// Advanced UX Features for E-commerce Platform
class AdvancedUXFeatures {
  
  constructor() {
    this.recentlyViewed = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    this.compareList = JSON.parse(localStorage.getItem('compareList') || '[]');
    this.userPreferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    this.currentFilters = new Map();
    this.initialize();
  }

  initialize() {
    this.setupQuickView();
    this.setupProductComparison();
    this.setupRecentlyViewed();
    this.setupSmartFilters();
    this.setupRecommendationEngine();
    this.injectStyles();
    console.log('🎨 Advanced UX Features initialized');
  }

  // Quick View Modal System
  setupQuickView() {
    this.createQuickViewModal();
    
    // Add event listeners to existing quick view buttons
    document.addEventListener('click', (e) => {
      if (e.target.matches('.quick-view-btn, .quick-view-btn *')) {
        e.preventDefault();
        const btn = e.target.closest('.quick-view-btn');
        const productId = btn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (productId) {
          this.openQuickView(productId);
        }
      }
    });
  }

  createQuickViewModal() {
    const modal = document.createElement('div');
    modal.id = 'quickViewModal';
    modal.className = 'quick-view-modal';
    modal.innerHTML = `
      <div class="modal-overlay" onclick="uxFeatures.closeQuickView()"></div>
      <div class="modal-content">
        <button class="modal-close" onclick="uxFeatures.closeQuickView()">&times;</button>
        <div class="modal-body">
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Loading product details...</p>
          </div>
          <div class="product-details" style="display: none;"></div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }

  async openQuickView(productId) {
    const modal = document.getElementById('quickViewModal');
    const loadingState = modal.querySelector('.loading-state');
    const productDetails = modal.querySelector('.product-details');
    
    modal.classList.add('active');
    loadingState.style.display = 'block';
    productDetails.style.display = 'none';
    
    try {
      const response = await fetch(`${API_BASE_URL}/products/${productId}`);
      const data = await response.json();
      
      if (data.success) {
        this.renderQuickViewProduct(data.product, productDetails);
        this.trackProductView(productId);
        
        loadingState.style.display = 'none';
        productDetails.style.display = 'block';
      } else {
        this.showQuickViewError('Product not found');
      }
    } catch (error) {
      console.error('Quick view error:', error);
      this.showQuickViewError('Failed to load product details');
    }
  }

  renderQuickViewProduct(product, container) {
    const images = product.images || [];
    const mainImage = images[0] || '/images/placeholder.jpg';
    
    container.innerHTML = `
      <div class="quick-view-layout">
        <div class="product-images">
          <div class="main-image">
            <img src="${mainImage}" alt="${product.name}" id="quickViewMainImage">
            ${product.stock === 0 ? '<div class="out-of-stock-overlay">Out of Stock</div>' : ''}
          </div>
          ${images.length > 1 ? `
            <div class="image-thumbnails">
              ${images.map((img, index) => `
                <img src="${img}" alt="${product.name}" 
                     onclick="uxFeatures.changeQuickViewImage('${img}')"
                     class="thumbnail ${index === 0 ? 'active' : ''}">
              `).join('')}
            </div>
          ` : ''}
        </div>
        <div class="product-info">
          <h2 class="product-title">${product.name}</h2>
          ${product.brand ? `<p class="product-brand">${product.brand}</p>` : ''}
          
          <div class="rating-section">
            ${this.renderStars(product.averageRating || 0)}
            <span class="rating-text">(${product.reviewCount || 0} reviews)</span>
          </div>
          
          <div class="price-section">
            <span class="current-price">$${product.price}</span>
            ${product.originalPrice && product.originalPrice > product.price ? 
              `<span class="original-price">$${product.originalPrice}</span>
               <span class="discount-badge">${Math.round((1 - product.price/product.originalPrice) * 100)}% OFF</span>` 
              : ''
            }
          </div>
          
          <div class="product-description">
            <p>${product.description || 'No description available.'}</p>
          </div>
          
          ${product.specifications ? `
            <div class="key-features">
              <h4>Key Features:</h4>
              <ul>
                ${Object.entries(product.specifications).slice(0, 4).map(([key, value]) => 
                  `<li><strong>${key}:</strong> ${value}</li>`
                ).join('')}
              </ul>
            </div>
          ` : ''}
          
          <div class="stock-info">
            ${product.stock > 0 ? 
              `<span class="in-stock">✅ ${product.stock} in stock</span>` :
              `<span class="out-of-stock">❌ Out of stock</span>`
            }
          </div>
          
          <div class="quick-actions">
            <div class="quantity-selector">
              <label>Quantity:</label>
              <div class="quantity-controls">
                <button onclick="uxFeatures.changeQuantity(-1)" ${product.stock === 0 ? 'disabled' : ''}>-</button>
                <input type="number" id="quickViewQuantity" value="1" min="1" max="${product.stock}" ${product.stock === 0 ? 'disabled' : ''}>
                <button onclick="uxFeatures.changeQuantity(1)" ${product.stock === 0 ? 'disabled' : ''}>+</button>
              </div>
            </div>
            
            <div class="action-buttons">
              <button class="btn-primary add-to-cart" 
                      onclick="uxFeatures.addToCartFromQuickView('${product._id}')"
                      ${product.stock === 0 ? 'disabled' : ''}>
                ${product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
              </button>
              
              <button class="btn-secondary add-to-wishlist ${product.inWishlist ? 'active' : ''}" 
                      onclick="uxFeatures.toggleWishlistFromQuickView('${product._id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
                Wishlist
              </button>
              
              <button class="btn-secondary add-to-compare" 
                      onclick="uxFeatures.addToCompare('${product._id}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="18 6 6 18M6 6l12 12"></path>
                </svg>
                Compare
              </button>
            </div>
            
            <button class="view-full-details" onclick="uxFeatures.viewFullProduct('${product._id}')">
              View Full Details →
            </button>
          </div>
        </div>
      </div>
    `;
  }

  changeQuickViewImage(imageSrc) {
    const mainImage = document.getElementById('quickViewMainImage');
    mainImage.src = imageSrc;
    
    // Update active thumbnail
    document.querySelectorAll('.image-thumbnails .thumbnail').forEach(thumb => {
      thumb.classList.remove('active');
      if (thumb.src === imageSrc) {
        thumb.classList.add('active');
      }
    });
  }

  changeQuantity(delta) {
    const quantityInput = document.getElementById('quickViewQuantity');
    const currentValue = parseInt(quantityInput.value) || 1;
    const newValue = Math.max(1, Math.min(currentValue + delta, parseInt(quantityInput.max) || 999));
    quantityInput.value = newValue;
  }

  async addToCartFromQuickView(productId) {
    const quantity = parseInt(document.getElementById('quickViewQuantity')?.value) || 1;
    
    try {
      const response = await fetch(`${API_BASE_URL}/cart/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ productId, quantity })
      });

      const data = await response.json();
      
      if (data.success) {
        this.showNotification('Product added to cart!', 'success');
        this.updateCartCount();
      } else {
        this.showNotification(data.message || 'Failed to add to cart', 'error');
      }
    } catch (error) {
      console.error('Add to cart error:', error);
      this.showNotification('Failed to add product to cart', 'error');
    }
  }

  closeQuickView() {
    const modal = document.getElementById('quickViewModal');
    modal.classList.remove('active');
  }

  // Product Comparison System
  setupProductComparison() {
    this.createComparisonBar();
    this.updateComparisonBar();
  }

  createComparisonBar() {
    const compareBar = document.createElement('div');
    compareBar.id = 'comparisonBar';
    compareBar.className = 'comparison-bar';
    compareBar.innerHTML = `
      <div class="compare-content">
        <div class="compare-info">
          <span class="compare-text">Compare Products</span>
          <span class="compare-count">0 items</span>
        </div>
        <div class="compare-items"></div>
        <div class="compare-actions">
          <button class="btn-primary compare-now" onclick="uxFeatures.openComparison()" disabled>
            Compare Now
          </button>
          <button class="btn-secondary clear-all" onclick="uxFeatures.clearComparison()">
            Clear All
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(compareBar);
  }

  addToCompare(productId) {
    // Limit to 4 products for comparison
    if (this.compareList.length >= 4) {
      this.showNotification('You can compare up to 4 products only', 'warning');
      return;
    }
    
    // Check if already in compare list
    if (this.compareList.some(item => item.id === productId)) {
      this.showNotification('Product is already in comparison', 'info');
      return;
    }
    
    // Add to compare list
    this.compareList.push({
      id: productId,
      addedAt: new Date().toISOString()
    });
    
    this.saveCompareList();
    this.updateComparisonBar();
    this.showNotification('Product added to comparison', 'success');
  }

  removeFromCompare(productId) {
    this.compareList = this.compareList.filter(item => item.id !== productId);
    this.saveCompareList();
    this.updateComparisonBar();
    this.showNotification('Product removed from comparison', 'info');
  }

  clearComparison() {
    this.compareList = [];
    this.saveCompareList();
    this.updateComparisonBar();
    this.showNotification('Comparison list cleared', 'info');
  }

  async updateComparisonBar() {
    const compareBar = document.getElementById('comparisonBar');
    const compareCount = compareBar.querySelector('.compare-count');
    const compareItems = compareBar.querySelector('.compare-items');
    const compareBtn = compareBar.querySelector('.compare-now');
    
    compareCount.textContent = `${this.compareList.length} items`;
    compareBtn.disabled = this.compareList.length < 2;
    
    if (this.compareList.length === 0) {
      compareBar.classList.remove('active');
      return;
    }
    
    compareBar.classList.add('active');
    
    // Load product details for comparison bar
    const productPromises = this.compareList.map(async (item) => {
      try {
        const response = await fetch(`${API_BASE_URL}/products/${item.id}`);
        const data = await response.json();
        return data.success ? data.product : null;
      } catch (error) {
        console.error('Error loading compare product:', error);
        return null;
      }
    });
    
    const products = await Promise.all(productPromises);
    
    compareItems.innerHTML = products
      .filter(Boolean)
      .map(product => `
        <div class="compare-item">
          <img src="${product.images?.[0] || '/images/placeholder.jpg'}" alt="${product.name}">
          <span class="product-name">${product.name}</span>
          <button class="remove-compare" onclick="uxFeatures.removeFromCompare('${product._id}')">&times;</button>
        </div>
      `).join('');
  }

  async openComparison() {
    if (this.compareList.length < 2) {
      this.showNotification('Please add at least 2 products to compare', 'warning');
      return;
    }
    
    // Create comparison modal
    this.createComparisonModal();
    
    // Load and display products
    const modal = document.getElementById('comparisonModal');
    const loadingState = modal.querySelector('.loading-state');
    const comparisonContent = modal.querySelector('.comparison-content');
    
    modal.classList.add('active');
    loadingState.style.display = 'block';
    comparisonContent.style.display = 'none';
    
    try {
      const productPromises = this.compareList.map(async (item) => {
        const response = await fetch(`${API_BASE_URL}/products/${item.id}`);
        const data = await response.json();
        return data.success ? data.product : null;
      });
      
      const products = (await Promise.all(productPromises)).filter(Boolean);
      
      this.renderProductComparison(products, comparisonContent);
      
      loadingState.style.display = 'none';
      comparisonContent.style.display = 'block';
      
    } catch (error) {
      console.error('Comparison error:', error);
      this.showNotification('Failed to load comparison', 'error');
      this.closeComparison();
    }
  }

  createComparisonModal() {
    // Remove existing modal if any
    const existing = document.getElementById('comparisonModal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'comparisonModal';
    modal.className = 'comparison-modal';
    modal.innerHTML = `
      <div class="modal-overlay" onclick="uxFeatures.closeComparison()"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h2>Product Comparison</h2>
          <button class="modal-close" onclick="uxFeatures.closeComparison()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Loading comparison...</p>
          </div>
          <div class="comparison-content" style="display: none;"></div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }

  renderProductComparison(products, container) {
    // Get all unique specifications
    const allSpecs = new Set();
    products.forEach(product => {
      if (product.specifications) {
        Object.keys(product.specifications).forEach(spec => allSpecs.add(spec));
      }
    });
    
    container.innerHTML = `
      <div class="comparison-table">
        <div class="comparison-row header-row">
          <div class="comparison-cell feature-cell">
            <strong>Features</strong>
          </div>
          ${products.map(product => `
            <div class="comparison-cell product-cell">
              <div class="product-header">
                <img src="${product.images?.[0] || '/images/placeholder.jpg'}" alt="${product.name}">
                <h4>${product.name}</h4>
                <div class="product-rating">
                  ${this.renderStars(product.averageRating || 0)}
                </div>
                <div class="product-price">$${product.price}</div>
                <button class="btn-primary" onclick="uxFeatures.viewFullProduct('${product._id}')">
                  View Details
                </button>
              </div>
            </div>
          `).join('')}
        </div>
        
        <div class="comparison-row">
          <div class="comparison-cell feature-cell">Price</div>
          ${products.map(product => `
            <div class="comparison-cell">
              <span class="price-value">$${product.price}</span>
              ${product.originalPrice && product.originalPrice > product.price ? 
                `<span class="original-price">$${product.originalPrice}</span>` : ''
              }
            </div>
          `).join('')}
        </div>
        
        <div class="comparison-row">
          <div class="comparison-cell feature-cell">Rating</div>
          ${products.map(product => `
            <div class="comparison-cell">
              ${this.renderStars(product.averageRating || 0)}
              <span>(${product.reviewCount || 0})</span>
            </div>
          `).join('')}
        </div>
        
        <div class="comparison-row">
          <div class="comparison-cell feature-cell">Stock</div>
          ${products.map(product => `
            <div class="comparison-cell">
              ${product.stock > 0 ? 
                `<span class="in-stock">In Stock (${product.stock})</span>` :
                `<span class="out-of-stock">Out of Stock</span>`
              }
            </div>
          `).join('')}
        </div>
        
        ${Array.from(allSpecs).map(spec => `
          <div class="comparison-row">
            <div class="comparison-cell feature-cell">${spec}</div>
            ${products.map(product => `
              <div class="comparison-cell">
                ${product.specifications?.[spec] || 'N/A'}
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }

  closeComparison() {
    const modal = document.getElementById('comparisonModal');
    if (modal) modal.remove();
  }

  // Recently Viewed Products
  trackProductView(productId) {
    // Remove if already exists
    this.recentlyViewed = this.recentlyViewed.filter(item => item.id !== productId);
    
    // Add to beginning
    this.recentlyViewed.unshift({
      id: productId,
      viewedAt: new Date().toISOString()
    });
    
    // Keep only last 20 items
    this.recentlyViewed = this.recentlyViewed.slice(0, 20);
    
    this.saveRecentlyViewed();
    this.updateRecentlyViewedWidget();
  }

  setupRecentlyViewed() {
    this.createRecentlyViewedWidget();
    this.updateRecentlyViewedWidget();
  }

  createRecentlyViewedWidget() {
    const widget = document.createElement('div');
    widget.id = 'recentlyViewedWidget';
    widget.className = 'recently-viewed-widget';
    widget.innerHTML = `
      <div class="widget-header">
        <h3>Recently Viewed</h3>
        <button class="clear-recent" onclick="uxFeatures.clearRecentlyViewed()">Clear</button>
      </div>
      <div class="widget-content">
        <div class="recent-products"></div>
      </div>
    `;
    
    // Add to sidebar or bottom of page
    const sidebar = document.querySelector('.sidebar') || document.body;
    sidebar.appendChild(widget);
  }

  async updateRecentlyViewedWidget() {
    const widget = document.getElementById('recentlyViewedWidget');
    if (!widget) return;
    
    const recentProducts = widget.querySelector('.recent-products');
    
    if (this.recentlyViewed.length === 0) {
      widget.style.display = 'none';
      return;
    }
    
    widget.style.display = 'block';
    
    // Load recent product details
    const productPromises = this.recentlyViewed.slice(0, 6).map(async (item) => {
      try {
        const response = await fetch(`${API_BASE_URL}/products/${item.id}`);
        const data = await response.json();
        return data.success ? data.product : null;
      } catch (error) {
        console.error('Error loading recent product:', error);
        return null;
      }
    });
    
    const products = (await Promise.all(productPromises)).filter(Boolean);
    
    recentProducts.innerHTML = products.map(product => `
      <div class="recent-product-item">
        <img src="${product.images?.[0] || '/images/placeholder.jpg'}" alt="${product.name}">
        <div class="product-info">
          <h5>${product.name}</h5>
          <span class="price">$${product.price}</span>
        </div>
        <button class="view-product" onclick="uxFeatures.viewFullProduct('${product._id}')">View</button>
      </div>
    `).join('');
  }

  clearRecentlyViewed() {
    this.recentlyViewed = [];
    this.saveRecentlyViewed();
    this.updateRecentlyViewedWidget();
    this.showNotification('Recently viewed products cleared', 'info');
  }

  // Smart Filters
  setupSmartFilters() {
    this.createSmartFilterWidget();
    this.initializeSmartFilters();
  }

  createSmartFilterWidget() {
    const filterWidget = document.createElement('div');
    filterWidget.id = 'smartFiltersWidget';
    filterWidget.className = 'smart-filters-widget';
    filterWidget.innerHTML = `
      <div class="widget-header">
        <h3>Smart Filters</h3>
        <button class="reset-filters" onclick="uxFeatures.resetSmartFilters()">Reset</button>
      </div>
      <div class="widget-content">
        <div class="smart-filter-group">
          <label>Price Range</label>
          <div class="price-range-slider">
            <input type="range" id="minPrice" min="0" max="1000" value="0">
            <input type="range" id="maxPrice" min="0" max="1000" value="1000">
            <div class="price-values">
              <span id="minPriceValue">$0</span> - <span id="maxPriceValue">$1000</span>
            </div>
          </div>
        </div>
        
        <div class="smart-filter-group">
          <label>Rating</label>
          <div class="rating-filters">
            ${[4, 3, 2, 1].map(rating => `
              <label class="rating-filter">
                <input type="checkbox" value="${rating}">
                ${this.renderStars(rating)} & above
              </label>
            `).join('')}
          </div>
        </div>
        
        <div class="smart-filter-group">
          <label>Availability</label>
          <div class="availability-filters">
            <label><input type="checkbox" value="inStock"> In Stock</label>
            <label><input type="checkbox" value="fastDelivery"> Fast Delivery</label>
            <label><input type="checkbox" value="onSale"> On Sale</label>
          </div>
        </div>
        
        <div class="smart-filter-group">
          <label>Brand</label>
          <div class="brand-filters">
            <div class="brand-list"></div>
          </div>
        </div>
        
        <button class="apply-filters-btn" onclick="uxFeatures.applySmartFilters()">
          Apply Filters
        </button>
      </div>
    `;
    
    // Add to filters section
    const filtersSection = document.querySelector('.filters-container') || document.body;
    filtersSection.appendChild(filterWidget);
  }

  // Recommendation Engine
  setupRecommendationEngine() {
    this.createRecommendationWidgets();
    this.loadRecommendations();
  }

  async loadRecommendations() {
    // Load different types of recommendations
    await Promise.all([
      this.loadPersonalizedRecommendations(),
      this.loadTrendingProducts(),
      this.loadSimilarProducts()
    ]);
  }

  async loadPersonalizedRecommendations() {
    try {
      const response = await fetch(`${API_BASE_URL}/recommendations/personalized`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      const data = await response.json();
      
      if (data.success && data.recommendations.length > 0) {
        this.renderRecommendationWidget('personalized', data.recommendations);
      }
    } catch (error) {
      console.error('Personalized recommendations error:', error);
    }
  }

  // Utility Functions
  renderStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    let stars = '';
    
    for (let i = 0; i < fullStars; i++) {
      stars += '<span class="star filled">★</span>';
    }
    
    if (hasHalfStar) {
      stars += '<span class="star half">★</span>';
    }
    
    for (let i = 0; i < emptyStars; i++) {
      stars += '<span class="star empty">☆</span>';
    }

    return `<div class="stars">${stars}</div>`;
  }

  viewFullProduct(productId) {
    window.location.href = `/product.html?id=${productId}`;
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `ux-notification ${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">&times;</button>
      </div>
    `;
    
    // Add to notification container or create one
    let container = document.getElementById('notificationContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notificationContainer';
      container.className = 'notification-container';
      document.body.appendChild(container);
    }
    
    container.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }

  // Storage functions
  saveRecentlyViewed() {
    localStorage.setItem('recentlyViewed', JSON.stringify(this.recentlyViewed));
  }

  saveCompareList() {
    localStorage.setItem('compareList', JSON.stringify(this.compareList));
  }

  saveUserPreferences() {
    localStorage.setItem('userPreferences', JSON.stringify(this.userPreferences));
  }

  // Inject required CSS
  injectStyles() {
    const style = document.createElement('style');
    style.id = 'advancedUXStyles';
    style.textContent = `
      /* Quick View Modal Styles */
      .quick-view-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        display: none;
      }

      .quick-view-modal.active {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(5px);
      }

      .modal-content {
        position: relative;
        background: white;
        border-radius: 12px;
        max-width: 90vw;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        animation: modalAppear 0.3s ease-out;
      }

      @keyframes modalAppear {
        from {
          opacity: 0;
          transform: scale(0.9) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .modal-close {
        position: absolute;
        top: 15px;
        right: 15px;
        background: rgba(0, 0, 0, 0.1);
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        font-size: 24px;
        cursor: pointer;
        z-index: 1;
        transition: background-color 0.3s;
      }

      .modal-close:hover {
        background: rgba(0, 0, 0, 0.2);
      }

      .quick-view-layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 40px;
        padding: 40px;
        min-height: 500px;
      }

      .product-images {
        display: flex;
        flex-direction: column;
        gap: 15px;
      }

      .main-image {
        position: relative;
        aspect-ratio: 1;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid #eee;
      }

      .main-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .image-thumbnails {
        display: flex;
        gap: 10px;
        overflow-x: auto;
      }

      .thumbnail {
        width: 60px;
        height: 60px;
        object-fit: cover;
        border-radius: 4px;
        border: 2px solid transparent;
        cursor: pointer;
        transition: border-color 0.3s;
      }

      .thumbnail.active {
        border-color: #007bff;
      }

      /* Comparison Styles */
      .comparison-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: white;
        border-top: 1px solid #ddd;
        box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.1);
        z-index: 1000;
        transform: translateY(100%);
        transition: transform 0.3s ease;
        padding: 15px 20px;
      }

      .comparison-bar.active {
        transform: translateY(0);
      }

      .compare-content {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 20px;
        align-items: center;
        max-width: 1200px;
        margin: 0 auto;
      }

      .compare-items {
        display: flex;
        gap: 10px;
        overflow-x: auto;
      }

      .compare-item {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #f8f9fa;
        padding: 8px 12px;
        border-radius: 6px;
        min-width: 200px;
        position: relative;
      }

      .compare-item img {
        width: 30px;
        height: 30px;
        object-fit: cover;
        border-radius: 4px;
      }

      .remove-compare {
        position: absolute;
        top: -5px;
        right: -5px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #dc3545;
        color: white;
        border: none;
        font-size: 12px;
        cursor: pointer;
      }

      /* Loading Spinner */
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

      /* Responsive Design */
      @media (max-width: 768px) {
        .quick-view-layout {
          grid-template-columns: 1fr;
          gap: 20px;
          padding: 20px;
        }
        
        .modal-content {
          max-width: 95vw;
          margin: 20px;
        }
        
        .compare-content {
          grid-template-columns: 1fr;
          gap: 10px;
          text-align: center;
        }
      }

      /* Notification Styles */
      .notification-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10001;
      }

      .ux-notification {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        margin-bottom: 10px;
        animation: slideInRight 0.3s ease;
      }

      .ux-notification.success {
        border-left: 4px solid #28a745;
      }

      .ux-notification.error {
        border-left: 4px solid #dc3545;
      }

      .ux-notification.warning {
        border-left: 4px solid #ffc107;
      }

      .ux-notification.info {
        border-left: 4px solid #17a2b8;
      }

      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      .notification-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 15px 20px;
      }

      .notification-close {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #666;
        margin-left: 15px;
      }
    `;
    
    document.head.appendChild(style);
  }
}

// Create global instance
const uxFeatures = new AdvancedUXFeatures();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdvancedUXFeatures;
}
