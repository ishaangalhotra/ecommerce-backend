#!/usr/bin/env node
/**
 * Migration Script: Legacy Auth to Hybrid Auth
 * 
 * This script updates all route files to use the new hybrid authentication system
 * instead of the legacy JWT-only authentication system.
 */

const fs = require('fs');
const path = require('path');

console.log('🔄 Starting migration from legacy auth to hybrid auth...\n');

// Route files to update
const routeFiles = [
  'routes/cart.js',
  'routes/orders.js', 
  'routes/users.js',
  'routes/localdelivery.js',
  'routes/categories.js',
  'routes/wishlist.js',
  'routes/seller.js',
  'routes/adminproducts.js',
  'routes/analytics.js',
  'routes/notifications.js',
  'routes/admin.js',
  'routes/payment-routes.js'
];

// Import replacements
const importReplacements = [
  {
    search: /const \{ protect \} = require\('\.\.\/middleware\/authMiddleware'\);/g,
    replace: "const { hybridProtect } = require('../middleware/hybridAuth');"
  },
  {
    search: /const \{ protect, authorize \} = require\('\.\.\/middleware\/authMiddleware'\);/g,
    replace: "const { hybridProtect, requireRole } = require('../middleware/hybridAuth');\nconst { authorize } = require('../middleware/authMiddleware'); // Keep for backward compatibility"
  },
  {
    search: /const \{ protect, authorize, checkPermission \} = require\('\.\.\/middleware\/authMiddleware'\);/g,
    replace: "const { hybridProtect, requireRole } = require('../middleware/hybridAuth');\nconst { authorize, checkPermission } = require('../middleware/authMiddleware'); // Keep for backward compatibility"
  },
  {
    search: /const \{ protect, checkPermission \} = require\('\.\.\/middleware\/authMiddleware'\);/g,
    replace: "const { hybridProtect } = require('../middleware/hybridAuth');\nconst { checkPermission } = require('../middleware/authMiddleware'); // Keep for backward compatibility"
  },
  {
    search: /const \{ protect, restrictTo \} = require\('\.\.\/middleware\/authMiddleware'\);/g,
    replace: "const { hybridProtect, requireRole } = require('../middleware/hybridAuth');\nconst { restrictTo } = require('../middleware/authMiddleware'); // Keep for backward compatibility"
  }
];

// Function replacements
const functionReplacements = [
  {
    search: /\bprotect\b/g,
    replace: 'hybridProtect'
  },
  {
    search: /\bauthorize\(/g,
    replace: 'requireRole('
  }
];

let totalFiles = 0;
let updatedFiles = 0;

routeFiles.forEach(routeFile => {
  const filePath = path.join(__dirname, '..', routeFile);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⏭️  Skipping ${routeFile} (file not found)`);
    return;
  }
  
  totalFiles++;
  
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;
    
    // Apply import replacements
    importReplacements.forEach(replacement => {
      if (replacement.search.test(content)) {
        content = content.replace(replacement.search, replacement.replace);
        hasChanges = true;
      }
    });
    
    // Apply function replacements
    functionReplacements.forEach(replacement => {
      if (replacement.search.test(content)) {
        content = content.replace(replacement.search, replacement.replace);
        hasChanges = true;
      }
    });
    
    if (hasChanges) {
      fs.writeFileSync(filePath, content);
      console.log(`✅ Updated ${routeFile}`);
      updatedFiles++;
    } else {
      console.log(`➡️  No changes needed for ${routeFile}`);
    }
    
  } catch (error) {
    console.error(`❌ Error updating ${routeFile}:`, error.message);
  }
});

console.log(`\n📊 Migration Summary:`);
console.log(`   Total files processed: ${totalFiles}`);
console.log(`   Files updated: ${updatedFiles}`);
console.log(`   Files skipped: ${totalFiles - updatedFiles}`);

if (updatedFiles > 0) {
  console.log('\n✅ Migration completed successfully!');
  console.log('\n📝 Next Steps:');
  console.log('   1. Test the updated routes with hybrid authentication');
  console.log('   2. Update any remaining manual references to legacy auth');
  console.log('   3. Consider removing legacy auth files after thorough testing');
} else {
  console.log('\n🤷 No files needed updating. Migration may already be complete.');
}
