// Advanced Pagination and Lazy Loading System for E-commerce
class AdvancedPaginationSystem {
  
  constructor() {
    this.imageObserver = null;
    this.paginationObserver = null;
    this.loadedImages = new Set();
    this.isLoading = false;
    this.hasMore = true;
    this.currentPage = 1;
    this.totalPages = 1;
    this.itemsPerPage = 20;
    this.setupObservers();
  }

  // Setup Intersection Observers for lazy loading and infinite scroll
  setupObservers() {
    // Image lazy loading observer
    this.imageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.loadImage(entry.target);
          }
        });
      },
      {
        rootMargin: '200px', // Start loading 200px before image comes into view
        threshold: 0.1
      }
    );

    // Infinite scroll observer
    this.paginationObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !this.isLoading && this.hasMore) {
            this.loadNextPage();
          }
        });
      },
      {
        rootMargin: '100px',
        threshold: 0.1
      }
    );
  }

  // Initialize lazy loading for existing images
  initializeLazyLoading() {
    const lazyImages = document.querySelectorAll('img[data-src]');
    lazyImages.forEach(img => {
      this.imageObserver.observe(img);
    });
  }

  // Load individual image with progressive enhancement
  loadImage(img) {
    if (this.loadedImages.has(img)) return;

    // Show loading placeholder
    this.showImageLoading(img);

    const imageUrl = img.dataset.src;
    const webpUrl = img.dataset.webpSrc;

    // Try to load WebP first, fallback to original format
    const testImg = new Image();
    
    testImg.onload = () => {
      img.src = testImg.src;
      img.classList.add('loaded');
      this.hideImageLoading(img);
      this.loadedImages.add(img);
      this.imageObserver.unobserve(img);
    };

    testImg.onerror = () => {
      // Fallback to original format if WebP fails
      if (testImg.src !== imageUrl) {
        testImg.src = imageUrl;
      } else {
        // Show error state
        this.showImageError(img);
        this.imageObserver.unobserve(img);
      }
    };

    // Start with WebP if available, otherwise use original
    testImg.src = webpUrl || imageUrl;
  }

  // Show image loading state
  showImageLoading(img) {
    if (!img.parentElement.querySelector('.image-loader')) {
      const loader = document.createElement('div');
      loader.className = 'image-loader';
      loader.innerHTML = `
        <div class="loader-skeleton">
          <div class="shimmer"></div>
        </div>
      `;
      img.parentElement.appendChild(loader);
    }
  }

  // Hide image loading state
  hideImageLoading(img) {
    const loader = img.parentElement.querySelector('.image-loader');
    if (loader) {
      loader.remove();
    }
  }

  // Show image error state
  showImageError(img) {
    img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTIxIDlWN0MxOCA1IDEzIDUgMTIgNUM5IDUgNCA1IDMgN1Y5QzQgMTEgOSAxMSAxMiAxMUMxNSAxMSAyMCAxMSAyMSA5WiIgZmlsbD0iI0Y1RjVGNSIvPgo8L3N2Zz4K';
    img.alt = 'Image failed to load';
    img.classList.add('error');
    this.hideImageLoading(img);
  }

  // Enhanced product loading with skeleton screens
  async loadNextPage() {
    if (this.isLoading || !this.hasMore) return;

    this.isLoading = true;
    this.showLoadingIndicator();

    try {
      const nextPage = this.currentPage + 1;
      const data = await this.fetchProducts(nextPage);

      if (data.success && data.products.length > 0) {
        this.appendProducts(data.products);
        this.currentPage = nextPage;
        this.totalPages = data.pagination.totalPages;
        this.hasMore = nextPage < data.pagination.totalPages;

        // Initialize lazy loading for new images
        setTimeout(() => this.initializeLazyLoading(), 100);
      } else {
        this.hasMore = false;
        this.showEndMessage();
      }

    } catch (error) {
      console.error('Error loading next page:', error);
      this.showErrorMessage();
    } finally {
      this.isLoading = false;
      this.hideLoadingIndicator();
    }
  }

  // Fetch products with caching and error handling
  async fetchProducts(page, limit = this.itemsPerPage, filters = {}) {
    const cacheKey = `products_page_${page}_${JSON.stringify(filters)}`;
    
    // Try cache first
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      if (Date.now() - cachedData.timestamp < 300000) { // 5 minutes cache
        return cachedData.data;
      }
    }

    const queryParams = new URLSearchParams({
      page,
      limit,
      ...filters
    });

    const response = await fetch(`${API_BASE_URL}/products?${queryParams}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Cache the result
    localStorage.setItem(cacheKey, JSON.stringify({
      data,
      timestamp: Date.now()
    }));

    return data;
  }

  // Append products to the container with staggered animation
  appendProducts(products) {
    const container = document.getElementById('productsContainer') || document.querySelector('.products-grid');
    if (!container) return;

    products.forEach((product, index) => {
      const productElement = this.createProductElement(product);
      
      // Stagger animation
      setTimeout(() => {
        productElement.style.opacity = '0';
        productElement.style.transform = 'translateY(20px)';
        container.appendChild(productElement);
        
        // Trigger animation
        requestAnimationFrame(() => {
          productElement.style.transition = 'all 0.3s ease-out';
          productElement.style.opacity = '1';
          productElement.style.transform = 'translateY(0)';
        });
      }, index * 50); // 50ms delay between each product
    });

    // Update infinite scroll trigger
    this.updateInfiniteScrollTrigger();
  }

  // Create optimized product element with lazy loading
  createProductElement(product) {
    const productDiv = document.createElement('div');
    productDiv.className = 'product-card';
    productDiv.dataset.productId = product._id;

    // Determine image URLs with WebP support
    const mainImage = product.images?.[0];
    const webpImage = mainImage ? this.getWebPUrl(mainImage) : null;

    productDiv.innerHTML = `
      <div class="product-image-container">
        <img 
          data-src="${mainImage || '/images/placeholder.jpg'}"
          ${webpImage ? `data-webp-src="${webpImage}"` : ''}
          alt="${product.name}"
          class="product-image lazy-image"
          loading="lazy"
        >
        <div class="product-badges">
          ${product.stock === 0 ? '<span class="badge out-of-stock">Out of Stock</span>' : ''}
          ${product.fastDelivery ? '<span class="badge fast-delivery">Fast Delivery</span>' : ''}
          ${product.discount > 0 ? `<span class="badge discount">${product.discount}% OFF</span>` : ''}
        </div>
        <div class="quick-actions">
          <button class="quick-view-btn" onclick="quickViewProduct('${product._id}')" title="Quick View">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button class="wishlist-btn ${product.inWishlist ? 'active' : ''}" onclick="toggleWishlist('${product._id}')" title="Add to Wishlist">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="product-info">
        <h3 class="product-name" title="${product.name}">${product.name}</h3>
        ${product.brand ? `<p class="product-brand">${product.brand}</p>` : ''}
        <div class="product-rating">
          ${this.renderStars(product.averageRating || 0)}
          <span class="rating-count">(${product.reviewCount || 0})</span>
        </div>
        <div class="product-pricing">
          <span class="current-price">$${product.price}</span>
          ${product.originalPrice > product.price ? 
            `<span class="original-price">$${product.originalPrice}</span>` : ''
          }
        </div>
        <div class="product-actions">
          <button class="btn-primary add-to-cart-btn" 
                  onclick="addToCart('${product._id}')"
                  ${product.stock === 0 ? 'disabled' : ''}>
            ${product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
          </button>
        </div>
      </div>
    `;

    return productDiv;
  }

  // Render star rating
  renderStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    let stars = '';
    
    // Full stars
    for (let i = 0; i < fullStars; i++) {
      stars += '<span class="star filled">★</span>';
    }
    
    // Half star
    if (hasHalfStar) {
      stars += '<span class="star half">★</span>';
    }
    
    // Empty stars
    for (let i = 0; i < emptyStars; i++) {
      stars += '<span class="star empty">☆</span>';
    }

    return `<div class="stars" data-rating="${rating}">${stars}</div>`;
  }

  // Get WebP URL if supported
  getWebPUrl(originalUrl) {
    if (!originalUrl) return null;
    
    // Check if browser supports WebP
    if (!this.supportsWebP()) return null;

    // Convert to WebP URL (this would typically be handled by your CDN)
    return originalUrl.replace(/\.(jpg|jpeg|png)$/i, '.webp');
  }

  // Check WebP support
  supportsWebP() {
    if (this._webpSupport !== undefined) return this._webpSupport;

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    this._webpSupport = canvas.toDataURL('image/webp').indexOf('webp') > -1;
    
    return this._webpSupport;
  }

  // Show loading indicator
  showLoadingIndicator() {
    const existing = document.getElementById('loadingIndicator');
    if (existing) return;

    const loader = document.createElement('div');
    loader.id = 'loadingIndicator';
    loader.className = 'loading-indicator';
    loader.innerHTML = `
      <div class="loading-grid">
        ${Array.from({length: 8}, (_, i) => `
          <div class="product-skeleton">
            <div class="skeleton-image"></div>
            <div class="skeleton-text"></div>
            <div class="skeleton-text short"></div>
            <div class="skeleton-price"></div>
          </div>
        `).join('')}
      </div>
    `;

    const container = document.getElementById('productsContainer') || document.querySelector('.products-grid');
    if (container) {
      container.parentElement.appendChild(loader);
    }
  }

  // Hide loading indicator
  hideLoadingIndicator() {
    const loader = document.getElementById('loadingIndicator');
    if (loader) {
      loader.remove();
    }
  }

  // Show end of results message
  showEndMessage() {
    const endMessage = document.createElement('div');
    endMessage.className = 'end-message';
    endMessage.innerHTML = `
      <div class="end-content">
        <p>🎉 You've seen all products!</p>
        <button onclick="window.scrollTo({top: 0, behavior: 'smooth'})" class="back-to-top-btn">
          Back to Top
        </button>
      </div>
    `;

    const container = document.getElementById('productsContainer') || document.querySelector('.products-grid');
    if (container) {
      container.parentElement.appendChild(endMessage);
    }
  }

  // Show error message
  showErrorMessage() {
    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';
    errorMessage.innerHTML = `
      <div class="error-content">
        <p>❌ Failed to load more products</p>
        <button onclick="paginationSystem.loadNextPage()" class="retry-btn">
          Try Again
        </button>
      </div>
    `;

    const container = document.getElementById('productsContainer') || document.querySelector('.products-grid');
    if (container) {
      container.parentElement.appendChild(errorMessage);
    }
  }

  // Update infinite scroll trigger element
  updateInfiniteScrollTrigger() {
    let trigger = document.getElementById('infiniteScrollTrigger');
    
    if (!trigger) {
      trigger = document.createElement('div');
      trigger.id = 'infiniteScrollTrigger';
      trigger.className = 'infinite-scroll-trigger';
      trigger.style.cssText = 'height: 1px; margin-top: 20px;';
    }

    // Remove existing observer
    if (this.paginationObserver) {
      this.paginationObserver.unobserve(trigger);
    }

    // Move trigger to end of container
    const container = document.getElementById('productsContainer') || document.querySelector('.products-grid');
    if (container && this.hasMore) {
      container.parentElement.appendChild(trigger);
      this.paginationObserver.observe(trigger);
    }
  }

  // Initialize the system
  initialize(containerId = 'productsContainer') {
    this.containerId = containerId;
    this.initializeLazyLoading();
    this.updateInfiniteScrollTrigger();

    // Add CSS for loading states and animations
    this.injectCSS();

    console.log('✅ Advanced Pagination System initialized');
  }

  // Inject required CSS
  injectCSS() {
    if (document.getElementById('paginationSystemCSS')) return;

    const style = document.createElement('style');
    style.id = 'paginationSystemCSS';
    style.textContent = `
      /* Image lazy loading styles */
      .lazy-image {
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
      }
      
      .lazy-image.loaded {
        opacity: 1;
      }
      
      .lazy-image.error {
        background-color: #f5f5f5;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Skeleton loading styles */
      .image-loader {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: #f0f0f0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .loader-skeleton {
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
      }

      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }

      /* Product skeleton styles */
      .product-skeleton {
        background: white;
        border-radius: 8px;
        padding: 15px;
        margin-bottom: 20px;
      }

      .skeleton-image {
        width: 100%;
        height: 200px;
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        border-radius: 8px;
        margin-bottom: 15px;
      }

      .skeleton-text {
        height: 16px;
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        border-radius: 4px;
        margin-bottom: 8px;
      }

      .skeleton-text.short {
        width: 60%;
      }

      .skeleton-price {
        height: 20px;
        width: 80px;
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        border-radius: 4px;
      }

      .loading-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 20px;
        padding: 20px;
      }

      /* Loading indicator styles */
      .loading-indicator {
        text-align: center;
        padding: 40px 20px;
      }

      .end-message, .error-message {
        text-align: center;
        padding: 40px 20px;
        margin: 20px 0;
      }

      .end-content, .error-content {
        background: white;
        padding: 30px;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        display: inline-block;
      }

      .back-to-top-btn, .retry-btn {
        background: #007bff;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 5px;
        cursor: pointer;
        margin-top: 15px;
        font-weight: 600;
      }

      .back-to-top-btn:hover, .retry-btn:hover {
        background: #0056b3;
      }

      /* Product card enhancements */
      .product-image-container {
        position: relative;
        overflow: hidden;
      }

      .quick-actions {
        position: absolute;
        top: 10px;
        right: 10px;
        display: flex;
        gap: 5px;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .product-card:hover .quick-actions {
        opacity: 1;
      }

      .quick-view-btn, .wishlist-btn {
        background: rgba(255,255,255,0.9);
        border: none;
        border-radius: 50%;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .quick-view-btn:hover, .wishlist-btn:hover {
        background: white;
        transform: scale(1.1);
      }

      .wishlist-btn.active {
        color: #dc3545;
      }

      /* Rating styles */
      .stars {
        display: inline-flex;
        gap: 2px;
      }

      .star {
        color: #ffc107;
        font-size: 14px;
      }

      .star.empty {
        color: #e0e0e0;
      }

      .star.half {
        background: linear-gradient(90deg, #ffc107 50%, #e0e0e0 50%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    `;

    document.head.appendChild(style);
  }

  // Clean up observers
  destroy() {
    if (this.imageObserver) {
      this.imageObserver.disconnect();
    }
    if (this.paginationObserver) {
      this.paginationObserver.disconnect();
    }
  }
}

// Global functions for product interactions
window.quickViewProduct = (productId) => {
  // Quick view modal implementation
  console.log('Quick view product:', productId);
  // This would open a modal with product details
};

window.toggleWishlist = async (productId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/wishlist/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ productId })
    });

    const data = await response.json();
    
    if (data.success) {
      // Update UI
      const btn = document.querySelector(`[onclick="toggleWishlist('${productId}')"]`);
      if (btn) {
        btn.classList.toggle('active');
      }
    }
  } catch (error) {
    console.error('Toggle wishlist error:', error);
  }
};

window.addToCart = async (productId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/cart/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ 
        productId, 
        quantity: 1 
      })
    });

    const data = await response.json();
    
    if (data.success) {
      // Show success notification
      showNotification('Product added to cart!', 'success');
    }
  } catch (error) {
    console.error('Add to cart error:', error);
    showNotification('Failed to add product to cart', 'error');
  }
};

function showNotification(message, type = 'info') {
  // Simple notification implementation
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
    color: white;
    padding: 15px 20px;
    border-radius: 5px;
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Create global instance
const paginationSystem = new AdvancedPaginationSystem();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdvancedPaginationSystem;
}
