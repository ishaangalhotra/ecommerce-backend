@echo off
echo.
echo =====================================
echo    QuickLocal Backend Server
echo =====================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    npm install
)

REM Run dependency health check
echo 🔍 Running health check...
node check-dependencies.js
if errorlevel 1 (
    echo.
    echo ❌ Health check failed. Please fix the issues above.
    pause
    exit /b 1
)

REM Start the server
echo.
echo 🚀 Starting QuickLocal Backend Server...
echo 🌐 Server will be available at: http://localhost:10000
echo 📊 API Documentation: http://localhost:10000/api/v1/docs
echo 💡 Press Ctrl+C to stop the server
echo.

node start-optimized.js
