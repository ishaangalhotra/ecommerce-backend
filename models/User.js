// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // For password hashing

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true, // Ensures no two users have the same username
    trim: true // Removes whitespace from both ends of a string
  },
  email: {
    type: String,
    required: true,
    unique: true, // Ensures no two users have the same email
    match: [/.+@.+\..+/, 'Please use a valid email address'], // Basic email regex validation
    lowercase: true // Stores emails in lowercase
  },
  password: {
    type: String,
    required: true,
    minlength: [6, 'Password must be at least 6 characters long'] // Minimum password length
  },
  role: {
    type: String,
    enum: ['user', 'admin'], // Users can be 'user' or 'admin'
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook to hash password before saving to database
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) { // Only hash if the password has been modified (or is new)
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare entered password with hashed password in DB
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);