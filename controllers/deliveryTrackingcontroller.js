const Order = require('../models/Order');
const { publishDeliveryEvent } = require('../services/eventService');

class DeliveryController {
  static async assignAgent(req, res) {
    try {
      const { orderId, agentId } = req.body;
      
      const order = await Order.findByIdAndUpdate(
        orderId,
        {
          'delivery.agent': agentId,
          'delivery.status': 'assigned',
          $push: {
            'delivery.history': {
              status: 'assigned',
              notes: `Assigned to agent ${agentId}`
            }
          }
        },
        { new: true }
      ).populate('delivery.agent', 'name phone avatar');

      await publishDeliveryEvent({
        type: 'agent-assigned',
        orderId,
        agent: order.delivery.agent,
        expectedDelivery: order.delivery.expectedDelivery
      });

      res.json({ success: true, order });
    } catch (err) {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to assign agent',
        details: err.message 
      });
    }
  }

  static async updateLocation(req, res) {
    try {
      const { orderId, lat, lng, address } = req.body;
      
      const update = {
        $push: {
          'delivery.history': {
            status: 'location_update',
            location: {
              type: 'Point',
              coordinates: [lng, lat],
              address
            }
          }
        }
      };

      const order = await Order.findByIdAndUpdate(orderId, update, { new: true });

      req.io.to(`order-${orderId}`).emit('location-updated', {
        coordinates: [lng, lat],
        address,
        timestamp: new Date()
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ 
        success: false, 
        error: 'Location update failed' 
      });
    }
  }
}

module.exports = DeliveryController;