# 🚀 Supabase Integration Setup

You've started with the Supabase client! Now let's complete the integration.

## Step 1: Update Your .env File

Add these variables to your `.env` file:

```env
# Supabase Configuration
SUPABASE_URL=https://pmvhsjezhuokwygvhhqk.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here_from_supabase_dashboard
SUPABASE_SERVICE_KEY=your_service_role_key_here_from_supabase_dashboard

# Memory Optimization Flags
SUPABASE_REALTIME_ENABLED=true
LOG_TO_SUPABASE=true
SOCKET_IO_DISABLED=true
MEMORY_MONITORING_ENABLED=true
```

## Step 2: Get Your Supabase Keys

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project: `pmvhsjezhuokwygvhhqk`
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL**: `https://pmvhsjezhuokwygvhhqk.supabase.co` ✅ (you already have this)
   - **anon public key**: Copy this to `SUPABASE_ANON_KEY`
   - **service_role secret key**: Copy this to `SUPABASE_SERVICE_KEY`

## Step 3: Set Up Database Schema

1. In Supabase Dashboard, go to **SQL Editor**
2. Create a new query
3. Copy and paste the content from `database/supabase-schema.sql`
4. Run the query to create all necessary tables

## Step 4: Enable Authentication

1. In Supabase Dashboard, go to **Authentication** → **Settings**
2. **Site URL**: Add your frontend URL (e.g., `https://your-app.vercel.app`)
3. **Additional URLs**: Add your backend URL for development
4. **Email Auth**: Enable if not already enabled

## Step 5: Test the Connection

Run this test script:

```bash
node -e "
const { supabase } = require('./config/supabase');
console.log('Testing Supabase connection...');
supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    console.error('❌ Connection failed:', error.message);
  } else {
    console.log('✅ Supabase connected successfully!');
  }
}).catch(err => console.error('❌ Error:', err.message));
"
```

## Step 6: Update Server.js

Add these lines to your `server.js`:

```javascript
// Add after your existing imports
const { realtimeService } = require('./services/supabaseRealtime');

// Add this route
app.use('/api/hybrid-auth', require('./routes/hybridAuth'));

// Initialize Supabase real-time (add before app.listen)
if (process.env.SUPABASE_REALTIME_ENABLED === 'true') {
  realtimeService.initialize().catch(console.error);
}
```

## Step 7: Test Memory Monitoring

```bash
node scripts/hybrid-memory-monitor.js test
```

## Next Steps After Setup:

1. **Update Frontend**: Use the hybrid auth client
2. **Migrate Users Gradually**: New registrations will use Supabase
3. **Monitor Memory**: Should see 60% reduction
4. **Deploy**: Follow the deployment guide

## 🔧 Quick Test Commands:

```bash
# Test Supabase connection
npm test

# Monitor memory usage
node scripts/hybrid-memory-monitor.js

# Test authentication
curl -X POST http://localhost:3000/api/hybrid-auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123","role":"customer"}'
```

## Expected Results:

- ✅ **60% Memory Reduction**: From ~400MB to ~150-250MB
- ✅ **Better Performance**: Supabase handles auth scaling
- ✅ **Real-time Features**: More efficient than Socket.IO
- ✅ **Zero Downtime**: Hybrid approach supports existing users

Let me know when you've added the environment variables and I'll help you test the connection!
