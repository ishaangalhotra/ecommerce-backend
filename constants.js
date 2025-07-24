/**
 * Application Constants
 * Centralized configuration constants for QuickLocal backend
 */

// Order related constants
const ORDER_STATUSES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded'
};

// Create arrays for validation
const ORDER_STATUS_VALUES = Object.values(ORDER_STATUSES);
const ORDER_STATUS_FLOW = [
  ORDER_STATUSES.PENDING,
  ORDER_STATUSES.CONFIRMED,
  ORDER_STATUSES.PREPARING,
  ORDER_STATUSES.OUT_FOR_DELIVERY,
  ORDER_STATUSES.DELIVERED
];

// Payment constants
const PAYMENT_METHODS = {
  COD: 'cod',
  ONLINE: 'online',
  WALLET: 'wallet',
  UPI: 'upi',
  CARD: 'card'
};

const PAYMENT_STATUSES = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled'
};

// User roles and permissions
const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  REGIONAL_MANAGER: 'regional_manager',
  SELLER: 'seller',
  CUSTOMER: 'customer',
  MODERATOR: 'moderator',
  DELIVERY_AGENT: 'delivery_agent',
  SUPPORT: 'support'
};

// Product constants
const PRODUCT_STATUSES = {
  DRAFT: 'draft',
  PENDING: 'pending',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  OUT_OF_STOCK: 'out_of_stock',
  DISCONTINUED: 'discontinued'
};

// Delivery constants
const DELIVERY_STATUSES = {
  ASSIGNED: 'assigned',
  PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  RETURNED: 'returned'
};

// Business configuration
const BUSINESS_CONFIG = {
  // Order limits
  MIN_ORDER_VALUE: 50,
  MAX_ORDER_VALUE: 50000,
  FREE_DELIVERY_THRESHOLD: 500,
  
  // Delivery
  DEFAULT_DELIVERY_FEE: 40,
  EXPRESS_DELIVERY_FEE: 80,
  DELIVERY_RADIUS_KM: 25,
  
  // Wallet
  MIN_WALLET_AMOUNT: 10,
  MAX_WALLET_AMOUNT: 10000,
  WELCOME_BONUS: 50,
  
  // Product limits
  MAX_PRODUCTS_PER_SELLER: 1000,
  MAX_IMAGES_PER_PRODUCT: 10,
  MAX_CATEGORIES_PER_PRODUCT: 3,
  
  // Pagination
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  
  // Time constants (in minutes)
  ORDER_CANCELLATION_WINDOW: 30,
  DELIVERY_ESTIMATION_BUFFER: 15,
  SESSION_TIMEOUT: 1440, // 24 hours
  
  // File upload limits
  MAX_FILE_SIZE_MB: 5,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: 100
};

// Notification types
const NOTIFICATION_TYPES = {
  ORDER_PLACED: 'order_placed',
  ORDER_CONFIRMED: 'order_confirmed',
  ORDER_SHIPPED: 'order_shipped',
  ORDER_DELIVERED: 'order_delivered',
  ORDER_CANCELLED: 'order_cancelled',
  PAYMENT_SUCCESS: 'payment_success',
  PAYMENT_FAILED: 'payment_failed',
  ACCOUNT_CREATED: 'account_created',
  ACCOUNT_VERIFIED: 'account_verified',
  PASSWORD_CHANGED: 'password_changed',
  PROMOTIONAL: 'promotional',
  SYSTEM: 'system'
};

// Error codes
const ERROR_CODES = {
  // Authentication
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Business logic
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  PRODUCT_NOT_AVAILABLE: 'PRODUCT_NOT_AVAILABLE',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  
  // Payment
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  
  // Server
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR'
};

// Success messages
const SUCCESS_MESSAGES = {
  ORDER_PLACED: 'Order placed successfully',
  ORDER_CANCELLED: 'Order cancelled successfully',
  PAYMENT_SUCCESS: 'Payment completed successfully',
  PROFILE_UPDATED: 'Profile updated successfully',
  EMAIL_VERIFIED: 'Email verified successfully',
  PASSWORD_CHANGED: 'Password changed successfully',
  PRODUCT_CREATED: 'Product created successfully',
  PRODUCT_UPDATED: 'Product updated successfully',
  PRODUCT_DELETED: 'Product deleted successfully'
};

// API response formats
const API_RESPONSE = {
  SUCCESS: (data = null, message = 'Success') => ({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  }),
  
  ERROR: (message = 'An error occurred', code = null, errors = null) => ({
    success: false,
    message,
    code,
    errors,
    timestamp: new Date().toISOString()
  }),
  
  PAGINATED: (data, pagination, message = 'Success') => ({
    success: true,
    message,
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      pages: Math.ceil(pagination.total / pagination.limit),
      hasNext: pagination.page * pagination.limit < pagination.total,
      hasPrev: pagination.page > 1
    },
    timestamp: new Date().toISOString()
  })
};

// Regular expressions for validation
const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE_INDIAN: /^[6-9]\d{9}$/,
  PINCODE_INDIAN: /^[1-9][0-9]{5}$/,
  PASSWORD_STRONG: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/,
  ALPHANUMERIC: /^[a-zA-Z0-9]+$/,
  SLUG: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  MONGODB_OBJECTID: /^[0-9a-fA-F]{24}$/
};

// Cache keys
const CACHE_KEYS = {
  USER_PROFILE: (userId) => `user:profile:${userId}`,
  PRODUCT_DETAILS: (productId) => `product:${productId}`,
  CATEGORY_LIST: 'categories:list',
  FEATURED_PRODUCTS: 'products:featured',
  SELLER_PRODUCTS: (sellerId) => `seller:${sellerId}:products`,
  ORDER_DETAILS: (orderId) => `order:${orderId}`,
  USER_CART: (userId) => `cart:${userId}`,
  USER_WISHLIST: (userId) => `wishlist:${userId}`
};

// Export all constants
module.exports = {
  ORDER_STATUSES,
  ORDER_STATUS_VALUES,
  ORDER_STATUS_FLOW,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  USER_ROLES,
  PRODUCT_STATUSES,
  DELIVERY_STATUSES,
  BUSINESS_CONFIG,
  NOTIFICATION_TYPES,
  ERROR_CODES,
  SUCCESS_MESSAGES,
  API_RESPONSE,
  REGEX_PATTERNS,
  CACHE_KEYS
};