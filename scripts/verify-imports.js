const fs = require('fs');
const path = require('path');

function checkAsyncHandler() {
  const asyncHandlerPath = path.join(__dirname, '../middleware/asyncHandler.js');
  if (!fs.existsSync(asyncHandlerPath)) {
    console.error('❌ ERROR: asyncHandler.js missing from middleware/');
    console.error('Please create the file at:', asyncHandlerPath);
    return false;
  }
  console.log('✅ Verified asyncHandler.js exists');
  return true;
}

function checkControllerImports() {
  console.log('\n=== Checking controller imports ===');
  const controllersDir = path.join(__dirname, '../controllers');
  let badFiles = [];

  try {
    if (!fs.existsSync(controllersDir)) {
      console.error('❌ ERROR: Controllers directory not found at:', controllersDir);
      return false;
    }

    const files = fs.readdirSync(controllersDir).filter(file => file.endsWith('.js'));
    if (files.length === 0) {
      console.log('ℹ️ No controller files found to check');
      return true;
    }

    for (const file of files) {
      const filePath = path.join(controllersDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes("require('../middleware/async')")) {
        badFiles.push(file);
      }
    }

    if (badFiles.length > 0) {
      console.error('❌ Found incorrect imports in these files:');
      badFiles.forEach(file => console.error('- ' + file));
      console.log('\n🛠️ Run this fix command:');
      console.log('find controllers -type f -name "*.js" -exec sed -i \'s|../middleware/async|../middleware/asyncHandler|g\' {} +');
      return false;
    }

    console.log('✅ All controller imports are correct');
    return true;
  } catch (error) {
    console.error('❌ ERROR: Failed to scan controllers:', error.message);
    return false;
  }
}

// Main execution
console.log('=== Starting Import Verification ===');
const handlerExists = checkAsyncHandler();
const importsValid = checkControllerImports();

if (handlerExists && importsValid) {
  console.log('\n=== All checks passed ===');
  console.log('🚀 Ready for deployment!');
  process.exit(0);
} else {
  console.error('\n=== Issues found ===');
  console.error('❌ Please fix the above errors before deploying');
  process.exit(1);
}
