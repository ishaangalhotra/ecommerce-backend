// utils/email.js
const nodemailer = require('nodemailer');

// Create basic email functionality
const sendEmail = async (options) => {
  // Basic email implementation
  console.log('Email would be sent:', options);
  return true;
};

module.exports = { sendEmail };
