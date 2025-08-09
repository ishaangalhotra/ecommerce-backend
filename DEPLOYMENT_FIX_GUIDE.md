# QuickLocal Backend Deployment Fix Guide

## ✅ Issues Fixed
1. **Frontend API URLs Updated**: All frontend files now point to `https://quicklocal-backend.onrender.com/api/v1/`
2. **API Version Consistency**: Backend uses `/api/v1/` prefix, frontend now matches this
3. **Configuration Files Updated**: All API clients, payment handlers, and dashboard scripts corrected

## 🔍 Current Status
- **Frontend**: ✅ Working at `https://quicklocal.shop`
- **Backend Health**: ❌ 503 Server Unavailable at `https://quicklocal-backend.onrender.com`

## 🚨 Critical Issues Identified

### 1. Backend Server Not Responding (503 Error)
**Symptoms:**
- `curl https://quicklocal-backend.onrender.com/health` returns 503
- All API endpoints return 404 or connection errors

**Possible Causes:**
- Render service is sleeping (free tier limitation)
- Environment variables not set correctly
- Database connection failure
- Memory/resource limits exceeded
- Build or startup failure

### 2. Immediate Actions Required

#### A. Check Render Dashboard
1. Log into your Render dashboard
2. Navigate to your `quicklocal-backend` service
3. Check the **Logs** tab for errors
4. Verify **Environment Variables** are set:
   ```
   MONGODB_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret
   NODE_ENV=production
   PORT=10000
   ```

#### B. Wake Up Sleeping Service
If using Render's free tier, the service sleeps after 15 minutes of inactivity:
```bash
# Wake up the service
curl https://quicklocal-backend.onrender.com/health
```

#### C. Check Build Logs
Look for these common issues in Render logs:
- MongoDB connection timeout
- Missing environment variables
- npm install failures
- Port binding issues

## 🛠️ Frontend Files Fixed

### Updated API URLs in:
- `frontend/js/config.js` - Main configuration
- `frontend/js/api/api-client.js` - API client
- `frontend/payment.js` - Payment processing
- `frontend/js/main.js` - Main application
- `frontend/order-manager.js` - Order management
- `frontend/seller-dashboard.js` - Seller dashboard
- `backend/scripts/setup-products.js` - Product setup script

### Before (Broken):
```javascript
const API_BASE_URL = 'https://ecommerce-backend-8ykq.onrender.com/api';
fetch(`${API_BASE_URL}/products`); // Would call /api/products
```

### After (Fixed):
```javascript
const API_BASE_URL = 'https://quicklocal-backend.onrender.com/api/v1';
fetch(`${API_BASE_URL}/products`); // Now calls /api/v1/products
```

## 🔧 Next Steps

### 1. Immediate (Critical)
1. **Check Render Logs**: Look for startup errors
2. **Verify Environment Variables**: Ensure all required vars are set
3. **Test Database Connection**: MongoDB URI must be valid
4. **Restart Service**: Try manual restart in Render dashboard

### 2. Testing Commands
Once backend is running, test these endpoints:
```bash
# Health check
curl https://quicklocal-backend.onrender.com/health

# Products API
curl https://quicklocal-backend.onrender.com/api/v1/products

# API docs
curl https://quicklocal-backend.onrender.com/api/v1/docs
```

### 3. Product Addition
After backend is fixed, you can add products using:
```bash
# Set your admin token
export ADMIN_TOKEN="your_jwt_token"

# Run the setup script
node scripts/setup-products.js
```

## 📊 Service Architecture
```
quicklocal.shop (Frontend - Working ✅)
     ↓ API calls
quicklocal-backend.onrender.com (Backend - Broken ❌)
     ↓ Database
MongoDB Atlas/Cluster (Status Unknown)
```

## 🔍 Debugging Checklist
- [ ] Render service is running (not sleeping)
- [ ] Environment variables are set
- [ ] MongoDB connection is working
- [ ] Build completed successfully
- [ ] No memory/CPU limits exceeded
- [ ] All dependencies installed correctly
- [ ] Port 10000 is available

## 💡 Common Solutions
1. **Service Sleeping**: Make a request to wake it up
2. **Environment Variables**: Double-check all required vars
3. **Database Issues**: Verify MongoDB URI and network access
4. **Memory Limits**: Upgrade Render plan or optimize code
5. **Build Failures**: Check package.json and dependencies

## 📞 Support Resources
- Render Documentation: https://render.com/docs
- MongoDB Atlas Support: https://docs.atlas.mongodb.com/
- Node.js Debugging: Enable debug logs with `DEBUG=*`

---
**Status**: Frontend ready, backend needs deployment fix
**Priority**: Critical - blocking all API functionality
**ETA**: Should be resolved within 1-2 hours once Render issues are addressed
