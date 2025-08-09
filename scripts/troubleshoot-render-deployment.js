#!/usr/bin/env node

/**
 * Render Deployment Troubleshooting Script
 * Helps diagnose and fix common Render deployment issues
 */

const fs = require('fs').promises;
const path = require('path');

class RenderTroubleshooter {
  constructor() {
    this.issues = [];
    this.fixes = [];
  }

  async run() {
    console.log('🔍 QuickLocal Render Deployment Troubleshooter');
    console.log('=' .repeat(50));
    
    try {
      await this.checkProjectStructure();
      await this.checkPackageJson();
      await this.checkRenderConfig();
      await this.checkEnvironmentVariables();
      await this.checkServerConfiguration();
      
      this.reportFindings();
      await this.suggestFixes();
      
    } catch (error) {
      console.error('❌ Troubleshooting failed:', error.message);
      process.exit(1);
    }
  }

  async checkProjectStructure() {
    console.log('\n📁 Checking project structure...');
    
    const requiredFiles = [
      'server.js',
      'package.json',
      'render.yaml',
      'routes',
      'models',
      'controllers'
    ];

    for (const file of requiredFiles) {
      try {
        const stats = await fs.stat(file);
        console.log(`✅ ${file} exists`);
      } catch (error) {
        this.addIssue(`❌ Missing required file/directory: ${file}`);
      }
    }
  }

  async checkPackageJson() {
    console.log('\n📦 Checking package.json...');
    
    try {
      const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
      
      // Check scripts
      const requiredScripts = ['start'];
      const missingScripts = requiredScripts.filter(script => !packageJson.scripts[script]);
      
      if (missingScripts.length > 0) {
        this.addIssue(`❌ Missing package.json scripts: ${missingScripts.join(', ')}`);
        this.addFix('Add missing scripts to package.json');
      } else {
        console.log('✅ Required scripts present');
      }
      
      // Check start command
      if (packageJson.scripts.start && !packageJson.scripts.start.includes('server.js')) {
        this.addIssue('❌ Start script does not reference server.js');
        this.addFix('Update start script to use: "node server.js"');
      }
      
      // Check dependencies
      const criticalDeps = ['express', 'mongoose', 'dotenv'];
      const missingDeps = criticalDeps.filter(dep => 
        !packageJson.dependencies[dep] && !packageJson.devDependencies[dep]
      );
      
      if (missingDeps.length > 0) {
        this.addIssue(`❌ Missing critical dependencies: ${missingDeps.join(', ')}`);
      } else {
        console.log('✅ Critical dependencies present');
      }
      
    } catch (error) {
      this.addIssue('❌ Could not read or parse package.json');
    }
  }

  async checkRenderConfig() {
    console.log('\n⚙️ Checking render.yaml configuration...');
    
    try {
      const renderConfig = await fs.readFile('render.yaml', 'utf8');
      
      // Check build command
      if (renderConfig.includes('npm run build') && !renderConfig.includes('npm install')) {
        this.addIssue('❌ Build command may fail - includes "npm run build" but build script might not exist');
        this.addFix('Update buildCommand to just "npm install" if no build step needed');
      }
      
      // Check start command
      if (!renderConfig.includes('startCommand: node server.js')) {
        this.addIssue('❌ Start command might be incorrect');
        this.addFix('Ensure startCommand is "node server.js"');
      }
      
      // Check environment variables
      if (renderConfig.includes('your-frontend.com') || renderConfig.includes('ecommerce-backend')) {
        this.addIssue('❌ Placeholder URLs found in render.yaml');
        this.addFix('Update FRONTEND_URL, CLIENT_URL, and API_URL to use your actual domain');
      }
      
      // Check port configuration
      if (!renderConfig.includes('PORT') || !renderConfig.includes('10000')) {
        this.addIssue('❌ PORT environment variable not properly configured');
        this.addFix('Ensure PORT is set to 10000 in render.yaml');
      }
      
      console.log('✅ render.yaml structure looks good');
      
    } catch (error) {
      this.addIssue('❌ Could not read render.yaml');
      this.addFix('Create a proper render.yaml file');
    }
  }

  async checkEnvironmentVariables() {
    console.log('\n🔐 Checking environment variables...');
    
    const criticalEnvVars = [
      'MONGODB_URI',
      'JWT_SECRET',
      'COOKIE_SECRET',
      'SESSION_SECRET'
    ];

    // Check if .env.example exists for reference
    try {
      const envExample = await fs.readFile('env.example', 'utf8');
      console.log('✅ env.example found - good for reference');
      
      // Check if critical vars are documented
      const missingFromExample = criticalEnvVars.filter(envVar => 
        !envExample.includes(envVar)
      );
      
      if (missingFromExample.length > 0) {
        this.addIssue(`⚠️ Some critical env vars not documented in env.example: ${missingFromExample.join(', ')}`);
      }
      
    } catch (error) {
      this.addIssue('⚠️ env.example not found - consider creating one for documentation');
    }

    // Remind about Render environment variables
    console.log('ℹ️ Remember to set these in Render Dashboard:');
    criticalEnvVars.forEach(envVar => {
      console.log(`   - ${envVar}`);
    });
  }

  async checkServerConfiguration() {
    console.log('\n🖥️ Checking server configuration...');
    
    try {
      const serverJs = await fs.readFile('server.js', 'utf8');
      
      // Check port configuration
      if (!serverJs.includes('process.env.PORT')) {
        this.addIssue('❌ Server does not read PORT from environment variables');
        this.addFix('Update server.js to use process.env.PORT');
      }
      
      // Check host configuration
      if (!serverJs.includes('0.0.0.0') && !serverJs.includes('process.env.HOST')) {
        this.addIssue('⚠️ Server might not bind to 0.0.0.0 (required for Render)');
        this.addFix('Ensure server listens on 0.0.0.0 or process.env.HOST');
      }
      
      // Check MongoDB connection
      if (!serverJs.includes('mongoose') && !serverJs.includes('mongodb')) {
        this.addIssue('⚠️ No database connection code found');
      }
      
      console.log('✅ Server configuration looks good');
      
    } catch (error) {
      this.addIssue('❌ Could not read server.js');
    }
  }

  addIssue(issue) {
    this.issues.push(issue);
    console.log(issue);
  }

  addFix(fix) {
    this.fixes.push(fix);
  }

  reportFindings() {
    console.log('\n📊 TROUBLESHOOTING SUMMARY');
    console.log('=' .repeat(50));
    
    if (this.issues.length === 0) {
      console.log('🎉 No issues found! Your deployment should work.');
      return;
    }
    
    console.log(`\n❌ Found ${this.issues.length} issues:`);
    this.issues.forEach((issue, index) => {
      console.log(`${index + 1}. ${issue}`);
    });
  }

  async suggestFixes() {
    if (this.fixes.length === 0) return;
    
    console.log('\n🔧 SUGGESTED FIXES');
    console.log('=' .repeat(50));
    
    this.fixes.forEach((fix, index) => {
      console.log(`${index + 1}. ${fix}`);
    });

    console.log('\n📋 RENDER DEPLOYMENT CHECKLIST:');
    console.log('□ Set MONGODB_URI in Render environment variables');
    console.log('□ Set JWT_SECRET in Render environment variables');
    console.log('□ Set COOKIE_SECRET in Render environment variables');
    console.log('□ Set SESSION_SECRET in Render environment variables');
    console.log('□ Update render.yaml URLs to match your domain');
    console.log('□ Ensure build command is correct');
    console.log('□ Verify start command points to server.js');
    console.log('□ Check Render build logs for errors');
    console.log('□ Test API endpoints after deployment');

    console.log('\n🌐 QUICK TESTS TO RUN AFTER DEPLOYMENT:');
    console.log('1. curl https://quicklocal.shop/health');
    console.log('2. curl https://quicklocal.shop/api/v1/docs');
    console.log('3. Check browser console for CORS errors');
    console.log('4. Test a simple API endpoint like /api/v1/products');

    console.log('\n💡 COMMON RENDER ISSUES:');
    console.log('- Build fails: Check package.json scripts');
    console.log('- Server won\'t start: Check start command and PORT');
    console.log('- Database connection fails: Verify MONGODB_URI');
    console.log('- 404 on API routes: Check route mounting in server.js');
    console.log('- CORS errors: Verify FRONTEND_URL and CLIENT_URL');
  }
}

// Run the troubleshooter
if (require.main === module) {
  const troubleshooter = new RenderTroubleshooter();
  troubleshooter.run().catch(console.error);
}

module.exports = RenderTroubleshooter;
