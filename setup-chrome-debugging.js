#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔧 QuickLocal Backend - Chrome DevTools Debugging Setup');
console.log('======================================================\n');

function checkCurrentServer() {
    console.log('📡 Checking current server status...');
    
    const { execSync } = require('child_process');
    try {
        const result = execSync('netstat -ano | findstr :10000', { encoding: 'utf8' });
        if (result.includes('LISTENING')) {
            const pid = result.split(/\s+/).pop();
            console.log(`✅ Server currently running on port 10000 (PID: ${pid})`);
            console.log('⚠️  To enable debugging, you need to restart with --inspect flag\n');
            return pid;
        }
    } catch (error) {
        console.log('❌ No server currently running on port 10000\n');
    }
    return null;
}

function startDebuggingServer() {
    console.log('🚀 Starting server with Chrome DevTools debugging enabled...\n');
    
    const serverArgs = [
        '--inspect=0.0.0.0:9229',  // Enable debugging on all interfaces
        '--expose-gc',             // Allow garbage collection monitoring
        '--max-old-space-size=512', // Limit heap size for testing
        'server.js'
    ];

    console.log('Command to run manually:');
    console.log(`node ${serverArgs.join(' ')}\n`);

    const server = spawn('node', serverArgs, {
        stdio: 'inherit',
        cwd: __dirname
    });

    server.on('error', (error) => {
        console.error('❌ Failed to start server:', error.message);
    });

    server.on('close', (code) => {
        console.log(`\n🛑 Server exited with code ${code}`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down debugging server...');
        server.kill('SIGINT');
        process.exit(0);
    });

    return server;
}

function showDebuggingInstructions() {
    console.log('📋 Chrome DevTools Debugging Instructions:');
    console.log('==========================================\n');
    
    console.log('1. 🌐 Open Chrome and navigate to: chrome://inspect\n');
    
    console.log('2. 🔍 You should see your Node.js process listed under "Remote Target"\n');
    
    console.log('3. 🖱️  Click "inspect" next to your QuickLocal process\n');
    
    console.log('4. 📊 In Chrome DevTools:');
    console.log('   • Go to the "Memory" tab');
    console.log('   • Click "Take heap snapshot" to capture current state');
    console.log('   • Take multiple snapshots over time to compare');
    console.log('   • Use "Allocation instrumentation on timeline" for real-time monitoring\n');
    
    console.log('5. 🔍 Analyzing Memory:');
    console.log('   • Look for objects that are growing over time');
    console.log('   • Check "Detached DOM nodes" (if any)');
    console.log('   • Monitor "Arrays", "Strings", and custom objects');
    console.log('   • Compare snapshots to identify memory leaks\n');
    
    console.log('6. 🎯 Key Things to Monitor:');
    console.log('   • Heap size growth over time');
    console.log('   • Objects that aren\'t being garbage collected');
    console.log('   • Event listeners that might not be cleaned up');
    console.log('   • Database connections or file handles\n');
    
    console.log('7. 🛠️  Alternative: Use the built-in memory debugger:');
    console.log('   node memory-debug.js\n');
}

function createQuickStartScript() {
    const quickStartScript = `@echo off
echo 🚀 Starting QuickLocal Backend with Chrome DevTools Debugging
echo ============================================================

echo.
echo 📡 Stopping any existing server...
taskkill /f /im node.exe 2>nul

echo.
echo 🔧 Starting server with debugging enabled...
node --inspect=0.0.0.0:9229 --expose-gc --max-old-space-size=512 server.js

echo.
echo 🛑 Server stopped
pause`;

    fs.writeFileSync(path.join(__dirname, 'debug-server.bat'), quickStartScript);
    console.log('✅ Created debug-server.bat for easy startup\n');
}

function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        showDebuggingInstructions();
        return;
    }
    
    // Check current server status
    const currentPID = checkCurrentServer();
    
    if (args.includes('--start')) {
        if (currentPID) {
            console.log('❌ Server already running. Stop it first or restart with debugging enabled.');
            return;
        }
        startDebuggingServer();
    } else if (args.includes('--instructions')) {
        showDebuggingInstructions();
    } else {
        // Default: show instructions and create helper scripts
        showDebuggingInstructions();
        createQuickStartScript();
        
        console.log('🎯 Quick Actions:');
        console.log('================\n');
        console.log('• Run: node setup-chrome-debugging.js --start');
        console.log('• Or:  debug-server.bat');
        console.log('• Then: Open chrome://inspect in your browser\n');
        
        console.log('📊 For automated memory monitoring:');
        console.log('• Run: node memory-debug.js');
        console.log('• Check: memory-debug.log for detailed logs\n');
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    startDebuggingServer,
    showDebuggingInstructions,
    checkCurrentServer
};
