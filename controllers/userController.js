const User = require('../models/User');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler'); // For handling async errors

// Helper function to generate JWT token
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: '1h', // Token expires in 1 hour
  });
};

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
exports.registerUser = asyncHandler(async (req, res) => {
  const { username, email, password, role } = req.body; // Added role to destructuring

  // Basic validation
  if (!username || !email || !password) {
    res.status(400);
    throw new Error('Please enter all fields');
  }

  try {
    let user = await User.findOne({ email });
    if (user) {
      res.status(400);
      throw new Error('User already exists');
    }

    // Create new user (password hashing handled by pre-save hook in User model)
    user = new User({
      username,
      email,
      password,
      role: role || 'user' // Default role to 'user' if not provided
    });

    await user.save();

    // Generate JWT token (optional, but common for registration)
    const payload = {
      user: {
        id: user.id,
        role: user.role // Include role in token
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
      (err, token) => {
        if (err) {
          console.error('JWT sign error:', err);
          res.status(500);
          throw new Error('Token generation failed');
        }
        res.status(201).json({
          message: 'User registered successfully',
          token,
          user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
      }
    );

  } catch (err) {
    // If error is already set by a previous throw, use that status, else 500
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode).json({ message: err.message || 'Server error during registration' });
  }
});

// @desc    Authenticate user & get token
// @route   POST /api/users/login
// @access  Public
exports.loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Basic validation
  if (!email || !password) {
    res.status(400);
    throw new Error('Please enter all fields');
  }

  try {
    let user = await User.findOne({ email });
    if (!user) {
      res.status(400);
      throw new Error('Invalid Credentials');
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      res.status(400);
      throw new Error('Invalid Credentials');
    }

    // Generate JWT token
    const payload = {
      user: {
        id: user.id,
        role: user.role
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
      (err, token) => {
        if (err) {
          console.error('JWT sign error:', err);
          res.status(500);
          throw new Error('Token generation failed');
        }
        res.json({
          message: 'Logged in successfully',
          token,
          user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
      }
    );

  } catch (err) {
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode).json({ message: err.message || 'Server error during login' });
  }
});