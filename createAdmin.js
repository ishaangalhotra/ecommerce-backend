/**
 * QuickLocal Admin User Creator
 * This script creates the first admin user for your QuickLocal marketplace
 * Run this script once to create your admin account
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const logger = require('./utils/logger');

// Admin user configuration
const ADMIN_CONFIG = {
  name: process.env.ADMIN_NAME || 'QuickLocal Admin',
  email: process.env.ADMIN_EMAIL || 'admin@quicklocal.com',
  password: process.env.ADMIN_PASSWORD || 'Admin123!@#',
  role: 'admin'
};

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = (message, color = colors.reset) => {
  console.log(`${color}${message}${colors.reset}`);
};

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    log(`✅ MongoDB Connected: ${conn.connection.host}`, colors.green);
    return true;
  } catch (error) {
    log(`❌ Database Connection Error: ${error.message}`, colors.red);
    return false;
  }
};

// Create Supabase admin user
const createSupabaseAdmin = async () => {
  try {
    const { supabaseAdmin } = require('./config/supabase');
    
    log('🔧 Creating admin user in Supabase...', colors.blue);
    
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_CONFIG.email.toLowerCase(),
      password: ADMIN_CONFIG.password,
      user_metadata: {
        name: ADMIN_CONFIG.name,
        role: ADMIN_CONFIG.role
      },
      email_confirm: true // Auto-confirm admin user
    });

    if (authError) {
      // Check if user already exists in Supabase
      if (authError.message.includes('already exists') || authError.message.includes('already registered')) {
        log('⚠️ Admin user already exists in Supabase', colors.yellow);
        
        // Try to get existing user
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = existingUsers.users.find(u => u.email === ADMIN_CONFIG.email.toLowerCase());
        
        if (existingUser) {
          return { user: existingUser };
        }
      }
      throw new Error(`Supabase error: ${authError.message}`);
    }

    log('✅ Supabase admin user created successfully', colors.green);
    return authData;
    
  } catch (error) {
    log(`❌ Supabase admin creation failed: ${error.message}`, colors.red);
    throw error;
  }
};

// Create MongoDB admin user
const createMongoAdmin = async (supabaseId) => {
  try {
    log('🗄️ Creating admin user in MongoDB...', colors.blue);
    
    // Check if admin already exists
    const existingAdmin = await User.findOne({ 
      $or: [
        { email: ADMIN_CONFIG.email.toLowerCase() },
        { role: 'admin' }
      ]
    });
    
    if (existingAdmin) {
      log('⚠️ Admin user already exists in MongoDB', colors.yellow);
      
      // Update existing user to admin if needed
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        existingAdmin.supabaseId = supabaseId;
        await existingAdmin.save();
        log('✅ Updated existing user to admin role', colors.green);
      }
      
      return existingAdmin;
    }
    
    // Create new admin user
    const adminUser = new User({
      name: ADMIN_CONFIG.name,
      email: ADMIN_CONFIG.email.toLowerCase(),
      role: 'admin',
      supabaseId,
      isVerified: true,
      authProvider: 'supabase',
      walletBalance: 0,
      isActive: true,
      password: require('crypto').randomBytes(32).toString('hex') // Random password since Supabase handles auth
    });

    await adminUser.save();
    log('✅ MongoDB admin user created successfully', colors.green);
    return adminUser;
    
  } catch (error) {
    log(`❌ MongoDB admin creation failed: ${error.message}`, colors.red);
    throw error;
  }
};

// Main function
const createAdmin = async () => {
  log('🚀 QuickLocal Admin User Creator', colors.bright);
  log('=====================================', colors.cyan);
  
  try {
    // Connect to database
    const dbConnected = await connectDB();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }
    
    // Create Supabase admin user
    const supabaseData = await createSupabaseAdmin();
    const supabaseUserId = supabaseData.user.id;
    
    // Create MongoDB admin user
    const mongoUser = await createMongoAdmin(supabaseUserId);
    
    // Success message
    log('', colors.reset);
    log('🎉 ADMIN USER CREATED SUCCESSFULLY! 🎉', colors.green + colors.bright);
    log('=====================================', colors.green);
    log(`📧 Email: ${ADMIN_CONFIG.email}`, colors.cyan);
    log(`🔑 Password: ${ADMIN_CONFIG.password}`, colors.cyan);
    log(`👤 Name: ${ADMIN_CONFIG.name}`, colors.cyan);
    log(`🎯 Role: ${ADMIN_CONFIG.role}`, colors.cyan);
    log(`🆔 MongoDB ID: ${mongoUser._id}`, colors.cyan);
    log(`🔐 Supabase ID: ${supabaseUserId}`, colors.cyan);
    log('', colors.reset);
    log('✅ You can now log in to the admin portal!', colors.green);
    log('🌐 Admin Portal: http://localhost:8000/admin-orders-portal.html', colors.blue);
    
    // Additional instructions
    log('', colors.reset);
    log('📋 NEXT STEPS:', colors.yellow + colors.bright);
    log('1. Open your admin portal', colors.yellow);
    log('2. Log in with the credentials above', colors.yellow);
    log('3. Start managing your QuickLocal marketplace!', colors.yellow);
    
  } catch (error) {
    log('', colors.reset);
    log('❌ ADMIN CREATION FAILED!', colors.red + colors.bright);
    log('=====================================', colors.red);
    log(`Error: ${error.message}`, colors.red);
    log('', colors.reset);
    log('🔧 TROUBLESHOOTING:', colors.yellow);
    log('1. Make sure your .env file has MONGODB_URI', colors.yellow);
    log('2. Make sure your .env file has Supabase credentials', colors.yellow);
    log('3. Make sure your database is running', colors.yellow);
    log('4. Check your network connection', colors.yellow);
  } finally {
    // Close database connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      log('🔌 Database connection closed', colors.blue);
    }
    process.exit(0);
  }
};

// Handle script interruption
process.on('SIGINT', () => {
  log('\n🛑 Script interrupted by user', colors.yellow);
  mongoose.connection.close(() => {
    log('🔌 Database connection closed', colors.blue);
    process.exit(0);
  });
});

// Environment validation
const validateEnvironment = () => {
  const requiredVars = ['MONGODB_URI', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
  const missingVars = requiredVars.filter(varName => !process.env[varName] && !process.env[varName.replace('MONGODB_URI', 'MONGO_URI')]);
  
  if (missingVars.length > 0) {
    log('❌ Missing required environment variables:', colors.red);
    missingVars.forEach(varName => {
      log(`   - ${varName}`, colors.red);
    });
    log('', colors.reset);
    log('Please check your .env file and make sure all required variables are set.', colors.yellow);
    process.exit(1);
  }
};

// Show configuration before running
const showConfig = () => {
  log('⚙️ Admin Configuration:', colors.blue);
  log(`   Name: ${ADMIN_CONFIG.name}`, colors.cyan);
  log(`   Email: ${ADMIN_CONFIG.email}`, colors.cyan);
  log(`   Role: ${ADMIN_CONFIG.role}`, colors.cyan);
  log('', colors.reset);
  
  // Show customization tip
  if (!process.env.ADMIN_EMAIL && !process.env.ADMIN_PASSWORD) {
    log('💡 TIP: You can customize admin credentials by setting:', colors.yellow);
    log('   ADMIN_NAME=Your Name', colors.yellow);
    log('   ADMIN_EMAIL=your@email.com', colors.yellow);
    log('   ADMIN_PASSWORD=YourSecurePassword', colors.yellow);
    log('   in your .env file', colors.yellow);
    log('', colors.reset);
  }
};

// Run the script
if (require.main === module) {
  validateEnvironment();
  showConfig();
  createAdmin();
}

module.exports = { createAdmin };
