const fs = require('fs');
const path = require('path');

console.log('🚀 QuickLocal Development Setup');
console.log('================================');

// Check if .env file exists
const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', 'env.example');

if (!fs.existsSync(envPath)) {
  console.log('📝 Creating .env file from template...');
  
  if (fs.existsSync(envExamplePath)) {
    const envContent = fs.readFileSync(envExamplePath, 'utf8');
    
    // Update the MongoDB URI to use localhost
    const updatedContent = envContent.replace(
      /MONGODB_URI=.*/,
      'MONGODB_URI=mongodb://localhost:27017/quicklocal'
    ).replace(
      /MONGO_URI=.*/,
      'MONGO_URI=mongodb://localhost:27017/quicklocal'
    ).replace(
      /DB_NAME=.*/,
      'DB_NAME=quicklocal'
    );
    
    fs.writeFileSync(envPath, updatedContent);
    console.log('✅ Created .env file with local MongoDB configuration');
  } else {
    console.log('❌ env.example file not found');
    process.exit(1);
  }
} else {
  console.log('✅ .env file already exists');
}

console.log('\n📋 Next Steps:');
console.log('1. Install MongoDB locally or use Docker');
console.log('2. Start MongoDB service');
console.log('3. Run: npm run db:migrate');
console.log('4. Run: npm run dev');

console.log('\n🐳 Docker MongoDB (Recommended):');
console.log('docker run -d --name mongodb -p 27017:27017 mongo:latest');

console.log('\n💻 Manual MongoDB Installation:');
console.log('- Windows: Download from https://www.mongodb.com/try/download/community');
console.log('- macOS: brew install mongodb-community');
console.log('- Ubuntu: sudo apt install mongodb');

console.log('\n🔧 After MongoDB is running:');
console.log('npm run db:migrate  # Run database migrations');
console.log('npm run dev         # Start development server');
