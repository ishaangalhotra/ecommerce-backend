// Add this to the top of your sellerController.js to debug missing functions
console.log('Seller Controller Functions Check:');

// Example controller structure - make sure all these functions are properly exported
const uploadProduct = async (req, res) => {
  try {
    // Your implementation
    res.status(201).json({
      success: true,
      message: 'Product uploaded successfully'
    });
  } catch (error) {
    console.error('Upload product error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading product'
    });
  }
};

const getMyProducts = async (req, res) => {
  try {
    // Your implementation
    res.json({
      success: true,
      products: [],
      pagination: {}
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching products'
    });
  }
};

const updateProduct = async (req, res) => {
  try {
    // Your implementation
    res.json({
      success: true,
      message: 'Product updated successfully'
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating product'
    });
  }
};

const deleteProduct = async (req, res) => {
  try {
    // Your implementation
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting product'
    });
  }
};

const getSellerDashboard = async (req, res) => {
  try {
    // Your implementation
    res.json({
      success: true,
      dashboard: {
        totalProducts: 0,
        totalSales: 0,
        totalRevenue: 0
      }
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data'
    });
  }
};

const getProductAnalytics = async (req, res) => {
  try {
    // Your implementation
    res.json({
      success: true,
      analytics: {}
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics'
    });
  }
};

const bulkUpdateProducts = async (req, res) => {
  try {
    // Your implementation
    res.json({
      success: true,
      message: 'Products updated in bulk'
    });
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating products'
    });
  }
};

const exportProducts = async (req, res) => {
  try {
    // Your implementation
    res.json({
      success: true,
      message: 'Products exported'
    });
  } catch (error) {
    console.error('Export products error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting products'
    });
  }
};

// CRITICAL: Make sure ALL functions are exported
module.exports = {
  uploadProduct,
  getMyProducts,
  updateProduct,
  deleteProduct,
  getSellerDashboard,
  getProductAnalytics,
  bulkUpdateProducts,
  exportProducts
};

// Debug log to check exports
console.log('Exported functions:', Object.keys(module.exports));

// Check if any function is undefined
Object.keys(module.exports).forEach(key => {
  if (typeof module.exports[key] !== 'function') {
    console.error(`❌ ${key} is not a function:`, typeof module.exports[key]);
  } else {
    console.log(`✅ ${key} is properly exported`);
  }
});