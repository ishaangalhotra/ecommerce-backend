#!/usr/bin/env node

/**
 * Product Setup Script for QuickLocal.shop
 * Helps initialize products for the live marketplace
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class ProductSetup {
  constructor() {
    this.baseURL = 'https://quicklocal-backend.onrender.com/api/v1';
    this.token = process.env.ADMIN_TOKEN || '';
    this.products = [];
  }

  async initialize() {
    console.log('🚀 QuickLocal Product Setup');
    console.log('============================');
    
    if (!this.token) {
      console.log('⚠️  Please set ADMIN_TOKEN environment variable');
      console.log('   Example: export ADMIN_TOKEN="your_jwt_token"');
      return;
    }

    try {
      await this.loadSampleProducts();
      await this.addProducts();
      console.log('✅ Product setup completed successfully!');
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
    }
  }

  async loadSampleProducts() {
    console.log('\n📦 Loading sample products...');
    
    this.products = [
      {
        name: "Fresh Organic Tomatoes",
        description: "Locally grown, pesticide-free organic tomatoes. Perfect for salads, cooking, or fresh consumption.",
        shortDescription: "Fresh organic tomatoes",
        price: 2.99,
        originalPrice: 3.99,
        category: "Vegetables",
        stock: 50,
        unit: "kg",
        weight: 1,
        images: [
          "https://images.unsplash.com/photo-1546094096-0df4bcaaa337?w=800&h=800&fit=crop",
          "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=800&h=800&fit=crop"
        ]
      },
      {
        name: "Premium Basmati Rice",
        description: "Long-grain aromatic basmati rice, perfect for biryanis and pulao. Aged for enhanced flavor.",
        shortDescription: "Aromatic basmati rice",
        price: 4.99,
        originalPrice: 5.99,
        category: "Grains",
        stock: 100,
        unit: "kg",
        weight: 1,
        images: [
          "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&h=800&fit=crop"
        ]
      },
      {
        name: "Fresh Milk",
        description: "Pure, pasteurized whole milk from local dairy farms. Rich in calcium and essential nutrients.",
        shortDescription: "Fresh whole milk",
        price: 1.49,
        originalPrice: 1.79,
        category: "Dairy",
        stock: 75,
        unit: "liter",
        weight: 1,
        images: [
          "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=800&h=800&fit=crop"
        ]
      },
      {
        name: "Organic Bananas",
        description: "Sweet, ripe organic bananas. Rich in potassium and perfect for smoothies or healthy snacking.",
        shortDescription: "Organic ripe bananas",
        price: 1.99,
        originalPrice: 2.49,
        category: "Fruits",
        stock: 60,
        unit: "dozen",
        weight: 2,
        images: [
          "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=800&h=800&fit=crop"
        ]
      },
      {
        name: "Fresh Eggs",
        description: "Farm-fresh eggs from free-range chickens. Rich in protein and essential vitamins.",
        shortDescription: "Farm fresh eggs",
        price: 3.99,
        originalPrice: 4.49,
        category: "Dairy",
        stock: 40,
        unit: "dozen",
        weight: 0.8,
        images: [
          "https://images.unsplash.com/photo-1569288063648-5d73c4c0d2c2?w=800&h=800&fit=crop"
        ]
      },
      {
        name: "Whole Wheat Bread",
        description: "Freshly baked whole wheat bread, rich in fiber and nutrients. Perfect for healthy sandwiches.",
        shortDescription: "Fresh whole wheat bread",
        price: 2.49,
        originalPrice: 2.99,
        category: "Bakery",
        stock: 30,
        unit: "packet",
        weight: 0.5,
        images: [
          "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&h=800&fit=crop"
        ]
      },
      {
        name: "Organic Onions",
        description: "Fresh organic onions, perfect for cooking. Sweet and flavorful variety.",
        shortDescription: "Organic cooking onions",
        price: 1.99,
        originalPrice: 2.29,
        category: "Vegetables",
        stock: 80,
        unit: "kg",
        weight: 1,
        images: [
          "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=800&h=800&fit=crop"
        ]
      },
      {
        name: "Pure Honey",
        description: "Natural, pure honey from local beekeepers. Rich in antioxidants and natural sweetness.",
        shortDescription: "Pure natural honey",
        price: 8.99,
        originalPrice: 10.99,
        category: "Condiments",
        stock: 25,
        unit: "bottle",
        weight: 0.5,
        images: [
          "https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=800&h=800&fit=crop"
        ]
      }
    ];

    console.log(`✅ Loaded ${this.products.length} sample products`);
  }

  async addProducts() {
    console.log('\n🔄 Adding products to QuickLocal.shop...');
    
    for (let i = 0; i < this.products.length; i++) {
      const product = this.products[i];
      try {
        console.log(`\n📦 Adding: ${product.name}`);
        
        const response = await axios.post(`${this.baseURL}/products`, product, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          }
        });

        if (response.data.success) {
          console.log(`✅ Successfully added: ${product.name}`);
        } else {
          console.log(`⚠️  Warning: ${product.name} - ${response.data.message}`);
        }

        // Add delay between requests
        await this.delay(1000);
        
      } catch (error) {
        console.log(`❌ Failed to add ${product.name}: ${error.message}`);
      }
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async checkCategories() {
    console.log('\n📊 Checking available categories...');
    
    try {
      const response = await axios.get(`${this.baseURL}/categories`);
      console.log('Available categories:', response.data.data.map(cat => cat.name));
    } catch (error) {
      console.log('⚠️  Could not fetch categories:', error.message);
    }
  }

  async validateSetup() {
    console.log('\n🔍 Validating setup...');
    
    try {
      const response = await axios.get(`${this.baseURL}/products`);
      const productCount = response.data.count;
      
      console.log(`✅ Found ${productCount} products in database`);
      
      if (productCount > 0) {
        console.log('🎉 Product setup validation successful!');
        console.log('\n🌐 Visit your live site: https://quicklocal.shop');
        console.log('📱 Admin Panel: https://quicklocal.shop/admin/product.html');
      }
    } catch (error) {
      console.log('❌ Validation failed:', error.message);
    }
  }
}

// Run the setup
async function main() {
  const setup = new ProductSetup();
  
  console.log('🚀 QuickLocal Product Setup Tool');
  console.log('================================');
  console.log('');
  console.log('This script will help you add sample products to your live QuickLocal.shop website.');
  console.log('');
  console.log('Prerequisites:');
  console.log('1. Your website should be live at https://quicklocal.shop');
  console.log('2. Set ADMIN_TOKEN environment variable with your JWT token');
  console.log('3. Ensure your API endpoints are working');
  console.log('');
  
  await setup.initialize();
  await setup.checkCategories();
  await setup.validateSetup();
  
  console.log('\n📚 Next Steps:');
  console.log('1. Visit https://quicklocal.shop/admin/product.html to manage products');
  console.log('2. Add more products through the admin interface');
  console.log('3. Set up seller accounts for individual sellers');
  console.log('4. Configure payment gateways');
  console.log('5. Set up delivery zones and partners');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ProductSetup;
