// utils/circuitBreaker.js

class CircuitBreaker {
  constructor(options = {}) {
    this.options = options;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.timeout = options.timeout || 60000; // 1 minute
    this.threshold = options.threshold || 5;
  }

  async run(operation) {
    try {
      return await operation();
    } catch (err) {
      console.error("⚠️ Circuit breaker caught an error:", err);
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.threshold) {
        this.state = 'OPEN';
        console.warn(`🔴 Circuit breaker opened after ${this.failureCount} failures`);
      }
      
      throw err;
    }
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}

module.exports = CircuitBreaker;