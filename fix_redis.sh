#!/bin/bash

echo "🔧 Fixing Redis password configuration..."

# Backup redis config
cp ./utils/redis.js ./utils/redis.js.backup

# Check if REDIS_PASSWORD is set but empty
echo "📋 Current Redis password setup:"
grep -n "REDIS_PASSWORD" ./utils/redis.js

# Create a more robust password check
sed -i 's/if (process\.env\.REDIS_PASSWORD) {/if (process.env.REDIS_PASSWORD \&\& process.env.REDIS_PASSWORD.trim() !== "") {/' ./utils/redis.js

echo "✅ Redis configuration updated"
echo "📋 Changed: Only use password if REDIS_PASSWORD exists and is not empty"
