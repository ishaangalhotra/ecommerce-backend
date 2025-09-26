#!/usr/bin/env node
/**
 * Deployment Verification Script for Render
 * Run this on Render to verify files are properly deployed
 * 
 * Usage: node verify-deployment.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 QuickLocal Deployment Verification Starting...\n');

function logSection(title) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📋 ${title}`);
    console.log(`${'='.repeat(50)}`);
}

function checkFile(filePath, description) {
    const absolutePath = path.resolve(filePath);
    console.log(`\n🔸 Checking: ${description}`);
    console.log(`   Path: ${absolutePath}`);
    
    if (fs.existsSync(absolutePath)) {
        const stats = fs.statSync(absolutePath);
        const size = stats.isFile() ? `${Math.round(stats.size / 1024)}KB` : 'directory';
        console.log(`   ✅ EXISTS (${size}) - Modified: ${stats.mtime.toISOString()}`);
        return true;
    } else {
        console.log(`   ❌ NOT FOUND`);
        return false;
    }
}

function listDirectory(dirPath, description) {
    console.log(`\n🔸 Directory contents: ${description}`);
    console.log(`   Path: ${path.resolve(dirPath)}`);
    
    if (fs.existsSync(dirPath)) {
        try {
            const files = fs.readdirSync(dirPath);
            if (files.length === 0) {
                console.log(`   📁 Empty directory`);
            } else {
                files.forEach(file => {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    const type = stats.isDirectory() ? '📁' : '📄';
                    const size = stats.isFile() ? `(${Math.round(stats.size / 1024)}KB)` : '';
                    console.log(`   ${type} ${file} ${size}`);
                });
            }
        } catch (error) {
            console.log(`   ❌ Error reading directory: ${error.message}`);
        }
    } else {
        console.log(`   ❌ Directory does not exist`);
    }
}

// Environment Information
logSection('Environment Information');
console.log(`Node.js Version: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);
console.log(`Current Working Directory: ${process.cwd()}`);
console.log(`Script Directory (__dirname): ${__dirname}`);
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);

// Critical Files Check
logSection('Critical Files Check');
const criticalFiles = [
    ['server.js', 'Main server file'],
    ['package.json', 'Package configuration'],
    ['.env', 'Environment variables (should exist but may be hidden)'],
    ['public/hybrid-auth-client.js', 'Hybrid Auth Client (THE PROBLEM FILE)']
];

let missingCount = 0;
criticalFiles.forEach(([file, desc]) => {
    if (!checkFile(file, desc)) {
        missingCount++;
    }
});

// Directory Structure
logSection('Directory Structure');
const importantDirs = [
    ['.', 'Root directory'],
    ['public', 'Public static files'],
    ['routes', 'API routes'],
    ['utils', 'Utility modules'],
    ['middleware', 'Express middleware']
];

importantDirs.forEach(([dir, desc]) => {
    listDirectory(dir, desc);
});

// Package.json Analysis
logSection('Package.json Analysis');
try {
    const packagePath = path.resolve('package.json');
    if (fs.existsSync(packagePath)) {
        const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        console.log(`📦 App Name: ${packageData.name}`);
        console.log(`📦 Version: ${packageData.version}`);
        console.log(`📦 Main Script: ${packageData.main || 'not specified'}`);
        console.log(`📦 Start Command: ${packageData.scripts?.start || 'not specified'}`);
        
        if (packageData.files) {
            console.log(`📦 Included Files: ${packageData.files.join(', ')}`);
        } else {
            console.log(`📦 No explicit file inclusion (will include all non-ignored files)`);
        }
    }
} catch (error) {
    console.log(`❌ Error reading package.json: ${error.message}`);
}

// Git Status (if available)
logSection('Git Repository Status');
try {
    const { execSync } = require('child_process');
    
    try {
        const branch = execSync('git branch --show-current', { encoding: 'utf8', timeout: 5000 }).trim();
        console.log(`🌿 Current Branch: ${branch}`);
    } catch (e) {
        console.log(`⚠️ Could not determine git branch: ${e.message}`);
    }
    
    try {
        const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8', timeout: 5000 }).trim();
        console.log(`🔗 Latest Commit: ${commit}`);
    } catch (e) {
        console.log(`⚠️ Could not determine git commit: ${e.message}`);
    }
    
    try {
        const status = execSync('git status --porcelain', { encoding: 'utf8', timeout: 5000 });
        if (status.trim()) {
            console.log(`📝 Uncommitted Changes:`);
            console.log(status);
        } else {
            console.log(`✅ Working directory is clean`);
        }
    } catch (e) {
        console.log(`⚠️ Could not check git status: ${e.message}`);
    }
    
} catch (error) {
    console.log(`⚠️ Git not available or repository not initialized`);
}

// Final Summary
logSection('Deployment Verification Summary');
if (missingCount === 0) {
    console.log(`🎉 ALL CRITICAL FILES FOUND!`);
    console.log(`✅ Deployment appears to be complete`);
} else {
    console.log(`❌ ${missingCount} critical files are missing`);
    console.log(`🔧 This explains the 404 errors in your frontend`);
}

// Specific Hybrid Auth Client Check
const hybridAuthPath = path.resolve('public/hybrid-auth-client.js');
if (fs.existsSync(hybridAuthPath)) {
    try {
        const content = fs.readFileSync(hybridAuthPath, 'utf8');
        const firstLine = content.split('\n')[0];
        console.log(`\n🔍 Hybrid Auth Client Details:`);
        console.log(`   Size: ${Math.round(content.length / 1024)}KB`);
        console.log(`   First line: ${firstLine.substring(0, 100)}...`);
        console.log(`   ✅ File content appears valid`);
    } catch (error) {
        console.log(`❌ Error reading hybrid auth client: ${error.message}`);
    }
} else {
    console.log(`\n❌ CRITICAL: hybrid-auth-client.js is MISSING from deployment!`);
    console.log(`🔧 This is why your frontend gets 404 errors`);
    console.log(`📋 Next steps:`);
    console.log(`   1. Ensure public/hybrid-auth-client.js is committed to git`);
    console.log(`   2. Check .gitignore doesn't exclude public/ folder`);
    console.log(`   3. Redeploy to Render`);
}

console.log(`\n🏁 Verification Complete!\n`);
