// Email Notification System for QuickLocal Quick Commerce
// Order confirmations, shipping updates, and promotional emails

// ==================== EMAIL TEMPLATES ====================

// 1. Order Confirmation Email Template
const orderConfirmationTemplate = (order, customer) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Order Confirmation - QuickLocal</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #007bff; color: white; padding: 20px; text-align: center; }
        .content { background: white; padding: 30px; border: 1px solid #ddd; }
        .order-info { background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .items-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .items-table th, .items-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        .total-row { font-weight: bold; background: #f8f9fa; }
        .button { display: inline-block; background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Order Confirmed! 🎉</h1>
            <p>Thank you for your order, ${customer.name}!</p>
        </div>
        
        <div class="content">
            <div class="order-info">
                <h2>Order Details</h2>
                <p><strong>Order ID:</strong> ${order.orderNumber || order._id}</p>
                <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString('en-IN', {
                    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })}</p>
                <p><strong>Estimated Delivery:</strong> ${order.estimatedDelivery ? 
                    new Date(order.estimatedDelivery).toLocaleDateString('en-IN', {
                        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    }) : '30-45 minutes'}</p>
            </div>

            <h3>Items Ordered</h3>
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Quantity</th>
                        <th>Price</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${order.items.map(item => `
                        <tr>
                            <td>${item.product.name}</td>
                            <td>${item.quantity}</td>
                            <td>₹${item.price}</td>
                            <td>₹${item.quantity * item.price}</td>
                        </tr>
                    `).join('')}
                    <tr class="total-row">
                        <td colspan="3">Total Amount</td>
                        <td>₹${order.totalAmount}</td>
                    </tr>
                </tbody>
            </table>

            <div class="order-info">
                <h3>Delivery Address</h3>
                <p>${order.deliveryAddress.street}<br>
                   ${order.deliveryAddress.city}, ${order.deliveryAddress.state} ${order.deliveryAddress.postalCode}<br>
                   ${order.deliveryAddress.phone}</p>
            </div>

            <a href="https://quicklocal.shop/track-order?orderId=${order._id}" class="button">Track Your Order</a>
            
            <p>We'll notify you as soon as your order is out for delivery!</p>
        </div>
        
        <div class="footer">
            <p>Need help? Contact us at <a href="mailto:support@quicklocal.shop">support@quicklocal.shop</a></p>
            <p>QuickLocal - Fresh groceries delivered in 30 minutes</p>
        </div>
    </div>
</body>
</html>
`;

// 2. Order Status Update Email Template
const orderStatusTemplate = (order, customer, status) => {
    const statusMessages = {
        confirmed: { title: 'Order Confirmed', message: 'Your order has been confirmed and is being prepared', emoji: '✅' },
        preparing: { title: 'Preparing Your Order', message: 'We are getting your items ready for delivery', emoji: '👨‍🍳' },
        dispatched: { title: 'Order Dispatched', message: 'Your order is on its way to you!', emoji: '🚀' },
        outForDelivery: { title: 'Out for Delivery', message: 'Your delivery partner is nearby', emoji: '🏍️' },
        delivered: { title: 'Order Delivered', message: 'Your order has been delivered successfully', emoji: '📦' }
    };
    
    const statusInfo = statusMessages[status] || { title: 'Order Update', message: 'Your order status has been updated', emoji: '📋' };
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>${statusInfo.title} - QuickLocal</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #28a745; color: white; padding: 20px; text-align: center; }
            .content { background: white; padding: 30px; border: 1px solid #ddd; }
            .status-box { background: #e8f5e8; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center; }
            .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${statusInfo.emoji} ${statusInfo.title}</h1>
                <p>Order #${order.orderNumber || order._id}</p>
            </div>
            
            <div class="content">
                <div class="status-box">
                    <h2>${statusInfo.message}</h2>
                    <p>Status updated: ${new Date().toLocaleString('en-IN')}</p>
                </div>

                ${status === 'dispatched' && order.deliveryPartner ? `
                    <h3>Delivery Partner</h3>
                    <p><strong>Name:</strong> ${order.deliveryPartner.name}</p>
                    <p><strong>Phone:</strong> ${order.deliveryPartner.phone}</p>
                    ${order.deliveryPartner.vehicle ? `<p><strong>Vehicle:</strong> ${order.deliveryPartner.vehicle}</p>` : ''}
                ` : ''}

                <a href="https://quicklocal.shop/track-order?orderId=${order._id}" class="button">Track Your Order</a>
            </div>
            
            <div class="footer">
                <p>QuickLocal - Fresh groceries delivered in 30 minutes</p>
            </div>
        </div>
    </body>
    </html>
    `;
};

// 3. Cart Abandonment Email Template
const cartAbandonmentTemplate = (customer, cartItems) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Complete Your Order - QuickLocal</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f39c12; color: white; padding: 20px; text-align: center; }
        .content { background: white; padding: 30px; border: 1px solid #ddd; }
        .cart-items { background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .button { display: inline-block; background: #e74c3c; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛒 Don't Miss Out!</h1>
            <p>Hi ${customer.name}, you have items waiting in your cart</p>
        </div>
        
        <div class="content">
            <h2>Complete your order now and get fresh groceries delivered!</h2>
            
            <div class="cart-items">
                <h3>Items in your cart:</h3>
                ${cartItems.map(item => `
                    <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
                        <span>${item.product.name} (x${item.quantity})</span>
                        <span>₹${item.price * item.quantity}</span>
                    </div>
                `).join('')}
                <div style="display: flex; justify-content: space-between; padding: 15px 0; font-weight: bold; font-size: 18px;">
                    <span>Total</span>
                    <span>₹${cartItems.reduce((total, item) => total + (item.price * item.quantity), 0)}</span>
                </div>
            </div>

            <p><strong>🚀 Special Offer:</strong> Complete your order within the next 2 hours and get <strong>FREE DELIVERY!</strong></p>
            
            <a href="https://quicklocal.shop/cart" class="button">Complete Your Order</a>
            
            <p style="text-align: center; margin-top: 30px;">
                <small>This offer expires in 24 hours. Fresh groceries delivered in just 30 minutes!</small>
            </p>
        </div>
        
        <div class="footer">
            <p>QuickLocal - Fresh groceries delivered in 30 minutes</p>
            <p><a href="#">Unsubscribe</a> from these emails</p>
        </div>
    </div>
</body>
</html>
`;

// ==================== EMAIL SERVICE ====================

// Email service implementation
class EmailNotificationService {
    constructor() {
        this.nodemailer = require('nodemailer');
        this.transporter = this.createTransporter();
    }

    createTransporter() {
        return this.nodemailer.createTransporter({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USERNAME,
                pass: process.env.SMTP_PASSWORD
            }
        });
    }

    async sendOrderConfirmation(order, customer) {
        try {
            const mailOptions = {
                from: `"QuickLocal" <${process.env.EMAIL_FROM}>`,
                to: customer.email,
                subject: `Order Confirmed - #${order.orderNumber || order._id}`,
                html: orderConfirmationTemplate(order, customer)
            };

            const result = await this.transporter.sendMail(mailOptions);
            console.log('Order confirmation email sent:', result.messageId);
            
            return { success: true, messageId: result.messageId };
        } catch (error) {
            console.error('Order confirmation email error:', error);
            return { success: false, error: error.message };
        }
    }

    async sendStatusUpdate(order, customer, status) {
        try {
            const statusTitles = {
                confirmed: 'Order Confirmed',
                preparing: 'Order Being Prepared',
                dispatched: 'Order Dispatched',
                outForDelivery: 'Out for Delivery',
                delivered: 'Order Delivered'
            };

            const mailOptions = {
                from: `"QuickLocal" <${process.env.EMAIL_FROM}>`,
                to: customer.email,
                subject: `${statusTitles[status]} - #${order.orderNumber || order._id}`,
                html: orderStatusTemplate(order, customer, status)
            };

            const result = await this.transporter.sendMail(mailOptions);
            console.log('Status update email sent:', result.messageId);
            
            return { success: true, messageId: result.messageId };
        } catch (error) {
            console.error('Status update email error:', error);
            return { success: false, error: error.message };
        }
    }

    async sendCartAbandonment(customer, cartItems) {
        try {
            const mailOptions = {
                from: `"QuickLocal" <${process.env.EMAIL_FROM}>`,
                to: customer.email,
                subject: '🛒 Complete Your Order - FREE Delivery Available!',
                html: cartAbandonmentTemplate(customer, cartItems)
            };

            const result = await this.transporter.sendMail(mailOptions);
            console.log('Cart abandonment email sent:', result.messageId);
            
            return { success: true, messageId: result.messageId };
        } catch (error) {
            console.error('Cart abandonment email error:', error);
            return { success: false, error: error.message };
        }
    }

    async sendWelcomeEmail(customer) {
        try {
            const mailOptions = {
                from: `"QuickLocal" <${process.env.EMAIL_FROM}>`,
                to: customer.email,
                subject: '🎉 Welcome to QuickLocal!',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: #28a745; color: white; padding: 30px; text-align: center;">
                            <h1>Welcome to QuickLocal! 🎉</h1>
                            <p>Hi ${customer.name}, we're excited to deliver fresh groceries to you!</p>
                        </div>
                        <div style="padding: 30px; background: white; border: 1px solid #ddd;">
                            <h2>🚀 Get Started</h2>
                            <p>Your account is ready! Here's what you can do:</p>
                            <ul>
                                <li>✅ Browse thousands of fresh products</li>
                                <li>🚀 Get delivery in just 30 minutes</li>
                                <li>💰 Save with special offers and deals</li>
                                <li>📱 Track your orders in real-time</li>
                            </ul>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="https://quicklocal.shop/products" style="background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Start Shopping</a>
                            </div>
                            <p><strong>Special Welcome Offer:</strong> Use code <strong>WELCOME10</strong> for 10% off your first order!</p>
                        </div>
                        <div style="text-align: center; margin-top: 30px; color: #666; font-size: 14px;">
                            <p>QuickLocal - Fresh groceries delivered in 30 minutes</p>
                        </div>
                    </div>
                `
            };

            const result = await this.transporter.sendMail(mailOptions);
            console.log('Welcome email sent:', result.messageId);
            
            return { success: true, messageId: result.messageId };
        } catch (error) {
            console.error('Welcome email error:', error);
            return { success: false, error: error.message };
        }
    }
}

// ==================== BACKEND INTEGRATION ====================

// Add these to your controllers and middleware

/*
// In your authController.js - after user registration
const emailService = new EmailNotificationService();

// Send welcome email after registration
router.post('/register', async (req, res) => {
    // ... existing registration logic ...
    
    if (user) {
        // Send welcome email
        await emailService.sendWelcomeEmail(user);
        
        res.json({
            success: true,
            message: 'Registration successful',
            user
        });
    }
});

// In your orderController.js - after order creation
router.post('/create', async (req, res) => {
    // ... existing order creation logic ...
    
    if (order) {
        // Send order confirmation email
        await emailService.sendOrderConfirmation(order, req.user);
        
        res.json({
            success: true,
            message: 'Order created successfully',
            order
        });
    }
});

// In your orderController.js - when status updates
router.put('/:orderId/status', async (req, res) => {
    // ... existing status update logic ...
    
    if (order) {
        const customer = await User.findById(order.customer);
        
        // Send status update email
        await emailService.sendStatusUpdate(order, customer, status);
        
        res.json({
            success: true,
            message: 'Order status updated',
            order
        });
    }
});

// Cart abandonment job (run with cron job)
const checkAbandonedCarts = async () => {
    try {
        const cutoffTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
        
        const abandonedCarts = await Cart.find({
            updatedAt: { $lt: cutoffTime },
            items: { $exists: true, $ne: [] },
            emailSent: { $ne: true }
        })
        .populate('userId', 'name email')
        .populate('items.product', 'name price images');

        for (const cart of abandonedCarts) {
            if (cart.userId && cart.userId.email) {
                await emailService.sendCartAbandonment(cart.userId, cart.items);
                
                // Mark as email sent
                cart.emailSent = true;
                await cart.save();
            }
        }
        
        console.log(`Processed ${abandonedCarts.length} abandoned carts`);
    } catch (error) {
        console.error('Abandoned cart email error:', error);
    }
};

// Set up cron job for cart abandonment
const cron = require('node-cron');

// Run every hour
cron.schedule('0 * * * *', () => {
    console.log('Running abandoned cart check...');
    checkAbandonedCarts();
});
*/

// ==================== ENVIRONMENT VARIABLES ====================
/*
Add to your .env file:

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
EMAIL_FROM=noreply@quicklocal.shop
EMAIL_FROM_NAME=QuickLocal

# Make sure to use App Password for Gmail, not regular password
# Enable 2-factor authentication and generate app password:
# https://myaccount.google.com/apppasswords
*/

module.exports = {
    EmailNotificationService,
    orderConfirmationTemplate,
    orderStatusTemplate,
    cartAbandonmentTemplate
};
