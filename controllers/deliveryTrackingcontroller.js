const Order = require('../models/Order');
const { publishDeliveryEvent } = require('../services/eventService');
const { body, validationResult } = require('express-validator');

// Constants for better maintainability
const DELIVERY_STATUS = {
    ASSIGNED: 'assigned',
    LOCATION_UPDATE: 'location_update',
    PICKED_UP: 'picked_up',
    IN_TRANSIT: 'in_transit',
    DELIVERED: 'delivered'
};

const HTTP_STATUS = {
    OK: 200,
    BAD_REQUEST: 400,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500
};

class DeliveryController {
    /**
     * Assigns a delivery agent to an order
     */
    static async assignAgent(req, res) {
        try {
            // Input validation
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { orderId, agentId } = req.body;

            // Check if order exists first
            const existingOrder = await Order.findById(orderId);
            if (!existingOrder) {
                return res.status(HTTP_STATUS.NOT_FOUND).json({
                    success: false,
                    error: 'Order not found'
                });
            }

            // Check if agent is already assigned
            if (existingOrder.delivery?.agent) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Agent already assigned to this order'
                });
            }

            // Update order with proper MongoDB syntax
            const updateQuery = {
                $set: {
                    'delivery.agent': agentId,
                    'delivery.status': DELIVERY_STATUS.ASSIGNED,
                    'delivery.assignedAt': new Date()
                },
                $push: {
                    'delivery.history': {
                        status: DELIVERY_STATUS.ASSIGNED,
                        notes: `Assigned to agent ${agentId}`,
                        timestamp: new Date()
                    }
                }
            };

            const order = await Order.findByIdAndUpdate(
                orderId,
                updateQuery,
                { new: true, runValidators: true }
            ).populate('delivery.agent', 'name phone avatar email');

            // Publish event for other services
            await publishDeliveryEvent({
                type: 'agent-assigned',
                orderId,
                agent: order.delivery.agent,
                expectedDelivery: order.delivery.expectedDelivery,
                timestamp: new Date()
            });

            // Emit real-time notification
            if (req.io) {
                req.io.to(`order-${orderId}`).emit('agent-assigned', {
                    agent: order.delivery.agent,
                    timestamp: new Date()
                });
            }

            res.status(HTTP_STATUS.OK).json({
                success: true,
                message: 'Agent assigned successfully',
                order: {
                    id: order._id,
                    delivery: order.delivery
                }
            });

        } catch (err) {
            console.error('Error assigning agent:', err);
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: 'Failed to assign agent',
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
    }

    /**
     * Updates delivery location in real-time
     */
    static async updateLocation(req, res) {
        try {
            // Input validation
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { orderId, lat, lng, address } = req.body;

            // Validate coordinates
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Invalid coordinates provided'
                });
            }

            // Check if order exists and has assigned agent
            const existingOrder = await Order.findById(orderId);
            if (!existingOrder) {
                return res.status(HTTP_STATUS.NOT_FOUND).json({
                    success: false,
                    error: 'Order not found'
                });
            }

            if (!existingOrder.delivery?.agent) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'No agent assigned to this order'
                });
            }

            const locationUpdate = {
                $set: {
                    'delivery.currentLocation': {
                        type: 'Point',
                        coordinates: [lng, lat],
                        address: address || '',
                        updatedAt: new Date()
                    }
                },
                $push: {
                    'delivery.history': {
                        status: DELIVERY_STATUS.LOCATION_UPDATE,
                        location: {
                            type: 'Point',
                            coordinates: [lng, lat],
                            address: address || ''
                        },
                        timestamp: new Date()
                    }
                }
            };

            const order = await Order.findByIdAndUpdate(
                orderId,
                locationUpdate,
                { new: true, runValidators: true }
            );

            // Emit real-time location update
            if (req.io) {
                req.io.to(`order-${orderId}`).emit('location-updated', {
                    coordinates: [lng, lat],
                    address: address || '',
                    timestamp: new Date(),
                    orderId
                });
            }

            // Publish location event
            await publishDeliveryEvent({
                type: 'location-updated',
                orderId,
                location: { lat, lng, address },
                timestamp: new Date()
            });

            res.status(HTTP_STATUS.OK).json({
                success: true,
                message: 'Location updated successfully',
                location: {
                    coordinates: [lng, lat],
                    address: address || '',
                    timestamp: new Date()
                }
            });

        } catch (err) {
            console.error('Error updating location:', err);
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: 'Location update failed',
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
    }

    /**
     * Get delivery status and history
     */
    static async getDeliveryStatus(req, res) {
        try {
            const { orderId } = req.params;

            if (!orderId) {
                return res.status(HTTP_STATUS.BAD_REQUEST).json({
                    success: false,
                    error: 'Order ID is required'
                });
            }

            const order = await Order.findById(orderId)
                .populate('delivery.agent', 'name phone avatar')
                .select('delivery');

            if (!order) {
                return res.status(HTTP_STATUS.NOT_FOUND).json({
                    success: false,
                    error: 'Order not found'
                });
            }

            res.status(HTTP_STATUS.OK).json({
                success: true,
                delivery: order.delivery
            });

        } catch (err) {
            console.error('Error fetching delivery status:', err);
            res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
                success: false,
                error: 'Failed to fetch delivery status'
            });
        }
    }
}

// Validation middleware
const assignAgentValidation = [
    body('orderId').notEmpty().isMongoId().withMessage('Valid Order ID is required'),
    body('agentId').notEmpty().isMongoId().withMessage('Valid Agent ID is required')
];

const updateLocationValidation = [
    body('orderId').notEmpty().isMongoId().withMessage('Valid Order ID is required'),
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    body('address').optional().isString().trim()
];

module.exports = {
    DeliveryController,
    assignAgentValidation,
    updateLocationValidation
};
