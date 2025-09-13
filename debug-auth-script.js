#!/usr/bin/env node

/**
 * Debug Script: Test Hybrid Auth Client Serving
 * This script tests if the server is correctly serving the hybrid-auth-client.js file
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = 'https://quicklocal-backend.onrender.com';
const AUTH_CLIENT_URL = `${BACKEND_URL}/hybrid-auth-client.js`;

async function testAuthClientServing() {
    console.log('🧪 Testing Hybrid Auth Client serving...\n');
    
    try {
        console.log(`📡 Fetching: ${AUTH_CLIENT_URL}`);
        
        const response = await fetch(AUTH_CLIENT_URL);
        
        console.log('\n📋 Response Details:');
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Content-Type: ${response.headers.get('content-type')}`);
        console.log(`   Access-Control-Allow-Origin: ${response.headers.get('access-control-allow-origin')}`);
        console.log(`   Cross-Origin-Resource-Policy: ${response.headers.get('cross-origin-resource-policy') || 'Not set'}`);
        console.log(`   Cache-Control: ${response.headers.get('cache-control')}`);
        console.log(`   Content-Length: ${response.headers.get('content-length')}`);
        
        if (response.ok) {
            const content = await response.text();
            
            console.log('\n✅ SUCCESS: File served successfully');
            console.log(`   Content length: ${content.length} characters`);
            console.log(`   Contains "HybridAuthClient": ${content.includes('HybridAuthClient')}`);
            console.log(`   Contains "window.HybridAuthClient": ${content.includes('window.HybridAuthClient')}`);
            
            // Check if the content matches the local file
            const localFile = path.join(__dirname, 'public', 'hybrid-auth-client.js');
            if (fs.existsSync(localFile)) {
                const localContent = fs.readFileSync(localFile, 'utf8');
                console.log(`   Matches local file: ${content === localContent ? '✅ Yes' : '❌ No'}`);
                
                if (content !== localContent) {
                    console.log(`   Local file size: ${localContent.length} characters`);
                    console.log('   ⚠️ Content mismatch - server may need deployment');
                }
            }
            
        } else {
            console.log(`\n❌ FAILED: Server responded with ${response.status}`);
            const errorText = await response.text();
            console.log(`   Error content: ${errorText.substring(0, 200)}...`);
        }
        
    } catch (error) {
        console.error('\n❌ ERROR: Failed to fetch auth client');
        console.error(`   Message: ${error.message}`);
    }
}

async function testCORSHeaders() {
    console.log('\n🌐 Testing CORS Headers...\n');
    
    try {
        // Test with different origins
        const testOrigins = [
            'https://your-vercel-app.vercel.app',
            'https://marketplace.vercel.app',
            'http://localhost:3000',
            null // No origin (direct access)
        ];
        
        for (const origin of testOrigins) {
            console.log(`🧪 Testing origin: ${origin || 'Direct access'}`);
            
            const headers = {};
            if (origin) {
                headers['Origin'] = origin;
            }
            
            const response = await fetch(AUTH_CLIENT_URL, { headers });
            
            console.log(`   Status: ${response.status}`);
            console.log(`   CORS Allow Origin: ${response.headers.get('access-control-allow-origin') || 'Not set'}`);
            console.log(`   Blocked: ${response.status === 200 ? '❌ No' : '✅ Yes'}`);
            console.log('');
        }
        
    } catch (error) {
        console.error('❌ CORS test failed:', error.message);
    }
}

// Run tests
async function runAllTests() {
    console.log('🚀 QuickLocal Auth Client Debug Tool\n');
    console.log('=' .repeat(50));
    
    await testAuthClientServing();
    await testCORSHeaders();
    
    console.log('=' .repeat(50));
    console.log('✅ Debug tests completed\n');
}

if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = { testAuthClientServing, testCORSHeaders };
