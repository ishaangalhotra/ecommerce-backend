const sendNotification = async (userId, message, type = 'info') => {
  console.log(`Notification for user ${userId} [${type}]: ${message}`);
  return true;
};

const sendBulkNotification = async (userIds, message) => {
  console.log(`Bulk notification to ${userIds.length} users: ${message}`);
  return true;
};

module.exports = { sendNotification, sendBulkNotification };
