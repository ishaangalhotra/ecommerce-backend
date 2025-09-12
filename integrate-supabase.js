#!/usr/bin/env node

/**
 * Supabase Integration Script
 * Adds hybrid authentication routes to existing server.js
 */

const fs = require('fs');
const path = require('path');

async function integrateSupabase() {
  console.log('🔧 Integrating Supabase hybrid authentication...\n');

  try {
    // 1. Read current server.js
    const serverPath = path.join(__dirname, 'server.js');
    let serverContent = fs.readFileSync(serverPath, 'utf8');

    // 2. Add Supabase imports after existing imports
    const importSection = `
// Enhanced Memory Monitor with improved error handling and singleton pattern
class MemoryMonitor {`;

    const supabaseImports = `// Supabase Hybrid Architecture Imports
let realtimeService, hybridAuthRoutes;
try {
  const { realtimeService: supabaseRealtime } = require('./services/supabaseRealtime');
  realtimeService = supabaseRealtime;
} catch (error) {
  console.warn('⚠️ Supabase real-time service not found, skipping...');
}

try {
  hybridAuthRoutes = require('./routes/hybridAuth');
} catch (error) {
  console.warn('⚠️ Hybrid auth routes not found, skipping...');
}

${importSection}`;

    serverContent = serverContent.replace(importSection, supabaseImports);

    // 3. Find where routes are loaded and add hybrid auth route
    const routeLoadingSection = serverContent.indexOf('const essentialRoutes = [');
    
    if (routeLoadingSection !== -1) {
      // Add hybrid-auth to essential routes
      const essentialRoutesMatch = serverContent.match(/const essentialRoutes = \[([\s\S]*?)\];/);
      
      if (essentialRoutesMatch) {
        const currentRoutes = essentialRoutesMatch[1];
        const updatedRoutes = currentRoutes + `,
      { path: '/api/hybrid-auth', file: './routes/hybridAuth' }`;
        
        serverContent = serverContent.replace(
          /const essentialRoutes = \[([\s\S]*?)\];/,
          `const essentialRoutes = [${updatedRoutes}
    ];`
        );
      }
    }

    // 4. Add Supabase initialization after middleware setup
    const middlewareEnd = serverContent.indexOf('// Request logging');
    if (middlewareEnd !== -1) {
      const supabaseInit = `
    // ========================================
    // Supabase Hybrid Architecture Integration
    // ========================================
    
    // Add hybrid authentication routes
    if (hybridAuthRoutes) {
      try {
        this.app.use('/api/hybrid-auth', hybridAuthRoutes);
        console.log('✅ Hybrid authentication routes loaded');
      } catch (error) {
        console.warn('⚠️ Failed to load hybrid auth routes:', error.message);
      }
    }
    
    // Initialize Supabase real-time service (memory efficient)
    if (process.env.SUPABASE_REALTIME_ENABLED === 'true' && realtimeService) {
      try {
        await realtimeService.initialize();
        console.log('✅ Supabase real-time service initialized');
      } catch (error) {
        console.warn('⚠️ Failed to initialize Supabase real-time:', error.message);
      }
    }

    `;
      
      serverContent = serverContent.replace('// Request logging', supabaseInit + '// Request logging');
    }

    // 5. Write the updated server.js
    fs.writeFileSync(serverPath, serverContent);
    console.log('✅ Server.js updated with Supabase integration');

    // 6. Check if .env needs updating
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Check if Supabase variables exist
    const hasSupabaseUrl = envContent.includes('SUPABASE_URL');
    const hasSupabaseKey = envContent.includes('SUPABASE_ANON_KEY');
    const hasSupabaseService = envContent.includes('SUPABASE_SERVICE_KEY');

    if (!hasSupabaseUrl || !hasSupabaseKey || !hasSupabaseService) {
      console.log('\n🔧 Adding Supabase configuration to .env...');
      
      const supabaseEnvVars = `
# Supabase Hybrid Architecture Configuration
SUPABASE_URL=https://pmvhsjezhuokwygvhhqk.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_KEY=your_service_role_key_here

# Memory Optimization Settings
SUPABASE_REALTIME_ENABLED=true
LOG_TO_SUPABASE=true
SOCKET_IO_DISABLED=false
MEMORY_MONITORING_ENABLED=true
`;

      fs.appendFileSync(envPath, supabaseEnvVars);
      console.log('✅ Environment variables added to .env');
    }

    // 7. Test the integration
    console.log('\n🧪 Testing Supabase integration...');
    
    try {
      const { supabase } = require('./config/supabase');
      console.log('✅ Supabase config loaded successfully');
      
      // Test basic connection
      await supabase.auth.getSession();
      console.log('✅ Supabase connection test passed');
      
    } catch (error) {
      console.warn('⚠️ Supabase connection test failed:', error.message);
      console.log('💡 Make sure to add your real Supabase keys to .env file');
    }

    // 8. Show next steps
    console.log('\n🎉 Supabase integration completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('1. Update your .env file with real Supabase keys');
    console.log('2. Run the database schema in Supabase SQL editor');
    console.log('3. Test memory monitoring: npm run hybrid-memory-test');
    console.log('4. Test authentication: npm start');
    console.log('\nFor detailed instructions, see SUPABASE-SETUP.md');

  } catch (error) {
    console.error('❌ Integration failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  integrateSupabase().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { integrateSupabase };
