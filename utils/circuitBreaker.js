// utils/circuitBreaker.js

module.exports = {
  run: async (operation) => {
    try {
      return await operation();
    } catch (err) {
      console.error("⚠️ Circuit breaker caught an error:", err);
      throw err;
    }
  }
};
