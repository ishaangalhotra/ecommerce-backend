const mongoose = require('mongoose');
const slugify = require('slugify');

// Image schema with enhanced fields
const ImageSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
    validate: {
      validator: function(url) {
        return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(url);
      },
      message: 'Please provide a valid image URL'
    }
  },
  publicId: {
    type: String,
    required: true
  },
  alt: {
    type: String,
    trim: true,
    default: 'Product image'
  },
  isPrimary: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, { _id: true });

// Variant schema for product variations
const VariantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  values: [{
    value: {
      type: String,
      required: true,
      trim: true
    },
    stock: {
      type: Number,
      required: true,
      min: 0
    },
    priceModifier: {
      type: Number,
      default: 0
    },
    sku: {
      type: String,
      uppercase: true,
      trim: true
    },
    images: [String] // Array of image URLs specific to this variant
  }]
}, { _id: true });

// Review schema for embedded reviews
const ReviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    required: true,
    trim: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    trim: true,
    maxlength: [500, 'Review cannot exceed 500 characters']
  },
  images: [String], // Review images
  isVerified: {
    type: Boolean,
    default: false
  },
  helpfulVotes: {
    type: Number,
    default: 0
  }
}, { 
  timestamps: true,
  _id: true 
});

const ProductSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Please add a product name'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [200, 'Name cannot exceed 200 characters'],
    index: 'text'
  },
  
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true
  },
  
  description: {
    type: String,
    required: [true, 'Please add a description'],
    trim: true,
    minlength: [10, 'Description must be at least 10 characters'],
    maxlength: [2000, 'Description cannot exceed 2000 characters'],
    index: 'text'
  },
  
  shortDescription: {
    type: String,
    trim: true,
    maxlength: [150, 'Short description cannot exceed 150 characters']
  },
  
  // Seller Information
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Product must have a seller'],
    index: true
  },
  
  // Pricing
  pricing: {
    basePrice: {
      type: Number,
      required: [true, 'Please add a base price'],
      min: [0, 'Price cannot be negative']
    },
    salePrice: {
      type: Number,
      min: [0, 'Sale price cannot be negative'],
      validate: {
        validator: function(salePrice) {
          return !salePrice || salePrice <= this.pricing.basePrice;
        },
        message: 'Sale price cannot be higher than base price'
      }
    },
    costPrice: {
      type: Number,
      min: [0, 'Cost price cannot be negative'],
      select: false // Hidden from public queries
    },
    currency: {
      type: String,
      default: 'INR',
      enum: ['INR', 'USD', 'EUR', 'GBP']
    },
    taxRate: {
      type: Number,
      default: 18, // 18% GST for India
      min: 0,
      max: 100
    }
  },
  
  // Inventory Management
  inventory: {
    stock: {
      type: Number,
      required: [true, 'Please add stock quantity'],
      min: [0, 'Stock cannot be negative'],
      index: true
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    barcode: {
      type: String,
      trim: true,
      sparse: true
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
      min: 0
    },
    trackQuantity: {
      type: Boolean,
      default: true
    },
    allowBackorder: {
      type: Boolean,
      default: false
    }
  },
  
  // Category and Classification
  category: {
    main: {
      type: String,
      required: [true, 'Please select a main category'],
      enum: [
        'Electronics',
        'Clothing & Fashion',
        'Home & Garden',
        'Books & Media',
        'Toys & Games',
        'Sports & Outdoors',
        'Health & Beauty',
        'Automotive',
        'Food & Beverages',
        'Other'
      ],
      index: true
    },
    subcategory: {
      type: String,
      trim: true,
      index: true
    },
    tags: [{
      type: String,
      trim: true,
      lowercase: true
    }]
  },
  
  // Product Specifications
  specifications: {
    brand: {
      type: String,
      trim: true,
      index: true
    },
    model: {
      type: String,
      trim: true
    },
    weight: {
      value: Number,
      unit: {
        type: String,
        enum: ['kg', 'g', 'lb', 'oz'],
        default: 'kg'
      }
    },
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
      unit: {
        type: String,
        enum: ['cm', 'inch', 'm'],
        default: 'cm'
      }
    },
    color: {
      type: String,
      trim: true
    },
    material: {
      type: String,
      trim: true
    },
    warranty: {
      duration: Number,
      unit: {
        type: String,
        enum: ['days', 'months', 'years'],
        default: 'months'
      },
      description: String
    }
  },
  
  // Product Variants
  variants: [VariantSchema],
  
  // Media
  images: {
    type: [ImageSchema],
    validate: {
      validator: function(images) {
        return images && images.length > 0;
      },
      message: 'Product must have at least one image'
    }
  },
  
  videos: [{
    url: {
      type: String,
      validate: {
        validator: function(url) {
          return /^https?:\/\/.+\.(mp4|webm|ogg)$/i.test(url) || 
                 /youtube|vimeo/i.test(url);
        },
        message: 'Please provide a valid video URL'
      }
    },
    title: String,
    duration: Number // in seconds
  }],
  
  // SEO and Marketing
  seo: {
    metaTitle: {
      type: String,
      trim: true,
      maxlength: [60, 'Meta title cannot exceed 60 characters']
    },
    metaDescription: {
      type: String,
      trim: true,
      maxlength: [160, 'Meta description cannot exceed 160 characters']
    },
    keywords: [{
      type: String,
      trim: true,
      lowercase: true
    }]
  },
  
  // Shipping Information
  shipping: {
    weight: {
      value: {
        type: Number,
        required: true,
        min: 0
      },
      unit: {
        type: String,
        enum: ['kg', 'g'],
        default: 'kg'
      }
    },
    dimensions: {
      length: {
        type: Number,
        required: true,
        min: 0
      },
      width: {
        type: Number,
        required: true,
        min: 0
      },
      height: {
        type: Number,
        required: true,
        min: 0
      },
      unit: {
        type: String,
        enum: ['cm', 'inch'],
        default: 'cm'
      }
    },
    freeShipping: {
      type: Boolean,
      default: false
    },
    shippingClass: {
      type: String,
      enum: ['standard', 'heavy', 'fragile', 'hazardous'],
      default: 'standard'
    }
  },
  
  // Product Status
  status: {
    type: String,
    enum: ['draft', 'active', 'inactive', 'archived', 'out_of_stock'],
    default: 'draft',
    index: true
  },
  
  // Visibility and Publishing
  isPublished: {
    type: Boolean,
    default: false,
    index: true
  },
  
  publishedAt: Date,
  
  isFeatured: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Reviews and Ratings
  reviews: [ReviewSchema],
  
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      index: true
    },
    count: {
      type: Number,
      default: 0,
      min: 0
    },
    distribution: {
      5: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      1: { type: Number, default: 0 }
    }
  },
  
  // Sales and Analytics
  analytics: {
    views: {
      type: Number,
      default: 0
    },
    totalSold: {
      type: Number,
      default: 0,
      min: 0
    },
    revenue: {
      type: Number,
      default: 0,
      min: 0
    },
    conversionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },
  
  // Related Products
  relatedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  
  // Additional Features
  features: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    value: {
      type: String,
      required: true,
      trim: true
    },
    icon: String // Icon class or URL
  }],
  
  // Compliance and Legal
  compliance: {
    ageRestricted: {
      type: Boolean,
      default: false
    },
    minimumAge: {
      type: Number,
      min: 0,
      max: 100
    },
    certifications: [String],
    countryOfOrigin: {
      type: String,
      trim: true,
      default: 'India'
    }
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      delete ret.pricing.costPrice;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for performance optimization
ProductSchema.index({ name: 'text', description: 'text', 'category.tags': 'text' });
ProductSchema.index({ seller: 1, status: 1 });
ProductSchema.index({ 'category.main': 1, 'category.subcategory': 1 });
ProductSchema.index({ 'pricing.basePrice': 1 });
ProductSchema.index({ 'rating.average': -1 });
ProductSchema.index({ isFeatured: 1, isPublished: 1 });
ProductSchema.index({ 'inventory.stock': 1, status: 1 });
ProductSchema.index({ createdAt: -1 });
ProductSchema.index({ 'analytics.totalSold': -1 });

// Compound indexes for common queries
ProductSchema.index({ 
  isPublished: 1, 
  status: 1, 
  'category.main': 1, 
  'pricing.basePrice': 1 
});

// Pre-save middleware
ProductSchema.pre('save', async function(next) {
  try {
    // Generate slug from name
    if (this.isModified('name') || this.isNew) {
      let baseSlug = slugify(this.name, { 
        lower: true, 
        strict: true,
        remove: /[*+~.()'"!:@]/g
      });
      
      let slug = baseSlug;
      let counter = 1;
      
      // Ensure unique slug
      while (await this.constructor.findOne({ slug, _id: { $ne: this._id } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      
      this.slug = slug;
    }
    
    // Auto-generate SKU if not provided
    if (!this.inventory.sku) {
      const prefix = this.category.main.substring(0, 3).toUpperCase();
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      this.inventory.sku = `${prefix}${timestamp}${random}`;
    }
    
    // Ensure only one primary image
    const primaryImages = this.images.filter(img => img.isPrimary);
    if (primaryImages.length === 0 && this.images.length > 0) {
      this.images[0].isPrimary = true;
    } else if (primaryImages.length > 1) {
      this.images.forEach((img, index) => {
        img.isPrimary = index === 0;
      });
    }
    
    // Set published date
    if (this.isModified('isPublished') && this.isPublished && !this.publishedAt) {
      this.publishedAt = new Date();
    }
    
    // Update status based on stock
    if (this.inventory.trackQuantity && this.inventory.stock === 0) {
      this.status = 'out_of_stock';
    } else if (this.status === 'out_of_stock' && this.inventory.stock > 0) {
      this.status = 'active';
    }
    
    // Calculate current price
    this.currentPrice = this.pricing.salePrice || this.pricing.basePrice;
    
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-find middleware
ProductSchema.pre(/^find/, function(next) {
  // Only return published products for public queries (can be overridden)
  if (!this.getOptions().includeUnpublished) {
    this.find({ isPublished: true, status: { $in: ['active', 'out_of_stock'] } });
  }
  next();
});

// Virtual properties
ProductSchema.virtual('currentPrice').get(function() {
  return this.pricing.salePrice || this.pricing.basePrice;
});

ProductSchema.virtual('discountPercentage').get(function() {
  if (this.pricing.salePrice && this.pricing.salePrice < this.pricing.basePrice) {
    return Math.round(((this.pricing.basePrice - this.pricing.salePrice) / this.pricing.basePrice) * 100);
  }
  return 0;
});

ProductSchema.virtual('isOnSale').get(function() {
  return this.pricing.salePrice && this.pricing.salePrice < this.pricing.basePrice;
});

ProductSchema.virtual('isInStock').get(function() {
  return !this.inventory.trackQuantity || this.inventory.stock > 0;
});

ProductSchema.virtual('isLowStock').get(function() {
  return this.inventory.trackQuantity && 
         this.inventory.stock <= this.inventory.lowStockThreshold &&
         this.inventory.stock > 0;
});

ProductSchema.virtual('primaryImage').get(function() {
  return this.images.find(img => img.isPrimary) || this.images[0];
});

ProductSchema.virtual('url').get(function() {
  return `/products/${this.slug}`;
});

// Instance Methods
ProductSchema.methods = {
  // Add review
  addReview: function(userId, userName, rating, comment, images = []) {
    // Check if user already reviewed
    const existingReview = this.reviews.find(r => r.user.toString() === userId.toString());
    if (existingReview) {
      throw new Error('User has already reviewed this product');
    }
    
    this.reviews.push({
      user: userId,
      userName,
      rating,
      comment,
      images
    });
    
    this.updateRating();
    return this.save();
  },

  // Update rating statistics
  updateRating: function() {
    if (this.reviews.length === 0) {
      this.rating.average = 0;
      this.rating.count = 0;
      return;
    }
    
    // Calculate average rating
    const totalRating = this.reviews.reduce((sum, review) => sum + review.rating, 0);
    this.rating.average = Math.round((totalRating / this.reviews.length) * 10) / 10;
    this.rating.count = this.reviews.length;
    
    // Update distribution
    this.rating.distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    this.reviews.forEach(review => {
      this.rating.distribution[review.rating]++;
    });
  },

  // Update stock
  updateStock: function(quantity, operation = 'set') {
    if (operation === 'increment') {
      this.inventory.stock += quantity;
    } else if (operation === 'decrement') {
      this.inventory.stock = Math.max(0, this.inventory.stock - quantity);
    } else {
      this.inventory.stock = quantity;
    }
    
    // Update analytics
    if (operation === 'decrement') {
      this.analytics.totalSold += quantity;
      this.analytics.revenue += (this.currentPrice * quantity);
    }
    
    return this.save();
  },

  // Increment view count
  incrementViews: function() {
    this.analytics.views++;
    return this.save({ validateBeforeSave: false });
  },

  // Check if purchasable
  isPurchasable: function(quantity = 1) {
    return this.isPublished && 
           this.status === 'active' && 
           (this.isInStock || this.inventory.allowBackorder) &&
           (!this.inventory.trackQuantity || this.inventory.stock >= quantity);
  },

  // Get similar products
  getSimilarProducts: async function(limit = 5) {
    return await this.constructor.find({
      _id: { $ne: this._id },
      'category.main': this.category.main,
      isPublished: true,
      status: 'active'
    })
    .limit(limit)
    .select('name slug pricing images rating')
    .sort({ 'rating.average': -1 });
  }
};

// Static Methods
ProductSchema.statics = {
  // Search products
  searchProducts: function(searchTerm, filters = {}) {
    const query = { $text: { $search: searchTerm } };
    
    if (filters.category) query['category.main'] = filters.category;
    if (filters.brand) query['specifications.brand'] = filters.brand;
    if (filters.minPrice || filters.maxPrice) {
      query['pricing.basePrice'] = {};
      if (filters.minPrice) query['pricing.basePrice'].$gte = filters.minPrice;
      if (filters.maxPrice) query['pricing.basePrice'].$lte = filters.maxPrice;
    }
    
    return this.find(query)
      .sort({ score: { $meta: 'textScore' }, 'rating.average': -1 })
      .limit(filters.limit || 20);
  },

  // Get featured products
  getFeaturedProducts: function(limit = 10) {
    return this.find({ isFeatured: true })
      .sort({ 'rating.average': -1, createdAt: -1 })
      .limit(limit);
  },

  // Get products by category
  getByCategory: function(category, options = {}) {
    const query = { 'category.main': category };
    
    return this.find(query)
      .sort(options.sort || { 'rating.average': -1 })
      .limit(options.limit || 20)
      .skip(options.skip || 0);
  },

  // Get low stock products
  getLowStockProducts: function() {
    return this.find({
      'inventory.trackQuantity': true,
      $expr: { $lte: ['$inventory.stock', '$inventory.lowStockThreshold'] }
    });
  },

  // Get product analytics
  getAnalytics: async function(dateRange = {}) {
    const matchStage = { isPublished: true };
    if (dateRange.start && dateRange.end) {
      matchStage.createdAt = {
        $gte: dateRange.start,
        $lte: dateRange.end
      };
    }
    
    return await this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$category.main',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$analytics.revenue' },
          avgRating: { $avg: '$rating.average' },
          totalViews: { $sum: '$analytics.views' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);
  }
};

module.exports = mongoose.model('Product', ProductSchema);
