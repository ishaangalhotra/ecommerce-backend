#!/usr/bin/env node

const http = require('http');

console.log('🧪 Testing QuickLocal API');
console.log('========================');

async function testAPI() {
    try {
        console.log('\n📡 Testing server connection...');
        
        // Test 1: Check if server is running
        const healthResponse = await makeRequest('/health');
        console.log('✅ Server is running');
        console.log('📊 Health Status:', healthResponse.status);
        
        // Test 2: Check products API
        console.log('\n📦 Testing products API...');
        const productsResponse = await makeRequest('/api/v1/products');
        
        if (productsResponse.success) {
            console.log('✅ Products API is working');
            console.log(`📊 Found ${productsResponse.data.products.length} products`);
            
            if (productsResponse.data.products.length > 0) {
                console.log('\n📋 Sample Products:');
                productsResponse.data.products.slice(0, 3).forEach((product, index) => {
                    console.log(`   ${index + 1}. ${product.name} - ₹${product.price} (Status: ${product.status || 'active'})`);
                });
            } else {
                console.log('⚠️  No products found in the database');
            }
        } else {
            console.log('❌ Products API returned error:', productsResponse.message);
        }
        
        // Test 3: Check categories API
        console.log('\n📂 Testing categories API...');
        const categoriesResponse = await makeRequest('/api/v1/categories');
        
        if (categoriesResponse.success) {
            console.log('✅ Categories API is working');
            console.log(`📊 Found ${categoriesResponse.data.categories.length} categories`);
        } else {
            console.log('❌ Categories API returned error:', categoriesResponse.message);
        }
        
        console.log('\n🎯 Summary:');
        console.log('===========');
        console.log('1. Server Status:', healthResponse.status);
        console.log('2. Products Count:', productsResponse.data?.products?.length || 0);
        console.log('3. Categories Count:', categoriesResponse.data?.categories?.length || 0);
        
        if (productsResponse.data?.products?.length === 0) {
            console.log('\n💡 No products found! Possible reasons:');
            console.log('   - No products have been added yet');
            console.log('   - Products are saved as "draft" instead of "active"');
            console.log('   - Database is empty');
            console.log('   - API endpoint is not working correctly');
        }
        
    } catch (error) {
        console.error('❌ API test failed:', error.message);
        console.log('\n💡 Troubleshooting:');
        console.log('   - Make sure the server is running on port 10000');
        console.log('   - Check if the server started without errors');
        console.log('   - Verify the API endpoints are accessible');
    }
}

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 10000,
            path: path,
            method: 'GET',
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    resolve(response);
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

// Run the test
testAPI();
