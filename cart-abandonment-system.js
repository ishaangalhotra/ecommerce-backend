const mongoose = require('mongoose');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

// Cart Abandonment Schema
const cartAbandonmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cartId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cart',
    required: true
  },
  email: {
    type: String,
    required: true
  },
  cartItems: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    productName: String,
    productImage: String,
    price: Number,
    quantity: Number
  }],
  cartValue: {
    type: Number,
    required: true
  },
  abandonedAt: {
    type: Date,
    default: Date.now
  },
  emailsSent: [{
    type: {
      type: String,
      enum: ['first_reminder', 'second_reminder', 'final_reminder', 'incentive'],
      required: true
    },
    sentAt: {
      type: Date,
      default: Date.now
    },
    opened: {
      type: Boolean,
      default: false
    },
    clicked: {
      type: Boolean,
      default: false
    }
  }],
  recovered: {
    type: Boolean,
    default: false
  },
  recoveredAt: {
    type: Date
  },
  incentiveOffered: {
    type: String,
    enum: ['discount_10', 'discount_15', 'free_shipping', 'none'],
    default: 'none'
  },
  status: {
    type: String,
    enum: ['abandoned', 'reminded', 'recovered', 'expired'],
    default: 'abandoned'
  }
}, {
  timestamps: true
});

cartAbandonmentSchema.index({ userId: 1, abandonedAt: -1 });
cartAbandonmentSchema.index({ status: 1, abandonedAt: -1 });

const CartAbandonment = mongoose.model('CartAbandonment', cartAbandonmentSchema);

// Email Configuration
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

// Email Templates
const emailTemplates = {
  first_reminder: {
    subject: "You left something in your cart! 🛒",
    html: (data) => `
      <!DOCTYPE html>
      <html>
      <head>
          <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
              .content { padding: 30px; }
              .product-item { display: flex; align-items: center; gap: 15px; padding: 15px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 15px; }
              .product-image { width: 80px; height: 80px; object-fit: cover; border-radius: 5px; }
              .product-details { flex: 1; }
              .product-name { font-weight: 600; margin-bottom: 5px; }
              .product-price { color: #007bff; font-weight: 700; font-size: 18px; }
              .cta-button { background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; margin: 20px 0; }
              .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #666; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>🛒 Don't forget your items!</h1>
                  <p>Your cart is waiting for you</p>
              </div>
              <div class="content">
                  <p>Hi there!</p>
                  <p>You left some great items in your cart. Don't let them slip away!</p>
                  
                  <div class="cart-items">
                      ${data.cartItems.map(item => `
                          <div class="product-item">
                              ${item.productImage ? `<img src="${item.productImage}" alt="${item.productName}" class="product-image">` : '<div class="product-image" style="background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:12px;">No Image</div>'}
                              <div class="product-details">
                                  <div class="product-name">${item.productName}</div>
                                  <div>Qty: ${item.quantity}</div>
                                  <div class="product-price">$${item.price}</div>
                              </div>
                          </div>
                      `).join('')}
                  </div>
                  
                  <div style="text-align: center; margin: 30px 0;">
                      <div style="font-size: 20px; font-weight: 700; color: #333;">Cart Total: $${data.cartValue.toFixed(2)}</div>
                      <a href="${process.env.FRONTEND_URL}/cart?recovery=${data._id}" class="cta-button">
                          Complete Your Purchase
                      </a>
                  </div>
                  
                  <p style="text-align: center; color: #666;">
                      Complete your purchase within the next 24 hours to secure these items!
                  </p>
              </div>
              <div class="footer">
                  <p>QuickLocal Marketplace | <a href="${process.env.FRONTEND_URL}/unsubscribe?email=${data.email}">Unsubscribe</a></p>
              </div>
          </div>
      </body>
      </html>
    `
  },

  second_reminder: {
    subject: "Still thinking about your cart? 🤔",
    html: (data) => `
      <!DOCTYPE html>
      <html>
      <head>
          <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #ffa726 0%, #fb8c00 100%); color: white; padding: 30px; text-align: center; }
              .content { padding: 30px; }
              .cta-button { background: #ff9800; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; margin: 20px 0; }
              .urgency-box { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>⏰ Time is running out!</h1>
                  <p>Your cart expires soon</p>
              </div>
              <div class="content">
                  <p>Hi again!</p>
                  <p>We noticed you haven't completed your purchase yet. Your items are still reserved, but not for much longer!</p>
                  
                  <div class="urgency-box">
                      <strong>⚡ Limited Time:</strong> Your cart will expire in 12 hours
                  </div>
                  
                  <div style="text-align: center; margin: 30px 0;">
                      <div style="font-size: 20px; font-weight: 700; color: #333;">Cart Value: $${data.cartValue.toFixed(2)}</div>
                      <a href="${process.env.FRONTEND_URL}/cart?recovery=${data._id}" class="cta-button">
                          🛒 Secure Your Items Now
                      </a>
                  </div>
                  
                  <p style="text-align: center; color: #666;">
                      Don't miss out on these great products!
                  </p>
              </div>
          </div>
      </body>
      </html>
    `
  },

  final_reminder: {
    subject: "Last chance! Your cart expires today ⏰",
    html: (data) => `
      <!DOCTYPE html>
      <html>
      <head>
          <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: white; padding: 30px; text-align: center; }
              .content { padding: 30px; }
              .cta-button { background: #e74c3c; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; margin: 20px 0; }
              .final-warning { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center; font-weight: 600; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>🚨 Final Warning!</h1>
                  <p>Your cart expires in 2 hours</p>
              </div>
              <div class="content">
                  <p>This is your final reminder!</p>
                  <p>Your cart will be cleared in just 2 hours. Don't lose these amazing items:</p>
                  
                  <div class="final-warning">
                      ⚠️ EXPIRES TODAY: Your $${data.cartValue.toFixed(2)} cart will be cleared soon!
                  </div>
                  
                  <div style="text-align: center; margin: 30px 0;">
                      <a href="${process.env.FRONTEND_URL}/cart?recovery=${data._id}" class="cta-button">
                          ⚡ Complete Purchase NOW
                      </a>
                  </div>
                  
                  <p style="text-align: center; font-size: 12px; color: #666;">
                      This is the last email you'll receive about this cart.
                  </p>
              </div>
          </div>
      </body>
      </html>
    `
  },

  incentive: {
    subject: "Special offer just for you! 🎁 10% OFF your cart",
    html: (data) => `
      <!DOCTYPE html>
      <html>
      <head>
          <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); color: white; padding: 30px; text-align: center; }
              .content { padding: 30px; }
              .cta-button { background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; margin: 20px 0; }
              .discount-box { background: #d4edda; border: 2px dashed #27ae60; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
              .discount-code { font-size: 24px; font-weight: 700; color: #27ae60; background: white; padding: 10px 20px; border-radius: 5px; display: inline-block; margin: 10px 0; border: 2px solid #27ae60; }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>🎁 Special Offer!</h1>
                  <p>10% OFF just for you</p>
              </div>
              <div class="content">
                  <p>Hi there!</p>
                  <p>We really want to see you complete your purchase, so we're offering you an exclusive 10% discount!</p>
                  
                  <div class="discount-box">
                      <h3>🎉 EXCLUSIVE OFFER</h3>
                      <p>Use code:</p>
                      <div class="discount-code">CART10</div>
                      <p><strong>Save 10% on your entire cart!</strong></p>
                      <p style="font-size: 14px; color: #666;">*Valid for 48 hours only</p>
                  </div>
                  
                  <div style="text-align: center; margin: 30px 0;">
                      <div style="font-size: 18px; margin-bottom: 10px;">
                          <span style="text-decoration: line-through; color: #999;">$${data.cartValue.toFixed(2)}</span>
                          <span style="font-weight: 700; color: #27ae60; margin-left: 10px;">$${(data.cartValue * 0.9).toFixed(2)}</span>
                      </div>
                      <p style="color: #27ae60; font-weight: 600;">You save $${(data.cartValue * 0.1).toFixed(2)}!</p>
                      <a href="${process.env.FRONTEND_URL}/cart?recovery=${data._id}&discount=CART10" class="cta-button">
                          🎁 Claim My Discount
                      </a>
                  </div>
                  
                  <p style="text-align: center; color: #666; font-size: 12px;">
                      This exclusive offer expires in 48 hours. Don't miss out!
                  </p>
              </div>
          </div>
      </body>
      </html>
    `
  }
};

// Cart Abandonment Service
class CartAbandonmentService {
  
  // Track cart abandonment
  static async trackAbandonment(userId, cartId, cartItems, cartValue) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(userId);
      
      if (!user || !user.email) {
        console.log('User not found or no email for abandonment tracking');
        return;
      }

      // Check if already tracked
      const existing = await CartAbandonment.findOne({ 
        userId, 
        cartId, 
        status: { $in: ['abandoned', 'reminded'] } 
      });

      if (existing) {
        // Update existing record
        existing.cartItems = cartItems;
        existing.cartValue = cartValue;
        existing.abandonedAt = new Date();
        await existing.save();
        return existing;
      }

      // Create new abandonment record
      const abandonment = new CartAbandonment({
        userId,
        cartId,
        email: user.email,
        cartItems: cartItems.map(item => ({
          productId: item.productId || item.product,
          productName: item.name || item.productName,
          productImage: item.images?.[0] || item.image,
          price: item.price,
          quantity: item.quantity
        })),
        cartValue,
        abandonedAt: new Date()
      });

      await abandonment.save();
      console.log('Cart abandonment tracked:', abandonment._id);
      return abandonment;

    } catch (error) {
      console.error('Error tracking cart abandonment:', error);
    }
  }

  // Mark cart as recovered
  static async markRecovered(cartId, userId) {
    try {
      await CartAbandonment.findOneAndUpdate(
        { cartId, userId },
        { 
          recovered: true,
          recoveredAt: new Date(),
          status: 'recovered'
        }
      );
      console.log('Cart marked as recovered:', cartId);
    } catch (error) {
      console.error('Error marking cart as recovered:', error);
    }
  }

  // Send abandonment email
  static async sendAbandonmentEmail(abandonmentId, emailType) {
    try {
      const abandonment = await CartAbandonment.findById(abandonmentId);
      if (!abandonment) {
        console.log('Abandonment record not found:', abandonmentId);
        return false;
      }

      // Check if this email type was already sent
      const alreadySent = abandonment.emailsSent.find(e => e.type === emailType);
      if (alreadySent) {
        console.log('Email already sent:', emailType, abandonmentId);
        return false;
      }

      const template = emailTemplates[emailType];
      if (!template) {
        console.log('Email template not found:', emailType);
        return false;
      }

      const transporter = createTransporter();
      const emailHtml = template.html(abandonment);

      await transporter.sendMail({
        from: `"QuickLocal Marketplace" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: abandonment.email,
        subject: template.subject,
        html: emailHtml
      });

      // Record email sent
      abandonment.emailsSent.push({
        type: emailType,
        sentAt: new Date()
      });

      // Update status
      if (emailType === 'incentive') {
        abandonment.incentiveOffered = 'discount_10';
      }
      abandonment.status = 'reminded';

      await abandonment.save();
      console.log(`${emailType} email sent to:`, abandonment.email);
      return true;

    } catch (error) {
      console.error('Error sending abandonment email:', error);
      return false;
    }
  }

  // Get abandonment analytics
  static async getAnalytics(startDate = null, endDate = null) {
    try {
      const dateFilter = {};
      if (startDate && endDate) {
        dateFilter.abandonedAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
      }

      const [
        totalAbandoned,
        totalRecovered,
        totalValue,
        recoveredValue,
        emailStats
      ] = await Promise.all([
        CartAbandonment.countDocuments(dateFilter),
        CartAbandonment.countDocuments({ ...dateFilter, recovered: true }),
        CartAbandonment.aggregate([
          { $match: dateFilter },
          { $group: { _id: null, total: { $sum: '$cartValue' } } }
        ]),
        CartAbandonment.aggregate([
          { $match: { ...dateFilter, recovered: true } },
          { $group: { _id: null, total: { $sum: '$cartValue' } } }
        ]),
        CartAbandonment.aggregate([
          { $match: dateFilter },
          { $unwind: '$emailsSent' },
          { $group: {
            _id: '$emailsSent.type',
            count: { $sum: 1 },
            opened: { $sum: { $cond: ['$emailsSent.opened', 1, 0] } },
            clicked: { $sum: { $cond: ['$emailsSent.clicked', 1, 0] } }
          }}
        ])
      ]);

      return {
        totalAbandoned,
        totalRecovered,
        recoveryRate: totalAbandoned > 0 ? ((totalRecovered / totalAbandoned) * 100).toFixed(2) : 0,
        totalAbandonedValue: totalValue[0]?.total || 0,
        totalRecoveredValue: recoveredValue[0]?.total || 0,
        emailStats: emailStats.reduce((acc, stat) => {
          acc[stat._id] = {
            sent: stat.count,
            opened: stat.opened,
            clicked: stat.clicked,
            openRate: stat.count > 0 ? ((stat.opened / stat.count) * 100).toFixed(2) : 0,
            clickRate: stat.count > 0 ? ((stat.clicked / stat.count) * 100).toFixed(2) : 0
          };
          return acc;
        }, {})
      };

    } catch (error) {
      console.error('Error getting analytics:', error);
      return null;
    }
  }
}

// Cron Jobs for Automated Email Campaigns
const setupCronJobs = () => {
  
  // First reminder: 1 hour after abandonment
  cron.schedule('0 */15 * * * *', async () => { // Every 15 minutes
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const abandonments = await CartAbandonment.find({
        abandonedAt: { $lte: oneHourAgo, $gte: new Date(oneHourAgo.getTime() - 15 * 60 * 1000) },
        status: 'abandoned',
        recovered: false
      });

      for (const abandonment of abandonments) {
        await CartAbandonmentService.sendAbandonmentEmail(abandonment._id, 'first_reminder');
      }

    } catch (error) {
      console.error('Error in first reminder cron:', error);
    }
  });

  // Second reminder: 6 hours after abandonment
  cron.schedule('0 */30 * * * *', async () => { // Every 30 minutes
    try {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const abandonments = await CartAbandonment.find({
        abandonedAt: { $lte: sixHoursAgo, $gte: new Date(sixHoursAgo.getTime() - 30 * 60 * 1000) },
        status: 'reminded',
        recovered: false,
        'emailsSent.type': 'first_reminder'
      });

      for (const abandonment of abandonments) {
        const hasSecond = abandonment.emailsSent.find(e => e.type === 'second_reminder');
        if (!hasSecond) {
          await CartAbandonmentService.sendAbandonmentEmail(abandonment._id, 'second_reminder');
        }
      }

    } catch (error) {
      console.error('Error in second reminder cron:', error);
    }
  });

  // Final reminder: 22 hours after abandonment
  cron.schedule('0 0 */1 * * *', async () => { // Every hour
    try {
      const twentyTwoHoursAgo = new Date(Date.now() - 22 * 60 * 60 * 1000);
      const abandonments = await CartAbandonment.find({
        abandonedAt: { $lte: twentyTwoHoursAgo, $gte: new Date(twentyTwoHoursAgo.getTime() - 60 * 60 * 1000) },
        status: 'reminded',
        recovered: false,
        'emailsSent.type': 'second_reminder'
      });

      for (const abandonment of abandonments) {
        const hasFinal = abandonment.emailsSent.find(e => e.type === 'final_reminder');
        if (!hasFinal) {
          await CartAbandonmentService.sendAbandonmentEmail(abandonment._id, 'final_reminder');
        }
      }

    } catch (error) {
      console.error('Error in final reminder cron:', error);
    }
  });

  // Incentive email: 2 days after abandonment (if cart value > $50)
  cron.schedule('0 0 */2 * * *', async () => { // Every 2 hours
    try {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const abandonments = await CartAbandonment.find({
        abandonedAt: { $lte: twoDaysAgo, $gte: new Date(twoDaysAgo.getTime() - 2 * 60 * 60 * 1000) },
        status: 'reminded',
        recovered: false,
        cartValue: { $gte: 50 },
        incentiveOffered: 'none'
      });

      for (const abandonment of abandonments) {
        const hasIncentive = abandonment.emailsSent.find(e => e.type === 'incentive');
        if (!hasIncentive) {
          await CartAbandonmentService.sendAbandonmentEmail(abandonment._id, 'incentive');
        }
      }

    } catch (error) {
      console.error('Error in incentive email cron:', error);
    }
  });

  // Cleanup: Mark old abandonments as expired
  cron.schedule('0 0 2 * * *', async () => { // Daily at 2 AM
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await CartAbandonment.updateMany(
        {
          abandonedAt: { $lte: sevenDaysAgo },
          status: { $ne: 'recovered' },
          recovered: false
        },
        { status: 'expired' }
      );
      
      console.log('Expired old cart abandonments');
    } catch (error) {
      console.error('Error in cleanup cron:', error);
    }
  });

  console.log('Cart abandonment cron jobs initialized');
};

// Routes for cart abandonment
const cartAbandonmentRoutes = (router) => {
  
  // Track cart abandonment (called when user leaves with items in cart)
  router.post('/cart/track-abandonment', async (req, res) => {
    try {
      const { userId, cartId, cartItems, cartValue } = req.body;

      if (!userId || !cartId || !cartItems || !cartValue) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields'
        });
      }

      const abandonment = await CartAbandonmentService.trackAbandonment(
        userId, cartId, cartItems, cartValue
      );

      res.json({
        success: true,
        message: 'Cart abandonment tracked',
        abandonmentId: abandonment?._id
      });

    } catch (error) {
      console.error('Track abandonment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to track cart abandonment'
      });
    }
  });

  // Mark cart as recovered (called on successful order)
  router.post('/cart/mark-recovered', async (req, res) => {
    try {
      const { cartId, userId } = req.body;

      if (!cartId || !userId) {
        return res.status(400).json({
          success: false,
          message: 'Missing cartId or userId'
        });
      }

      await CartAbandonmentService.markRecovered(cartId, userId);

      res.json({
        success: true,
        message: 'Cart marked as recovered'
      });

    } catch (error) {
      console.error('Mark recovered error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to mark cart as recovered'
      });
    }
  });

  // Get abandonment analytics (admin only)
  router.get('/admin/abandonment-analytics', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const analytics = await CartAbandonmentService.getAnalytics(startDate, endDate);

      res.json({
        success: true,
        analytics
      });

    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get analytics'
      });
    }
  });

  // Email tracking endpoints
  router.get('/email/track/:abandonmentId/:action', async (req, res) => {
    try {
      const { abandonmentId, action } = req.params;

      const abandonment = await CartAbandonment.findById(abandonmentId);
      if (!abandonment) {
        return res.status(404).send('Not found');
      }

      // Update email tracking
      if (action === 'open') {
        await CartAbandonment.findByIdAndUpdate(
          abandonmentId,
          { $set: { 'emailsSent.$[].opened': true } }
        );
        
        // Return 1x1 transparent pixel
        const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': pixel.length
        });
        return res.end(pixel);
      }

      if (action === 'click') {
        await CartAbandonment.findByIdAndUpdate(
          abandonmentId,
          { $set: { 'emailsSent.$[].clicked': true } }
        );
        
        // Redirect to cart with recovery token
        return res.redirect(`${process.env.FRONTEND_URL}/cart?recovery=${abandonmentId}`);
      }

      res.status(400).send('Invalid action');

    } catch (error) {
      console.error('Email tracking error:', error);
      res.status(500).send('Error');
    }
  });

  return router;
};

module.exports = {
  CartAbandonment,
  CartAbandonmentService,
  setupCronJobs,
  cartAbandonmentRoutes
};
