#!/usr/bin/env node

/**
 * Optimized Server Startup Script
 * Handles memory management and graceful startup
 */

const { spawn } = require('child_process');
const path = require('path');

// Detect environment
const isDev = process.env.NODE_ENV === 'development';
const isRender = process.env.RENDER || process.env.RAILWAY_ENVIRONMENT;

// Memory configuration based on environment
const getMemoryConfig = () => {
  if (isRender) {
    // Render.com free tier has 512MB
    return ['--max-old-space-size=400', '--expose-gc'];
  } else if (isDev) {
    // Development - more memory for debugging
    return ['--max-old-space-size=1024', '--expose-gc', '--inspect'];
  } else {
    // Production - balanced
    return ['--max-old-space-size=768', '--expose-gc'];
  }
};

// Node.js flags for optimization
const nodeFlags = [
  ...getMemoryConfig(),
  '--enable-source-maps',
  '--unhandled-rejections=strict',
  '--trace-warnings',
  '--trace-deprecation'
];

console.log('🚀 Starting QuickLocal Backend Server...');
console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`💾 Memory Configuration: ${nodeFlags.join(' ')}`);

// Start server with optimized flags
const server = spawn('node', [...nodeFlags, 'server.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Ensure UV thread pool has enough threads
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '8'
  }
});

// Handle server shutdown
const shutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
  server.kill(signal);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('close', (code) => {
  console.log(`\n📊 Server process exited with code ${code}`);
  process.exit(code);
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
