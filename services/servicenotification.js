// services/notificationService.js
const sendNotification = async (userId, message) => {
  // Basic notification implementation
  console.log(`Notification for user ${userId}: ${message}`);
  return true;
};

module.exports = {
  sendNotification
};
