#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

console.log('🚀 QuickLocal Project Startup');
console.log('=============================');

async function checkPrerequisites() {
  console.log('\n📋 Checking prerequisites...');
  
  // Check if .env file exists
  try {
    await fs.access('.env');
    console.log('✅ .env file found');
  } catch {
    console.log('❌ .env file not found');
    console.log('Please copy env.example to .env and configure your environment variables');
    return false;
  }

  // Check if node_modules exists
  try {
    await fs.access('node_modules');
    console.log('✅ node_modules found');
  } catch {
    console.log('❌ node_modules not found');
    console.log('Please run: npm install');
    return false;
  }

  return true;
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔄 Running: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Command completed successfully`);
        resolve();
      } else {
        console.log(`❌ Command failed with code ${code}`);
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', (error) => {
      console.log(`❌ Command failed: ${error.message}`);
      reject(error);
    });
  });
}

async function startProject() {
  try {
    // Check prerequisites
    const prerequisitesMet = await checkPrerequisites();
    if (!prerequisitesMet) {
      console.log('\n❌ Prerequisites not met. Please fix the issues above and try again.');
      process.exit(1);
    }

    console.log('\n🎯 Starting QuickLocal project...');

    // Run database migrations
    try {
      await runCommand('node', ['scripts/run-migrations.js']);
    } catch (error) {
      console.log('⚠️ Database migration failed. Make sure MongoDB is running.');
      console.log('You can start MongoDB with: docker run -d --name mongodb -p 27017:27017 mongo:latest');
    }

    // Seed database
    try {
      await runCommand('node', ['scripts/seed.js']);
    } catch (error) {
      console.log('⚠️ Database seeding failed. This is optional for development.');
    }

    // Start the development server
    console.log('\n🚀 Starting development server...');
    await runCommand('npm', ['run', 'dev']);

  } catch (error) {
    console.error('\n❌ Failed to start project:', error.message);
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
QuickLocal Project Startup Script

Usage:
  node scripts/start-project.js [options]

Options:
  --help, -h     Show this help message
  --migrate      Run database migrations only
  --seed         Seed database only
  --dev          Start development server only

Examples:
  node scripts/start-project.js --migrate
  node scripts/start-project.js --seed
  node scripts/start-project.js --dev
  `);
  process.exit(0);
}

if (args.includes('--migrate')) {
  runCommand('node', ['scripts/run-migrations.js'])
    .then(() => console.log('✅ Migration completed'))
    .catch(() => process.exit(1));
} else if (args.includes('--seed')) {
  runCommand('node', ['scripts/seed.js'])
    .then(() => console.log('✅ Seeding completed'))
    .catch(() => process.exit(1));
} else if (args.includes('--dev')) {
  runCommand('npm', ['run', 'dev'])
    .then(() => console.log('✅ Development server started'))
    .catch(() => process.exit(1));
} else {
  startProject();
}
