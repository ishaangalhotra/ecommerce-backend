#!/usr/bin/env node

/**
 * Environment Check for QuickLocal.shop
 */

const fs = require('fs');
const path = require('path');

class EnvironmentChecker {
  constructor() {
    this.issues = [];
    this.warnings = [];
  }

  checkEnvironmentVariables() {
    console.log('🔍 Checking Environment Variables...');
    
    const requiredVars = [
      'MONGODB_URI',
      'JWT_SECRET',
      'SESSION_SECRET',
      'NODE_ENV'
    ];

    const optionalVars = [
      'ADMIN_EMAIL',
      'ADMIN_PASSWORD',
      'CLOUDINARY_URL',
      'STRIPE_SECRET_KEY',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET'
    ];

    requiredVars.forEach(varName => {
      if (!process.env[varName]) {
        this.issues.push(`Missing required environment variable: ${varName}`);
      } else {
        console.log(`✅ ${varName}: Set`);
      }
    });

    optionalVars.forEach(varName => {
      if (!process.env[varName]) {
        this.warnings.push(`Missing optional environment variable: ${varName}`);
      } else {
        console.log(`✅ ${varName}: Set`);
      }
    });
  }

  checkDatabaseConnection() {
    console.log('\n📊 Checking Database Connection...');
    
    const mongoose = require('mongoose');
    
    mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }).then(() => {
      console.log('✅ Database connection successful');
      mongoose.connection.close();
    }).catch(error => {
      this.issues.push(`Database connection failed: ${error.message}`);
    });
  }

  generateReport() {
    console.log('\n📋 ENVIRONMENT REPORT');
    console.log('=====================');
    
    if (this.issues.length === 0 && this.warnings.length === 0) {
      console.log('✅ Environment is properly configured');
    } else {
      if (this.issues.length > 0) {
        console.log(`❌ ${this.issues.length} critical issues:`);
        this.issues.forEach(issue => console.log(`  - ${issue}`));
      }
      
      if (this.warnings.length > 0) {
        console.log(`⚠️ ${this.warnings.length} warnings:`);
        this.warnings.forEach(warning => console.log(`  - ${warning}`));
      }
    }
  }

  async run() {
    console.log('🔍 QuickLocal Environment Checker');
    console.log('=================================');
    
    this.checkEnvironmentVariables();
    await this.checkDatabaseConnection();
    this.generateReport();
  }
}

const checker = new EnvironmentChecker();
checker.run().catch(console.error);
