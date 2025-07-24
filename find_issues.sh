#!/bin/bash
echo "=== FINDING DUPLICATE INDEX ISSUES ==="
echo ""
echo "📋 Files with phone index patterns:"
grep -rn "phone.*index.*true\|index.*phone" . --include="*.js" | head -10

echo ""
echo "📋 Files with user index patterns:"
grep -rn "user.*index.*true\|index.*user" . --include="*.js" | head -10

echo ""
echo "📋 Files with shareToken index patterns:"
grep -rn "shareToken.*index.*true\|privacy\.shareToken.*index\|index.*shareToken" . --include="*.js" | head -10

echo ""
echo "=== FINDING CIRCULAR DEPENDENCY ISSUES ==="
echo ""
echo "📋 Socket.IO related files:"
grep -rn "exports\.io\|module\.exports\.io\|\.io\s*=" . --include="*.js" | head -10

echo ""
echo "📋 Files importing/requiring io:"
grep -rn "require.*['\"].*io['\"]" . --include="*.js" | head -10

echo ""
echo "=== REDIS CONFIGURATION ==="
echo ""
echo "📋 Redis password configurations:"
grep -rn "password" ./utils/redis.js 2>/dev/null || echo "Redis config file not found at ./utils/redis.js"
