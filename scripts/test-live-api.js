#!/usr/bin/env node

/**
 * Test Live API Endpoints
 * Checks if your QuickLocal.shop API is working
 */

const axios = require('axios');

class LiveAPITester {
  constructor() {
    this.baseURL = 'https://quicklocal.shop';
    this.endpoints = [
      '/',
      '/api/products',
      '/api/categories',
      '/admin/product.html',
      '/seller-dashboard.html'
    ];
  }

  async testEndpoints() {
    console.log('🔍 Testing QuickLocal.shop API Endpoints');
    console.log('========================================');
    console.log('');

    for (const endpoint of this.endpoints) {
      await this.testEndpoint(endpoint);
    }

    console.log('\n📊 Summary:');
    console.log('===========');
    console.log('✅ Working endpoints: ' + this.workingEndpoints.length);
    console.log('❌ Failed endpoints: ' + this.failedEndpoints.length);
    
    if (this.workingEndpoints.length > 0) {
      console.log('\n✅ Working:');
      this.workingEndpoints.forEach(endpoint => {
        console.log(`   - ${endpoint}`);
      });
    }
    
    if (this.failedEndpoints.length > 0) {
      console.log('\n❌ Failed:');
      this.failedEndpoints.forEach(endpoint => {
        console.log(`   - ${endpoint}`);
      });
    }
  }

  async testEndpoint(endpoint) {
    try {
      const url = `${this.baseURL}${endpoint}`;
      console.log(`🔍 Testing: ${url}`);
      
      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: function (status) {
          return status < 500; // Accept 2xx, 3xx, 4xx status codes
        }
      });

      const status = response.status;
      const statusText = response.statusText;
      
      if (status >= 200 && status < 400) {
        console.log(`✅ ${endpoint} - ${status} ${statusText}`);
        this.workingEndpoints.push(endpoint);
      } else {
        console.log(`⚠️  ${endpoint} - ${status} ${statusText}`);
        this.failedEndpoints.push(endpoint);
      }
      
    } catch (error) {
      console.log(`❌ ${endpoint} - ${error.message}`);
      this.failedEndpoints.push(endpoint);
    }
  }

  async testAlternativeURLs() {
    console.log('\n🌐 Testing Alternative URLs');
    console.log('============================');
    
    const alternativeURLs = [
      'http://quicklocal.shop',
      'https://www.quicklocal.shop',
      'http://www.quicklocal.shop'
    ];

    for (const url of alternativeURLs) {
      try {
        console.log(`🔍 Testing: ${url}`);
        const response = await axios.get(url, { timeout: 5000 });
        console.log(`✅ ${url} - ${response.status} ${response.statusText}`);
      } catch (error) {
        console.log(`❌ ${url} - ${error.message}`);
      }
    }
  }

  async checkDNS() {
    console.log('\n🔍 DNS Resolution Check');
    console.log('=======================');
    
    const dns = require('dns').promises;
    
    try {
      const addresses = await dns.resolve4('quicklocal.shop');
      console.log(`✅ DNS Resolution successful:`);
      addresses.forEach(addr => console.log(`   - ${addr}`));
    } catch (error) {
      console.log(`❌ DNS Resolution failed: ${error.message}`);
    }
  }
}

// Initialize arrays to track results
LiveAPITester.prototype.workingEndpoints = [];
LiveAPITester.prototype.failedEndpoints = [];

async function main() {
  const tester = new LiveAPITester();
  
  console.log('🚀 QuickLocal.shop API Tester');
  console.log('==============================');
  console.log('');
  console.log('This script will test if your live website is accessible.');
  console.log('');
  
  await tester.checkDNS();
  await tester.testEndpoints();
  await tester.testAlternativeURLs();
  
  console.log('\n📚 Recommendations:');
  console.log('==================');
  
  if (tester.workingEndpoints.length === 0) {
    console.log('❌ No endpoints are working. Possible issues:');
    console.log('   1. Website is not deployed');
    console.log('   2. DNS is not configured correctly');
    console.log('   3. Server is down');
    console.log('   4. SSL certificate issues');
    console.log('');
    console.log('🔧 Next Steps:');
    console.log('   1. Check your server status');
    console.log('   2. Verify DNS settings');
    console.log('   3. Check SSL certificate');
    console.log('   4. Review deployment logs');
  } else {
    console.log('✅ Some endpoints are working!');
    console.log('   You can proceed with product addition.');
    console.log('');
    console.log('🌐 Working URLs:');
    tester.workingEndpoints.forEach(endpoint => {
      console.log(`   - https://quicklocal.shop${endpoint}`);
    });
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = LiveAPITester;

