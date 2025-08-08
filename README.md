# QuickLocal E-commerce Platform

Ultra-fast 20-minute local delivery platform with AI-powered logistics and real-time tracking.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- MongoDB 5.0+
- Redis (optional, for caching)
- Git

### 1. Clone and Install
```bash
git clone <your-repo-url>
cd backend
npm install
```

### 2. Environment Setup
```bash
# Copy environment template
cp env.example .env

# Edit .env with your configuration
nano .env
```

### 3. Database Setup
```bash
# Start MongoDB (if not running)
mongod

# Run migrations
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

### 4. Start Development Server
```bash
npm run dev
```

Server will start at `http://localhost:10000`

## 📁 Project Structure

```
backend/
├── config/           # Configuration files
├── controllers/      # Business logic
├── middleware/       # Express middleware
├── models/          # MongoDB schemas
├── routes/          # API routes
├── services/        # External services
├── utils/           # Utility functions
├── migrations/      # Database migrations
├── tests/           # Test files
└── server.js        # Main server file
```

## 🔧 Configuration

### Environment Variables

#### Core Configuration
```env
NODE_ENV=development
PORT=10000
MONGODB_URI=mongodb://localhost:27017/quicklocal
JWT_SECRET=your-super-secret-jwt-key
```

#### Payment Gateways
```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Razorpay
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
```

#### Email Service
```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

#### Cloud Storage
```env
# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## 🗄️ Database Models

### Core Models
- **User**: Customer and seller accounts
- **Product**: Product catalog with variants
- **Order**: Order management and tracking
- **Category**: Product categorization
- **Cart**: Shopping cart functionality
- **Notification**: Real-time notifications

### Key Features
- Geospatial indexing for location-based queries
- Full-text search capabilities
- Real-time updates via Socket.IO
- Comprehensive audit trails

## 🔌 API Endpoints

### Authentication
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/refresh` - Token refresh
- `POST /api/v1/auth/logout` - User logout

### Products
- `GET /api/v1/products` - Get products with filters
- `GET /api/v1/products/:id` - Get single product
- `POST /api/v1/products` - Create product (seller)
- `PUT /api/v1/products/:id` - Update product (seller)
- `DELETE /api/v1/products/:id` - Delete product (seller)

### Orders
- `POST /api/v1/orders` - Create order
- `GET /api/v1/orders` - Get user orders
- `GET /api/v1/orders/:id` - Get order details
- `PATCH /api/v1/orders/:id/cancel` - Cancel order

### Cart
- `GET /api/v1/cart` - Get cart items
- `POST /api/v1/cart/add` - Add to cart
- `PUT /api/v1/cart/update` - Update cart item
- `DELETE /api/v1/cart/remove` - Remove from cart

### Categories
- `GET /api/v1/categories` - Get all categories
- `GET /api/v1/categories/:id` - Get category with products
- `POST /api/v1/categories` - Create category (admin)
- `PUT /api/v1/categories/:id` - Update category (admin)

### Analytics
- `GET /api/v1/analytics/dashboard` - Dashboard analytics
- `GET /api/v1/analytics/sales` - Sales analytics
- `GET /api/v1/analytics/products` - Product analytics
- `GET /api/v1/analytics/customers` - Customer analytics

### Notifications
- `GET /api/v1/notifications` - Get user notifications
- `PATCH /api/v1/notifications/:id/read` - Mark as read
- `PATCH /api/v1/notifications/read-all` - Mark all as read
- `GET /api/v1/notifications/settings` - Get notification settings

## 🛡️ Security Features

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- Password hashing with bcrypt
- Session management with MongoDB store

### Rate Limiting
- API rate limiting per IP
- Authentication endpoint protection
- Order creation rate limiting
- Payment endpoint protection

### Security Headers
- Helmet.js for security headers
- CORS configuration
- XSS protection
- Content Security Policy (CSP)

### Input Validation
- Express-validator for request validation
- MongoDB injection protection
- File upload validation
- SQL injection prevention

## 🚀 Performance Features

### Caching
- Redis caching for frequently accessed data
- Response caching with TTL
- Database query optimization
- Static asset caching

### Database Optimization
- Indexed queries for fast retrieval
- Geospatial indexes for location queries
- Aggregation pipelines for analytics
- Connection pooling

### Real-time Features
- Socket.IO for live updates
- Order tracking in real-time
- Live chat support
- Push notifications

## 📊 Monitoring & Logging

### Health Checks
- `GET /health` - System health status
- `GET /status` - Detailed system status
- `GET /metrics` - Prometheus metrics

### Logging
- Winston logger with multiple transports
- Request/response logging
- Error tracking with Sentry
- Performance monitoring

### Analytics
- Business intelligence dashboard
- Sales analytics and reporting
- Customer behavior tracking
- Product performance metrics

## 🧪 Testing

### Run Tests
```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage
```

### Test Structure
```
tests/
├── unit/           # Unit tests
├── integration/    # Integration tests
├── e2e/           # End-to-end tests
└── setup.js       # Test configuration
```

## 🚀 Deployment

### Production Setup
```bash
# Install production dependencies
npm ci --only=production

# Set production environment
NODE_ENV=production

# Run database migrations
npm run db:migrate

# Start production server
npm start
```

### Docker Deployment
```bash
# Build Docker image
docker build -t quicklocal-backend .

# Run container
docker run -p 10000:10000 --env-file .env quicklocal-backend
```

### PM2 Deployment
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js

# Monitor
pm2 monit
```

## 🔧 Development

### Code Quality
```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Run validation
npm run validate
```

### Database Management
```bash
# Run migrations
npm run db:migrate

# Rollback migrations
npm run db:rollback

# Seed database
npm run db:seed

# Reset database
npm run db:reset

# Backup database
npm run db:backup
```

### API Documentation
```bash
# Generate API docs
npm run docs:generate

# Serve API docs
npm run docs:serve
```

## 📈 Scaling

### Horizontal Scaling
- Cluster mode with multiple workers
- Load balancing with Nginx
- Database sharding
- Redis clustering

### Vertical Scaling
- Memory optimization
- CPU optimization
- Database query optimization
- Caching strategies

## 🔍 Troubleshooting

### Common Issues

#### Database Connection
```bash
# Check MongoDB status
sudo systemctl status mongod

# Check connection string
echo $MONGODB_URI
```

#### Port Issues
```bash
# Check if port is in use
lsof -i :10000

# Kill process using port
kill -9 <PID>
```

#### Memory Issues
```bash
# Check memory usage
free -h

# Increase Node.js memory
node --max-old-space-size=4096 server.js
```

### Logs
```bash
# View application logs
npm run logs

# View error logs
npm run logs:error

# View access logs
npm run logs:access
```

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create feature branch
3. Make changes
4. Run tests
5. Submit pull request

### Code Standards
- Follow ESLint configuration
- Write unit tests for new features
- Update documentation
- Follow commit message conventions

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

### Documentation
- API Documentation: `/api/v1/docs`
- Health Check: `/health`
- System Status: `/status`

### Contact
- Email: support@quicklocal.com
- Issues: GitHub Issues
- Documentation: `/docs`

---

**QuickLocal** - Revolutionizing local commerce with AI-powered logistics and 20-minute delivery.
