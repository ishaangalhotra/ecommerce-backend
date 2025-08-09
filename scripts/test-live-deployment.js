#!/usr/bin/env node

/**
 * Live Deployment Testing Script
 * Tests the live QuickLocal.shop deployment to identify issues
 */

const https = require('https');
const http = require('http');

class LiveDeploymentTester {
  constructor(domain = 'quicklocal.shop') {
    this.domain = domain;
    this.baseUrl = `https://${domain}`;
    this.results = [];
  }

  async run() {
    console.log(`🧪 Testing Live Deployment: ${this.domain}`);
    console.log('=' .repeat(50));
    
    const tests = [
      { name: 'Root Endpoint', path: '/' },
      { name: 'Health Check', path: '/health' },
      { name: 'Status Check', path: '/status' },
      { name: 'API Documentation', path: '/api/v1/docs' },
      { name: 'Products API', path: '/api/v1/products' },
      { name: 'Categories API', path: '/api/v1/categories' },
      { name: 'Auth API', path: '/api/v1/auth' },
      { name: 'Admin Panel', path: '/admin/product.html' },
      { name: 'Seller Dashboard', path: '/seller-dashboard.html' }
    ];

    for (const test of tests) {
      await this.testEndpoint(test.name, test.path);
      await this.delay(500); // Small delay between requests
    }

    this.printSummary();
    this.provideDiagnosis();
  }

  async testEndpoint(name, path) {
    const url = `${this.baseUrl}${path}`;
    
    try {
      console.log(`\n🔍 Testing: ${name}`);
      console.log(`   URL: ${url}`);
      
      const result = await this.makeRequest(url);
      
      const status = this.getStatusEmoji(result.statusCode);
      console.log(`   ${status} Status: ${result.statusCode}`);
      
      if (result.headers['content-type']) {
        console.log(`   📄 Content-Type: ${result.headers['content-type']}`);
      }
      
      if (result.headers['server']) {
        console.log(`   🖥️ Server: ${result.headers['server']}`);
      }

      // Check for specific issues
      const issues = this.analyzeResponse(result, path);
      if (issues.length > 0) {
        issues.forEach(issue => console.log(`   ⚠️ ${issue}`));
      }

      this.results.push({
        name,
        path,
        url,
        statusCode: result.statusCode,
        success: result.statusCode < 400,
        contentType: result.headers['content-type'],
        issues
      });

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      this.results.push({
        name,
        path,
        url,
        error: error.message,
        success: false
      });
    }
  }

  makeRequest(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const options = {
        method: 'GET',
        timeout: 10000,
        headers: {
          'User-Agent': 'QuickLocal-Deployment-Tester/1.0'
        }
      };

      const req = protocol.get(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data.slice(0, 1000) // First 1KB only
          });
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.setTimeout(10000);
    });
  }

  getStatusEmoji(statusCode) {
    if (statusCode >= 200 && statusCode < 300) return '✅';
    if (statusCode >= 300 && statusCode < 400) return '🔄';
    if (statusCode >= 400 && statusCode < 500) return '❌';
    if (statusCode >= 500) return '💥';
    return '❓';
  }

  analyzeResponse(result, path) {
    const issues = [];
    
    // Check for common issues
    if (result.statusCode === 404) {
      if (path.startsWith('/api/')) {
        issues.push('API endpoint not found - backend may not be running');
      } else {
        issues.push('Frontend file not found - static files may not be served');
      }
    }
    
    if (result.statusCode === 500) {
      issues.push('Server error - check backend logs');
    }
    
    if (result.statusCode === 502 || result.statusCode === 503) {
      issues.push('Service unavailable - backend may be down');
    }

    // Check content type for API endpoints
    if (path.startsWith('/api/') && result.statusCode === 200) {
      if (!result.contentType || !result.contentType.includes('application/json')) {
        issues.push('API endpoint not returning JSON');
      }
    }

    // Check for HTML responses on API endpoints (usually means frontend is serving API routes)
    if (path.startsWith('/api/') && result.contentType && result.contentType.includes('text/html')) {
      issues.push('API endpoint returning HTML - routing misconfiguration');
    }

    return issues;
  }

  printSummary() {
    console.log('\n📊 DEPLOYMENT TEST SUMMARY');
    console.log('=' .repeat(50));
    
    const successful = this.results.filter(r => r.success).length;
    const total = this.results.length;
    const percentage = Math.round((successful / total) * 100);
    
    console.log(`✅ Successful: ${successful}/${total} (${percentage}%)`);
    
    const failed = this.results.filter(r => !r.success);
    if (failed.length > 0) {
      console.log(`❌ Failed: ${failed.length}`);
      failed.forEach(result => {
        console.log(`   - ${result.name}: ${result.error || `Status ${result.statusCode}`}`);
      });
    }
  }

  provideDiagnosis() {
    console.log('\n🩺 DIAGNOSIS & RECOMMENDATIONS');
    console.log('=' .repeat(50));
    
    const apiResults = this.results.filter(r => r.path.startsWith('/api/'));
    const frontendResults = this.results.filter(r => !r.path.startsWith('/api/') && !r.path.startsWith('/health') && !r.path.startsWith('/status'));
    
    const apiFailures = apiResults.filter(r => !r.success).length;
    const frontendFailures = frontendResults.filter(r => !r.success).length;
    
    if (apiFailures === apiResults.length) {
      console.log('🚨 CRITICAL: All API endpoints are failing');
      console.log('   Likely causes:');
      console.log('   - Backend server is not running');
      console.log('   - Environment variables not set in Render');
      console.log('   - Database connection failure');
      console.log('   - Build/deployment failure');
      console.log('');
      console.log('   🔧 Immediate actions:');
      console.log('   1. Check Render build logs for errors');
      console.log('   2. Verify MONGODB_URI is set in Render environment');
      console.log('   3. Check other required environment variables');
      console.log('   4. Trigger manual redeploy if needed');
    } else if (apiFailures > 0) {
      console.log('⚠️ WARNING: Some API endpoints are failing');
      console.log('   - Partial backend functionality');
      console.log('   - Some routes may be misconfigured');
    } else {
      console.log('✅ API endpoints are working correctly');
    }

    if (frontendFailures > 0) {
      console.log('⚠️ WARNING: Frontend files not accessible');
      console.log('   - Static file serving may be misconfigured');
      console.log('   - Check if frontend files are in correct directory');
    }

    // Check for specific patterns
    const healthCheck = this.results.find(r => r.path === '/health');
    if (healthCheck && !healthCheck.success) {
      console.log('🚨 CRITICAL: Health check failing');
      console.log('   - Server is not responding properly');
      console.log('   - Check Render service status');
    }

    console.log('\n💡 NEXT STEPS:');
    console.log('1. Check Render Dashboard → Your Service → Logs');
    console.log('2. Verify environment variables are set');
    console.log('3. Ensure MongoDB connection is working');
    console.log('4. Check custom domain configuration');
    console.log('5. Review build and deployment logs');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the tester
if (require.main === module) {
  const tester = new LiveDeploymentTester();
  tester.run().catch(console.error);
}

module.exports = LiveDeploymentTester;
