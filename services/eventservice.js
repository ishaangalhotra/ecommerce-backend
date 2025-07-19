const redis = require('../config/redis');
const logger = require('./logger');

class EventService {
  static async publishDeliveryEvent(event) {
    try {
      await redis.publish(
        'delivery-events', 
        JSON.stringify({
          ...event,
          timestamp: new Date().toISOString()
        })
      );
      logger.info(`Published delivery event: ${event.type}`);
    } catch (err) {
      logger.error('Failed to publish delivery event', err);
    }
  }
}

module.exports = EventService;