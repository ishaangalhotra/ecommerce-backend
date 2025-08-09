#!/bin/bash

# QuickLocal Live Deployment Script
# Run this on your server to deploy the backend

echo "🚀 Deploying QuickLocal Backend..."

# 1. Navigate to backend directory
cd /path/to/your/backend

# 2. Pull latest changes
git pull origin main

# 3. Install dependencies
npm install

# 4. Set environment variables (if not already set)
export MONGODB_URI="your-mongodb-connection-string"
export JWT_SECRET="your-jwt-secret"
export SESSION_SECRET="your-session-secret"
export NODE_ENV="production"

# 5. Run database migrations
npm run db:migrate

# 6. Start the server
npm start

echo "✅ Deployment completed!"
echo "🌐 Your API should now be accessible at: https://quicklocal.shop/api"
