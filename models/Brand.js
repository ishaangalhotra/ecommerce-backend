// models/Brand.js - Brand Management System

const mongoose = require('mongoose');
const slugify = require('slugify');

const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Brand name is required'],
    trim: true,
    maxlength: [100, 'Brand name cannot exceed 100 characters'],
    index: true
  },
  
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    index: true
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  
  logo: {
    url: String,
    alt: String,
    publicId: String
  },
  
  banner: {
    url: String,
    alt: String,
    publicId: String
  },
  
  // Brand Information
  info: {
    foundedYear: Number,
    headquarters: String,
    website: String,
    email: String,
    phone: String,
    parentCompany: String,
    countryOfOrigin: String,
    certifications: [String]
  },
  
  // Social Media
  socialMedia: {
    facebook: String,
    instagram: String,
    twitter: String,
    youtube: String,
    linkedin: String
  },
  
  // SEO
  seo: {
    metaTitle: { type: String, maxlength: 60 },
    metaDescription: { type: String, maxlength: 160 },
    keywords: [String],
    canonicalUrl: String
  },
  
  // Statistics
  stats: {
    totalProducts: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 }
  },
  
  // Categories this brand operates in
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  
  // Brand Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending', 'suspended'],
    default: 'pending',
    index: true
  },
  
  // Featured Brand
  isFeatured: { type: Boolean, default: false, index: true },
  
  // Verification
  isVerified: { type: Boolean, default: false },
  verifiedAt: Date,
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Audit
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
brandSchema.index({ name: 'text', description: 'text' });
brandSchema.index({ 'stats.totalProducts': -1 });
brandSchema.index({ 'stats.averageRating': -1 });

// Middleware
brandSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  
  if (!this.seo.metaTitle) {
    this.seo.metaTitle = this.name;
  }
  
  if (!this.seo.metaDescription && this.description) {
    this.seo.metaDescription = this.description.substring(0, 160);
  }
  
  next();
});

module.exports = mongoose.models.Brand || mongoose.model('Brand', brandSchema);
