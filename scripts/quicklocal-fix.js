#!/usr/bin/env node

/**
 * QuickLocal Live Fix Script
 * Generated on 2025-08-08T18:33:01.018Z
 */

const axios = require('axios');

class QuickLocalFixer {
  constructor() {
    this.baseURL = 'https://quicklocal.shop';
    this.adminToken = process.env.ADMIN_TOKEN || '';
  }

  async fixSessionIssues() {
    console.log('🔧 Fixing Session Issues...');
    
    // 1. Clear existing sessions
    try {
      await axios.delete(`${this.baseURL}/api/auth/logout-all`, {
        headers: { 'Authorization': `Bearer ${this.adminToken}` }
      });
      console.log('✅ Cleared existing sessions');
    } catch (error) {
      console.log('⚠️ Could not clear sessions:', error.message);
    }
  }

  async fixProductPersistence() {
    console.log('🔧 Fixing Product Persistence...');
    
    // 1. Test product creation
    const testProduct = {
      name: "Test Product - Fix",
      description: "This is a test product to verify persistence",
      price: 9.99,
      category: "Test",
      stock: 10,
      images: ["https://via.placeholder.com/400x400?text=Test+Product"]
    };

    try {
      const response = await axios.post(`${this.baseURL}/api/products`, testProduct, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.adminToken}`
        }
      });
      
      if (response.data.success) {
        console.log('✅ Test product created successfully');
        
        // 2. Verify product exists
        const verifyResponse = await axios.get(`${this.baseURL}/api/products`);
        const products = verifyResponse.data.data?.products || [];
        const testProductExists = products.find(p => p.name === testProduct.name);
        
        if (testProductExists) {
          console.log('✅ Product persistence verified');
        } else {
          console.log('❌ Product not found after creation');
        }
      }
    } catch (error) {
      console.log('❌ Product creation failed:', error.message);
    }
  }

  async fixAuthentication() {
    console.log('🔧 Fixing Authentication Issues...');
    
    // 1. Test admin login
    try {
      const loginResponse = await axios.post(`${this.baseURL}/api/auth/login`, {
        email: process.env.ADMIN_EMAIL || 'admin@quicklocal.com',
        password: process.env.ADMIN_PASSWORD || 'admin123'
      });
      
      if (loginResponse.data.success) {
        console.log('✅ Admin authentication working');
        this.adminToken = loginResponse.data.accessToken;
      } else {
        console.log('❌ Admin authentication failed');
      }
    } catch (error) {
      console.log('❌ Authentication test failed:', error.message);
    }
  }

  async runFixes() {
    console.log('🚀 Starting QuickLocal Fixes...');
    console.log('===============================');
    
    await this.fixAuthentication();
    await this.fixSessionIssues();
    await this.fixProductPersistence();
    
    console.log('\n✅ Fix script completed!');
    console.log('\n📚 Next Steps:');
    console.log('1. Test the admin panel: https://quicklocal.shop/admin/product.html');
    console.log('2. Add products through the web interface');
    console.log('3. Test user registration and login');
    console.log('4. Monitor for any remaining issues');
  }
}

// Run fixes
const fixer = new QuickLocalFixer();
fixer.runFixes().catch(console.error);
