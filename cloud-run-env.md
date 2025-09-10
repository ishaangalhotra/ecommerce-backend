# Environment Variables for Google Cloud Run

Set these in the Cloud Run service configuration:

## Required Variables:
```
NODE_ENV=production
MONGO_URI=mongodb+srv://ishaangalhotra:1998Ishaan@cluster0.qu0indk.mongodb.net/quicklocal-prod?retryWrites=true&w=majority&appName=Cluster0
MONGO_DB_NAME=quicklocal-prod
JWT_SECRET=your-secure-jwt-secret-here
COOKIE_SECRET=your-secure-cookie-secret-here  
SESSION_SECRET=your-secure-session-secret-here
HOST=0.0.0.0
```

## Optional (add if needed):
```
IMAGEKIT_ENABLED=false
REDIS_ENABLED=false
DISABLE_REDIS=true
CORS_ORIGIN=*
```

## How to set them:
1. Go to: https://console.cloud.google.com/run
2. Select your service: quicklocal-backend
3. Click "Edit & Deploy New Revision"
4. Under "Variables & Secrets" tab
5. Add each environment variable

## Service Configuration:
- **Memory**: 1 GiB
- **CPU**: 1
- **Port**: 3000
- **Region**: asia-south1
- **Allow unauthenticated invocations**: Yes
