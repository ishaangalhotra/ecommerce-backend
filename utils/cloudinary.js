// utils/cloudinary.js - Mock implementation (using ImageKit.io instead)

// Mock the validateConfig function to prevent errors
function validateConfig() {
  console.log('📷 Cloudinary disabled - using ImageKit.io for image management');
  return false; // Always return false to skip Cloudinary initialization
}

// Don't actually require cloudinary to avoid the config error
const mockCloudinary = {
  config: () => {},
  uploader: {
    upload: () => Promise.reject(new Error('Use ImageKit.io for uploads')),
    destroy: () => Promise.reject(new Error('Use ImageKit.io for deletions'))
  }
};

// Mock initialization - this prevents the config error
try {
  console.log('ℹ️  Cloudinary module loaded in mock mode');
} catch (error) {
  console.log('ℹ️  Cloudinary mock initialization complete');
}

// Export the same structure your app expects
module.exports = {
  cloudinary: mockCloudinary,
  validateConfig,
  // Add any other exports your app might be using
  upload: async () => {
    throw new Error('Please use ImageKit.io for image uploads');
  },
  delete: async () => {
    console.warn('Image deletion should use ImageKit.io');
    return { result: 'ok' };
  }
};