# QuickLocal Render Deployment Guide

## 🚀 **Critical Environment Variables for Render**

### **Required (Critical - Server won't start without these):**
```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/quicklocal?retryWrites=true&w=majority
JWT_SECRET=your-super-secure-jwt-secret-key-min-32-chars
COOKIE_SECRET=your-super-secure-cookie-secret-min-32-chars
SESSION_SECRET=your-super-secure-session-secret-min-32-chars
```

### **Essential (Highly Recommended):**
```bash
NODE_ENV=production
PORT=10000
APP_NAME=QuickLocal
APP_VERSION=2.1.0
API_VERSION=v1

# Security
BCRYPT_SALT_ROUNDS=12
JWT_ACCESS_EXPIRES=24h
JWT_REFRESH_EXPIRES=7d

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=1000
AUTH_RATE_LIMIT_MAX=20
ORDER_RATE_LIMIT_MAX=10
MAX_LOGIN_ATTEMPTS=5

# Features
ENABLE_SOCKET_IO=true
FEATURE_LIVE_TRACKING=true
FEATURE_CHAT=true
FEATURE_REVIEWS=true
ENABLE_COMPRESSION=true
ENABLE_HELMET=true
```

### **Optional (Performance & Features):**
```bash
# Clustering (Disable for free tier)
ENABLE_CLUSTER_MODE=false
CLUSTER_WORKERS=1

# Caching (Disable Redis for free tier)
REDIS_ENABLED=false
DISABLE_REDIS=true

# Monitoring
ENABLE_METRICS=true
ENABLE_API_DOCS=true
ENABLE_REQUEST_LOGGING=true

# File Upload
MAX_FILE_SIZE=10485760
ALLOWED_FILE_TYPES=image/jpeg,image/png,image/webp,image/gif

# CORS (Add your frontend domains)
FRONTEND_URLS=https://quicklocal.shop,https://www.quicklocal.shop
ALLOWED_ORIGINS=https://quicklocal.shop,https://www.quicklocal.shop
CLIENT_URL=https://quicklocal.shop
```

## 🔧 **Render Service Configuration**

### **Build Command:**
```bash
npm install
```

### **Start Command:**
```bash
node server.js
```

### **Health Check Path:**
```
/health
```

## 🚨 **Common Issues & Solutions**

### **Issue 1: 503 Service Unavailable**
**Causes:**
- Missing critical environment variables
- MongoDB connection failure
- Memory limits exceeded
- Build failure

**Solutions:**
1. Check Render logs for specific error messages
2. Verify all required environment variables are set
3. Test MongoDB connection string
4. Ensure sufficient memory allocation

### **Issue 2: Memory Issues (Free Tier)**
**Solutions:**
```bash
# Add these to reduce memory usage
ENABLE_CLUSTER_MODE=false
CLUSTER_WORKERS=1
REDIS_ENABLED=false
DISABLE_REDIS=true
COMPRESSION_LEVEL=1
DB_POOL_SIZE=5
```

### **Issue 3: Cold Starts (Free Tier)**
**Solutions:**
- Services sleep after 15 minutes of inactivity
- First request may take 30+ seconds
- Consider upgrading to paid tier for production

## 📊 **Monitoring Your Deployment**

### **Health Check Endpoints:**
- `GET /health` - Comprehensive health status
- `GET /status` - Server statistics
- `GET /metrics` - Performance metrics
- `GET /api/v1/docs` - API documentation

### **Expected Health Response:**
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy" },
    "memory": { "status": "healthy" },
    "system": { "status": "healthy" },
    "routes": { "status": "healthy" },
    "features": { "status": "healthy" }
  }
}
```

## 🔄 **Deployment Steps**

1. **Update Environment Variables** in Render dashboard
2. **Trigger Manual Deploy** or push to connected Git repo
3. **Monitor Build Logs** for any errors
4. **Test Health Endpoint** once deployed
5. **Verify API Endpoints** are responding
6. **Test Frontend Integration** with new backend

## 🧪 **Testing Commands**

```bash
# Test health
curl https://quicklocal-backend.onrender.com/health

# Test API
curl https://quicklocal-backend.onrender.com/api/v1/products

# Test docs
curl https://quicklocal-backend.onrender.com/api/v1/docs
```

## 🆘 **Troubleshooting Checklist**

- [ ] All required environment variables set
- [ ] MongoDB URI is correct and accessible
- [ ] JWT secrets are at least 32 characters
- [ ] Build completed without errors
- [ ] Health endpoint returns 200
- [ ] Logs show "QuickLocal marketplace is ready for business!"
- [ ] No memory limit errors in logs
- [ ] Database connection successful

## 📞 **Support**

If issues persist:
1. Check Render service logs
2. Verify MongoDB Atlas network access
3. Test environment variables locally
4. Consider upgrading Render plan for more resources
