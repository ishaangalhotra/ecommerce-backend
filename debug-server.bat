@echo off
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
pause