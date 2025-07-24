const sendSMS = async (phoneNumber, message) => {
  console.log(`SMS to ${phoneNumber}: ${message}`);
  return { success: true, messageId: 'mock-id' };
};

module.exports = { sendSMS };
