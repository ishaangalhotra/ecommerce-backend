# QuickLocal Backend - Environment Variables Setup
# Replace the values below with your actual values from Render

# CRITICAL: Replace these with your actual values
$MONGO_URI = "mongodb+srv://your-username:password@your-cluster.mongodb.net"
$MONGO_DB_NAME = "your-database-name"
$JWT_SECRET = "your-jwt-secret"
$JWT_REFRESH_SECRET = "your-jwt-refresh-secret"

# Payment Gateway (Replace with actual values)
$RAZORPAY_KEY_ID = "your-razorpay-key"
$RAZORPAY_KEY_SECRET = "your-razorpay-secret"
$STRIPE_SECRET_KEY = "your-stripe-secret"

# Email Configuration (Replace with actual values)
$EMAIL_FROM = "noreply@quicklocal.com"
$EMAIL_HOST = "smtp.gmail.com"
$EMAIL_PORT = "587"
$EMAIL_USER = "your-email@gmail.com"
$EMAIL_PASS = "your-app-password"

# SMS/Twilio (Replace with actual values)
$TWILIO_ACCOUNT_SID = "your-twilio-sid"
$TWILIO_AUTH_TOKEN = "your-twilio-token"
$TWILIO_PHONE_NUMBER = "your-twilio-phone"

# AWS/S3 (if you use it for uploads)
$AWS_ACCESS_KEY_ID = "your-aws-key"
$AWS_SECRET_ACCESS_KEY = "your-aws-secret"
$AWS_BUCKET_NAME = "your-bucket-name"
$AWS_REGION = "ap-south-1"

# CORS (Update with your frontend URL)
$CORS_ORIGIN = "https://your-frontend.vercel.app,http://localhost:3000"

Write-Host "Setting environment variables..." -ForegroundColor Green

# Set the secrets (uncomment and run after replacing values)
# flyctl secrets set MONGO_URI="$MONGO_URI"
# flyctl secrets set MONGO_DB_NAME="$MONGO_DB_NAME"
# flyctl secrets set JWT_SECRET="$JWT_SECRET"
# flyctl secrets set JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET"
# flyctl secrets set RAZORPAY_KEY_ID="$RAZORPAY_KEY_ID"
# flyctl secrets set RAZORPAY_KEY_SECRET="$RAZORPAY_KEY_SECRET"
# flyctl secrets set STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY"
# flyctl secrets set EMAIL_FROM="$EMAIL_FROM"
# flyctl secrets set EMAIL_HOST="$EMAIL_HOST"
# flyctl secrets set EMAIL_PORT="$EMAIL_PORT"
# flyctl secrets set EMAIL_USER="$EMAIL_USER"
# flyctl secrets set EMAIL_PASS="$EMAIL_PASS"
# flyctl secrets set TWILIO_ACCOUNT_SID="$TWILIO_ACCOUNT_SID"
# flyctl secrets set TWILIO_AUTH_TOKEN="$TWILIO_AUTH_TOKEN"
# flyctl secrets set TWILIO_PHONE_NUMBER="$TWILIO_PHONE_NUMBER"
# flyctl secrets set AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
# flyctl secrets set AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
# flyctl secrets set AWS_BUCKET_NAME="$AWS_BUCKET_NAME"
# flyctl secrets set AWS_REGION="$AWS_REGION"
# flyctl secrets set CORS_ORIGIN="$CORS_ORIGIN"

Write-Host "Environment variables setup complete!" -ForegroundColor Green
Write-Host "Next step: flyctl deploy" -ForegroundColor Yellow
