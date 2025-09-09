# 🚀 QuickLocal Backend Migration to Fly.io

## **Prerequisites**
- ✅ Fly.io CLI installed
- ✅ Dockerfile created
- ✅ fly.toml configured
- ✅ Environment variables documented

## **Step-by-Step Migration Commands**

### **1. Authentication**
```powershell
# Sign up or login to Fly.io
flyctl auth signup
# OR if you have an account
flyctl auth login
```

### **2. Create Fly.io App**
```powershell
# Launch app (don't deploy yet)
flyctl launch --no-deploy

# If prompted to change app name, you can accept or modify
```

### **3. Set Environment Variables/Secrets**
Replace with your actual values:

```powershell
# Database
flyctl secrets set MONGO_URI="your_mongodb_connection_string"
flyctl secrets set MONGO_DB_NAME="your_database_name"

# Redis (if used)
flyctl secrets set REDIS_URL="your_redis_connection_string"

# JWT
flyctl secrets set JWT_SECRET="your_jwt_secret"
flyctl secrets set JWT_REFRESH_SECRET="your_jwt_refresh_secret"

# AWS/S3 (if used for file uploads)
flyctl secrets set AWS_ACCESS_KEY_ID="your_aws_key"
flyctl secrets set AWS_SECRET_ACCESS_KEY="your_aws_secret"
flyctl secrets set AWS_BUCKET_NAME="your_bucket_name"

# Payment Gateways
flyctl secrets set RAZORPAY_KEY_ID="your_razorpay_key"
flyctl secrets set RAZORPAY_KEY_SECRET="your_razorpay_secret"
flyctl secrets set STRIPE_SECRET_KEY="your_stripe_key"

# Email Service
flyctl secrets set EMAIL_FROM="your_email@example.com"
flyctl secrets set EMAIL_HOST="your_smtp_host"
flyctl secrets set EMAIL_PORT="587"
flyctl secrets set EMAIL_USER="your_email_user"
flyctl secrets set EMAIL_PASS="your_email_password"

# SMS/Twilio
flyctl secrets set TWILIO_ACCOUNT_SID="your_twilio_sid"
flyctl secrets set TWILIO_AUTH_TOKEN="your_twilio_token"
flyctl secrets set TWILIO_PHONE_NUMBER="your_twilio_phone"

# CORS Origins (Update with your frontend URLs)
flyctl secrets set CORS_ORIGIN="https://your-frontend.vercel.app,http://localhost:3000"
```

### **4. Create Storage Volume (if needed for persistent logs)**
```powershell
flyctl volumes create quicklocal_logs --region bom --size 1
```

### **5. Deploy Application**
```powershell
# First deployment
flyctl deploy

# Check deployment status
flyctl status

# View logs
flyctl logs
```

### **6. Verify Deployment**
```powershell
# Check app URL
flyctl info

# Test health endpoint
curl https://quicklocal-backend.fly.dev/health

# Monitor logs in real-time
flyctl logs -f
```

### **7. Set Custom Domain (Optional)**
```powershell
# Add custom domain
flyctl certs add api.quicklocal.com

# Check certificate status
flyctl certs show api.quicklocal.com
```

## **Environment Variables Checklist**

Copy your current Render environment variables and set them using the commands above:

- [ ] MONGO_URI
- [ ] MONGO_DB_NAME  
- [ ] REDIS_URL
- [ ] JWT_SECRET
- [ ] JWT_REFRESH_SECRET
- [ ] AWS_ACCESS_KEY_ID
- [ ] AWS_SECRET_ACCESS_KEY
- [ ] AWS_BUCKET_NAME
- [ ] RAZORPAY_KEY_ID
- [ ] RAZORPAY_KEY_SECRET
- [ ] STRIPE_SECRET_KEY
- [ ] EMAIL_FROM
- [ ] EMAIL_HOST
- [ ] EMAIL_PORT
- [ ] EMAIL_USER
- [ ] EMAIL_PASS
- [ ] TWILIO_ACCOUNT_SID
- [ ] TWILIO_AUTH_TOKEN
- [ ] TWILIO_PHONE_NUMBER
- [ ] CORS_ORIGIN

## **Frontend Update**

Update your Vercel frontend environment variables:

```bash
# In your frontend .env file or Vercel dashboard
NEXT_PUBLIC_API_URL=https://quicklocal-backend.fly.dev
# OR with custom domain
NEXT_PUBLIC_API_URL=https://api.quicklocal.com
```

## **Testing Commands**

```powershell
# Test API endpoints
curl https://quicklocal-backend.fly.dev/api/health
curl https://quicklocal-backend.fly.dev/api/users

# Check memory usage
flyctl machine status

# Scale if needed (paid plans)
flyctl scale count 2
flyctl scale memory 512
```

## **Monitoring Commands**

```powershell
# View app metrics
flyctl metrics

# Check machine status
flyctl machine status

# View deployment history  
flyctl releases

# Rollback if needed
flyctl releases --image
```

## **Troubleshooting**

If deployment fails:

```powershell
# Check build logs
flyctl logs --app quicklocal-backend

# SSH into the machine
flyctl ssh console

# Restart the app
flyctl machine restart

# Update with new changes
flyctl deploy
```

## **Rollback Plan**

If something goes wrong:

1. Keep your Render deployment active initially
2. Test Fly.io thoroughly before shutting down Render
3. Update frontend to point back to Render if needed:
   ```bash
   NEXT_PUBLIC_API_URL=https://your-app.onrender.com
   ```

## **Cost Optimization**

Free tier limits:
- 256MB RAM
- 3GB storage
- 160GB bandwidth/month

To stay within limits:
- Monitor memory usage with `flyctl metrics`
- Optimize Docker image size
- Use external services for database/redis (MongoDB Atlas, Redis Cloud)
