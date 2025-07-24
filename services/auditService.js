const logActivity = async (userId, action, details) => {
  console.log(`Audit: User ${userId} performed ${action}`, details);
  return true;
};

const getAuditLogs = async (filters) => {
  return [];
};

module.exports = { logActivity, getAuditLogs };
