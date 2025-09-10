// ===== PRODUCT CARD UTILITIES =====

/**
 * Enhanced Product Card Helper Functions
 * Provides utilities for rendering comprehensive product cards
 */

class ProductCardUtils {
    constructor() {
        this.wishlist = JSON.parse(localStorage.getItem('wishlist') || '[]');
        this.cart = JSON.parse(localStorage.getItem('cart') || '[]');
    }

    /**
     * Format price with currency
     */
    formatPrice(price, currency = '₹') {
        if (!price && price !== 0) return 'Price not available';
        return `${currency}${Math.round(price).toLocaleString('en-IN')}`;
    }

    /**
     * Generate star rating HTML
     */
    generateStars(rating, totalReviews = 0) {
        if (!rating) {
            return '<span class="rating-text">No ratings yet</span>';
        }

        const fullStars = Math.floor(rating);
        const hasHalfStar = rating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

        let starsHtml = '<div class="rating-stars">';
        
        // Full stars
        for (let i = 0; i < fullStars; i++) {
            starsHtml += '<span class="rating-star">★</span>';
        }
        
        // Half star
        if (hasHalfStar) {
            starsHtml += '<span class="rating-star">☆</span>';
        }
        
        // Empty stars
        for (let i = 0; i < emptyStars; i++) {
            starsHtml += '<span class="rating-star empty">☆</span>';
        }
        
        starsHtml += '</div>';
        
        const reviewText = totalReviews > 0 ? `(${rating.toFixed(1)}) ${totalReviews} reviews` : `(${rating.toFixed(1)})`;
        
        return `
            <div class="product-rating">
                ${starsHtml}
                <span class="rating-text">${reviewText}</span>
            </div>
        `;
    }

    /**
     * Generate product badges based on product properties
     */
    generateBadges(product) {
        const badges = [];

        if (product.isFeatured) {
            badges.push('<span class="product-badge badge-featured">Featured</span>');
        }
        
        if (product.isNewArrival) {
            badges.push('<span class="product-badge badge-new-arrival">New</span>');
        }
        
        if (product.isBestSeller) {
            badges.push('<span class="product-badge badge-best-seller">Bestseller</span>');
        }
        
        if (product.isOnSale || product.discountPercentage > 0) {
            badges.push(`<span class="product-badge badge-sale">${product.discountPercentage}% Off</span>`);
        }
        
        if (product.isLowStock && product.isInStock) {
            badges.push('<span class="product-badge badge-low-stock">Low Stock</span>');
        }

        // Custom promotional badges
        if (product.promotionalBadges) {
            product.promotionalBadges.forEach(badge => {
                badges.push(`<span class="product-badge badge-featured">${badge}</span>`);
            });
        }

        return badges.length > 0 ? 
            `<div class="product-badges">${badges.join('')}</div>` : '';
    }

    /**
     * Generate stock status indicator
     */
    generateStockStatus(product) {
        if (!product.isInStock) {
            return `
                <div class="stock-status stock-out-of-stock">
                    <span class="stock-indicator"></span>
                    Out of Stock
                </div>
            `;
        } else if (product.isLowStock) {
            return `
                <div class="stock-status stock-low-stock">
                    <span class="stock-indicator"></span>
                    Only ${product.stock} left
                </div>
            `;
        } else {
            return `
                <div class="stock-status stock-in-stock">
                    <span class="stock-indicator"></span>
                    In Stock (${product.stock} ${product.unit || 'pcs'})
                </div>
            `;
        }
    }

    /**
     * Generate delivery information
     */
    generateDeliveryInfo(product) {
        if (!product.deliveryConfig) return '';

        const { preparationTime, deliveryFee, freeDeliveryThreshold, expressDeliveryAvailable } = product.deliveryConfig;
        
        let deliveryText = '';
        if (preparationTime) {
            deliveryText = `🚚 ${preparationTime} min prep`;
        }

        let feeText = '';
        if (deliveryFee === 0 || (freeDeliveryThreshold && product.price >= freeDeliveryThreshold)) {
            feeText = '<span class="delivery-fee free">FREE</span>';
        } else {
            feeText = `<span class="delivery-fee paid">${this.formatPrice(deliveryFee)}</span>`;
        }

        return `
            <div class="delivery-info">
                <span class="delivery-time">${deliveryText}</span>
                ${feeText}
                ${expressDeliveryAvailable ? '<span style="font-size: 11px; color: #059669;">⚡ Express</span>' : ''}
            </div>
        `;
    }

    /**
     * Generate product features list
     */
    generateFeatures(features) {
        if (!features || !features.length) return '';

        const featuresHtml = features.slice(0, 3).map(feature => 
            `<span class="feature-item">${feature}</span>`
        ).join('');

        return `
            <div class="product-features">
                <div class="features-list">${featuresHtml}</div>
            </div>
        `;
    }

    /**
     * Generate color variants
     */
    generateColorVariants(colors) {
        if (!colors || !colors.length) return '';

        const colorHtml = colors.slice(0, 4).map((color, index) => 
            `<div class="color-option ${index === 0 ? 'selected' : ''}" 
                  style="background-color: ${color.code || '#e2e8f0'}"
                  title="${color.name}"
                  data-color="${color.name}"></div>`
        ).join('');

        return `
            <div class="variants-section">
                <div class="variants-label">Colors</div>
                <div class="color-variants">${colorHtml}</div>
            </div>
        `;
    }

    /**
     * Generate size variants
     */
    generateSizeVariants(sizes) {
        if (!sizes || !sizes.length) return '';

        const sizeHtml = sizes.slice(0, 6).map((size, index) => 
            `<div class="size-option ${index === 0 ? 'selected' : ''} ${size.stock === 0 ? 'unavailable' : ''}"
                  data-size="${size.name}">
                ${size.name}
            </div>`
        ).join('');

        return `
            <div class="variants-section">
                <div class="variants-label">Sizes</div>
                <div class="size-variants">${sizeHtml}</div>
            </div>
        `;
    }

    /**
     * Generate pricing section
     */
    generatePricing(product) {
        let pricingHtml = `<div class="price-main">${this.formatPrice(product.finalPrice)}</div>`;

        if (product.isOnSale && product.originalPrice && product.originalPrice > product.finalPrice) {
            pricingHtml += `
                <div>
                    <span class="price-original">${this.formatPrice(product.originalPrice)}</span>
                    <span class="price-discount">${product.discountPercentage}% OFF</span>
                </div>
            `;

            if (product.savings > 0) {
                pricingHtml += `<div class="savings-text">Save ${this.formatPrice(product.savings)}</div>`;
            }
        }

        return `<div class="product-pricing">${pricingHtml}</div>`;
    }

    /**
     * Generate seller information
     */
    generateSellerInfo(product) {
        if (!product.seller || !product.sellerLocation) return '';

        const location = product.sellerLocation.city || product.sellerLocation.locality || 'Local Seller';
        
        return `
            <div class="seller-info">
                <span class="seller-badge">🏪 ${product.seller.name || 'Local Seller'}</span>
                <span class="seller-location">📍 ${location}</span>
            </div>
        `;
    }

    /**
     * Check if product is in wishlist
     */
    isInWishlist(productId) {
        return this.wishlist.includes(productId);
    }

    /**
     * Toggle wishlist status
     */
    toggleWishlist(productId) {
        const index = this.wishlist.indexOf(productId);
        if (index > -1) {
            this.wishlist.splice(index, 1);
        } else {
            this.wishlist.push(productId);
        }
        localStorage.setItem('wishlist', JSON.stringify(this.wishlist));
        return this.isInWishlist(productId);
    }

    /**
     * Generate complete product card HTML
     */
    generateProductCard(product) {
        const imageUrl = product.primaryImage?.url || product.images?.[0]?.url || 
                        'https://via.placeholder.com/320x240?text=No+Image';
        
        const isWishlisted = this.isInWishlist(product.id);

        return `
            <div class="product-card fade-in" data-product-id="${product.id}">
                <div class="product-image-container">
                    <img src="${imageUrl}" 
                         alt="${product.name}" 
                         class="product-image"
                         onerror="this.src='https://via.placeholder.com/320x240?text=No+Image'">
                    
                    ${this.generateBadges(product)}
                    
                    <button class="wishlist-btn ${isWishlisted ? 'active' : ''}" 
                            onclick="productCardUtils.handleWishlistClick('${product.id}', this)">
                        ${isWishlisted ? '❤️' : '🤍'}
                    </button>
                    
                    <button class="quick-view-btn" onclick="productCardUtils.quickView('${product.id}')">
                        👁️ Quick View
                    </button>
                </div>
                
                <div class="product-info">
                    <div class="product-header">
                        ${product.brand ? `<div class="product-brand">${product.brand}</div>` : ''}
                        <h3 class="product-name">${product.name}</h3>
                        ${product.shortDescription ? 
                            `<p class="product-description">${product.shortDescription}</p>` : ''}
                    </div>

                    ${this.generateStars(product.averageRating, product.totalReviews)}
                    ${this.generatePricing(product)}
                    ${this.generateStockStatus(product)}
                    ${this.generateDeliveryInfo(product)}
                    ${this.generateSellerInfo(product)}
                    ${this.generateFeatures(product.features)}
                    
                    <div class="product-variants">
                        ${this.generateColorVariants(product.colors)}
                        ${this.generateSizeVariants(product.sizes)}
                    </div>
                    
                    <div class="product-actions">
                        ${product.isInStock ? 
                            `<button class="btn-product btn-primary" onclick="productCardUtils.addToCart('${product.id}')">
                                🛒 Add to Cart
                            </button>
                            <button class="btn-product btn-secondary" onclick="productCardUtils.viewProduct('${product.id}')">
                                View Details
                            </button>` :
                            `<button class="btn-product btn-secondary" disabled>
                                Out of Stock
                            </button>
                            <button class="btn-product btn-secondary" onclick="productCardUtils.viewProduct('${product.id}')">
                                View Details
                            </button>`
                        }
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Event handlers
     */
    handleWishlistClick(productId, buttonElement) {
        const isNowWishlisted = this.toggleWishlist(productId);
        buttonElement.innerHTML = isNowWishlisted ? '❤️' : '🤍';
        buttonElement.classList.toggle('active', isNowWishlisted);
        
        // Show feedback
        this.showToast(isNowWishlisted ? 'Added to wishlist!' : 'Removed from wishlist!');
    }

    addToCart(productId) {
        // Add to cart logic
        const existingItem = this.cart.find(item => item.productId === productId);
        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            this.cart.push({ productId, quantity: 1 });
        }
        localStorage.setItem('cart', JSON.stringify(this.cart));
        this.showToast('Added to cart!');
        this.updateCartCounter();
    }

    viewProduct(productId) {
        // Navigate to product details
        window.location.href = `product-details.html?id=${productId}`;
    }

    quickView(productId) {
        // Open quick view modal (implement based on your modal system)
        console.log('Quick view for product:', productId);
        this.showToast('Quick view coming soon!');
    }

    /**
     * Utility functions
     */
    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#059669' : '#dc2626'};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    updateCartCounter() {
        const counter = document.querySelector('.cart-counter');
        if (counter) {
            const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
            counter.textContent = totalItems;
            counter.style.display = totalItems > 0 ? 'block' : 'none';
        }
    }

    /**
     * Render products grid
     */
    renderProductsGrid(products, containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Container with ID '${containerId}' not found`);
            return;
        }

        if (!products || products.length === 0) {
            container.innerHTML = `
                <div class="no-products">
                    <h3>No products found</h3>
                    <p>Try adjusting your search or filters.</p>
                </div>
            `;
            return;
        }

        const productsHtml = products.map(product => this.generateProductCard(product)).join('');
        container.innerHTML = `<div class="products-grid">${productsHtml}</div>`;

        // Add event listeners for variant selection
        this.attachVariantListeners();
    }

    /**
     * Attach event listeners for interactive elements
     */
    attachVariantListeners() {
        // Color variant selection
        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const container = e.target.closest('.color-variants');
                container.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
                e.target.classList.add('selected');
            });
        });

        // Size variant selection
        document.querySelectorAll('.size-option:not(.unavailable)').forEach(option => {
            option.addEventListener('click', (e) => {
                const container = e.target.closest('.size-variants');
                container.querySelectorAll('.size-option').forEach(opt => opt.classList.remove('selected'));
                e.target.classList.add('selected');
            });
        });
    }

    /**
     * Filter products by criteria
     */
    filterProducts(products, filters) {
        return products.filter(product => {
            // Category filter
            if (filters.category && product.category.id !== filters.category) {
                return false;
            }

            // Price range filter
            if (filters.minPrice && product.finalPrice < filters.minPrice) {
                return false;
            }
            if (filters.maxPrice && product.finalPrice > filters.maxPrice) {
                return false;
            }

            // Brand filter
            if (filters.brand && product.brand !== filters.brand) {
                return false;
            }

            // In stock filter
            if (filters.inStock && !product.isInStock) {
                return false;
            }

            // Search query
            if (filters.search) {
                const searchTerm = filters.search.toLowerCase();
                const searchableText = `${product.name} ${product.brand} ${product.description}`.toLowerCase();
                if (!searchableText.includes(searchTerm)) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * Sort products by criteria
     */
    sortProducts(products, sortBy) {
        const sorted = [...products];
        
        switch (sortBy) {
            case 'price-low':
                return sorted.sort((a, b) => a.finalPrice - b.finalPrice);
            case 'price-high':
                return sorted.sort((a, b) => b.finalPrice - a.finalPrice);
            case 'rating':
                return sorted.sort((a, b) => b.averageRating - a.averageRating);
            case 'popular':
                return sorted.sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0));
            case 'newest':
                return sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            case 'name':
                return sorted.sort((a, b) => a.name.localeCompare(b.name));
            default:
                return sorted;
        }
    }
}

// Create global instance
const productCardUtils = new ProductCardUtils();

// Add CSS for toast animations
const toastStyles = document.createElement('style');
toastStyles.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(toastStyles);

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProductCardUtils;
}
