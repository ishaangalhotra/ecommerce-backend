// userController.js
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/asyncHandlerHandler');
const { sendTokenResponse } = require('../utils/auth'); // Import shared token sending utility
const config = require('../config/config'); // Import config

// @desc    Register user (Note: This might be redundant if authController.js handles all registration)
// @route   POST /api/v1/users/register
// @access  Public
exports.registerUser = asyncHandler(async (req, res, next) => {
  const { username, email, password } = req.body;

  const userExists = await User.findOne({ email });
  if (userExists) {
    return next(new ErrorResponse('User already exists', 400));
  }

  const user = await User.create({ username, email, password });

  sendTokenResponse(user, 201, res); // Use the shared utility
});

// @desc    Login user (Note: This might be redundant if authController.js handles all login)
// @route   POST /api/v1/users/login
// @access  Public
exports.loginUser = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.matchPassword(password))) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  sendTokenResponse(user, 200, res); // Use the shared utility
});

// @desc    Get user profile
// @route   GET /api/v1/users/profile
// @access  Private
exports.getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  // Ensure sensitive data like password hash is not returned
  res.status(200).json({ success: true, user: user.getPublicProfile() }); // Assuming a method to get public profile
});

// @desc    Update user profile
// @route   PUT /api/v1/users/profile
// @access  Private
exports.updateUserProfile = asyncHandler(async (req, res, next) => {
  const { username, email, password } = req.body;

  const user = await User.findById(req.user.id);

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  user.username = username || user.username;
  user.email = email || user.email;

  if (password) {
    user.password = password; // Hashing will occur in pre-save hook in User model
  }

  await user.save();

  res.status(200).json({ success: true, user: user.getPublicProfile() });
});

// @desc    Delete user account
// @route   DELETE /api/v1/users/:id
// @access  Private/Admin
exports.deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id ${req.params.id}`, 404));
  }

  await user.remove(); // This uses pre-remove hooks if defined in model

  res.status(200).json({ success: true, data: {} });
});