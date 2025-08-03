class MetricsCollector {
  static record(...args) {
    console.log('📊 [metrics] Skipped:', ...args);
  }
  
  static increment(metricName, labels = {}) {
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_MODE === 'true') {
      console.log(`📊 [metrics] ${metricName} incremented`, labels);
    }
  }
  
  static decrement(metricName, labels = {}) {
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_MODE === 'true') {
      console.log(`📊 [metrics] ${metricName} decremented`, labels);
    }
  }
  
  static gauge(metricName, value, labels = {}) {
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_MODE === 'true') {
      console.log(`📊 [metrics] ${metricName} = ${value}`, labels);
    }
  }
  
  static histogram(metricName, value, labels = {}) {
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_MODE === 'true') {
      console.log(`📊 [metrics] ${metricName} histogram: ${value}`, labels);
    }
  }
  
  static summary(metricName, value, labels = {}) {
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_MODE === 'true') {
      console.log(`📊 [metrics] ${metricName} summary: ${value}`, labels);
    }
  }
}

// Export both the class and individual methods for backward compatibility
module.exports = MetricsCollector;

// Also export the old record method for backward compatibility
module.exports.record = (...args) => {
  console.log('📊 [metrics] Skipped:', ...args);
};