const User = require('../models/User');
const bcrypt = require('bcryptjs'); // Used by User model's pre-save hook
const jwt = require('jsonwebtoken');

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
exports.registerUser = async (req, res) => {
  const { username, email, password } = req.body; // Expecting 'username', not 'name'

  // Basic validation
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Password hashing is handled by the pre-save hook in User model
    user = new User({
      username,
      email,
      password: password // The model's pre-save hook will hash this
    });

    await user.save();

    // Generate JWT token (optional, but common for registration)
    const payload = {
      user: {
        id: user.id,
        role: user.role // Include role in token if you have it in model
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET, // Make sure JWT_SECRET is set in your .env or Render
      { expiresIn: '1h' }, // Token expires in 1 hour
      (err, token) => {
        if (err) {
          console.error('JWT sign error:', err);
          throw err;
        }
        res.status(201).json({
          message: 'User registered successfully',
          token,
          user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
      }
    );

  } catch (err) {
    console.error('Caught error in registerUser:', err.message);
    console.error(err.stack); // Print full stack trace for debugging
    res.status(500).json({ message: 'Server error during registration' });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/users/login
// @access  Public
exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  // Basic validation
  if (!email || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }

  try {
    // Check if user exists
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Compare password
    const isMatch = await user.matchPassword(password); // Using method from User model
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid Credentials' });
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
        if (err) throw err;
        res.json({
          message: 'Logged in successfully',
          token,
          user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
      }
    );

  } catch (err) {
    console.error('Error during user login:', err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
};