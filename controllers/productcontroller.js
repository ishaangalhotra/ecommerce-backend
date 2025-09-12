const Product = require('../models/Product');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/asyncHandlerHandler');

// Helper for pagination, filtering, sorting
const advancedResults = (model, populate) => asyncHandler(async (req, res, next) => {
  let query;

  // Copy req.query
  const reqQuery = { ...req.query };

  // Fields to exclude
  const removeFields = ['select', 'sort', 'page', 'limit'];
  removeFields.forEach(param => delete reqQuery[param]);

  // Create query string
  let queryStr = JSON.stringify(reqQuery);
  queryStr = queryStr.replace(/\b(gt|gte|lt|lte|in)\b/g, match => `$${match}`);

  // MEMORY OPTIMIZATION: Finding resource with lean() and limited fields
  query = model.find(JSON.parse(queryStr));

  // Select fields - DEFAULT to essential fields only to reduce memory
  if (req.query.select) {
    const fields = req.query.select.split(',').join(' ');
    query = query.select(fields);
  } else {
    // DEFAULT: Only return essential fields to reduce memory usage
    query = query.select('name price images description sellerId stock isPublished createdAt category');
  }
  
  // MEMORY EFFICIENCY: Use lean() for faster, plain object queries (less memory)
  query = query.lean();

  // Sort
  if (req.query.sort) {
    const sortBy = req.query.sort.split(',').join(' ');
    query = query.sort(sortBy);
  } else {
    query = query.sort('-createdAt');
  }

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  // MEMORY OPTIMIZATION: Use the same filter for count to ensure consistency
  const total = await model.countDocuments(JSON.parse(queryStr)).lean();

  query = query.skip(startIndex).limit(limit);

  if (populate) {
    query = query.populate(populate);
  }

  // Executing query
  const results = await query;

  // Pagination result
  const pagination = {};
  if (endIndex < total) {
    pagination.next = {
      page: page + 1,
      limit
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: page - 1,
      limit
    };
  }

  // ** THE FIX IS HERE **
  // Send the response instead of calling next()
  res.status(200).json({
    success: true,
    count: results.length,
    pagination,
    data: results
  });
});

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = advancedResults(Product, {
  path: 'seller',
  select: 'name email'
});

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProduct = asyncHandler(async (req, res, next) => {
  // MEMORY OPTIMIZATION: Use lean() and limit populated fields
  const product = await Product.findById(req.params.id)
    .select('-__v') // Exclude version field
    .populate('seller', 'name email -_id') // Limit seller fields
    .populate('reviews.user', 'name -_id') // Limit review user fields
    .lean(); // Convert to plain object for less memory usage

  if (!product) {
    return next(new ErrorResponse(`Product not found with ID ${req.params.id}`, 404));
  }

  res.status(200).json({
    success: true,
    data: product
  });
});

// [Other product methods remain the same as your existing file]