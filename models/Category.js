const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    lowercase: true
  },
  description: {
    type: String,
    trim: true
  },
  image: {
    url: String,
    publicId: String
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  level: {
    type: Number,
    default: 0
  },
  path: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  seo: {
    title: String,
    description: String,
    keywords: [String]
  },
  productCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Create indexes
categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1 });
categorySchema.index({ path: 1 });
categorySchema.index({ isActive: 1 });

// Generate slug from name
categorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
  next();
});

// Update path and level based on parent
categorySchema.pre('save', async function(next) {
  if (this.parent) {
    const parentCategory = await this.constructor.findById(this.parent);
    if (parentCategory) {
      this.level = parentCategory.level + 1;
      this.path = parentCategory.path ? `${parentCategory.path}/${parentCategory.slug}` : parentCategory.slug;
    }
  } else {
    this.level = 0;
    this.path = '';
  }
  next();
});

// Virtual for full path including current category
categorySchema.virtual('fullPath').get(function() {
  return this.path ? `${this.path}/${this.slug}` : this.slug;
});

// Method to get all subcategories
categorySchema.methods.getSubcategories = function() {
  return this.constructor.find({ parent: this._id, isActive: true });
};

// Static method to get category tree
categorySchema.statics.getTree = function() {
  return this.aggregate([
    { $match: { isActive: true } },
    {
      $graphLookup: {
        from: 'categories',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'parent',
        as: 'subcategories',
        maxDepth: 10,
        restrictSearchWithMatch: { isActive: true }
      }
    },
    { $match: { parent: null } },
    { $sort: { sortOrder: 1, name: 1 } }
  ]);
};

module.exports = mongoose.model('Category', categorySchema);