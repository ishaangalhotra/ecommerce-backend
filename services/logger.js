const winston = require('winston');
const { format } = winston;
const config = require('../config');
const emailService = require('./emailService'); // Your email service

// Custom log levels
const levels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  http: 5,
  silly: 6
};

// Custom colors for console output
const colors = {
  fatal: 'red',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
  http: 'magenta',
  silly: 'gray'
};
winston.addColors(colors);

// Email transport for critical errors
class EmailTransport extends winston.Transport {
  constructor(opts) {
    super(opts);
    this.name = 'emailTransport';
    this.level = opts.level || 'error';
  }

  log(info, callback) {
    setImmediate(() => this.emit('logged', info));
    
    if (config.email && emailService.transporter) {
      emailService.sendEmail({
        to: config.adminEmail || 'admin@example.com',
        subject: `🚨 Application Error: ${info.message}`,
        text: JSON.stringify(info, null, 2),
        html: `<pre>${JSON.stringify(info, null, 2)}</pre>`
      }).catch(err => {
        console.error('Failed to send error email:', err);
      });
    }
    
    callback();
  }
}

// Create logger instance
const logger = winston.createLogger({
  levels,
  level: config.logs?.level || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    // Console transport with colorization
    new winston.transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(info => {
          const { timestamp, level, message, ...meta } = info;
          let metaStr = '';
          if (Object.keys(meta).length > 0) {
            metaStr = JSON.stringify(meta, null, 2);
          }
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      )
    }),
    
    // File transport for errors
    new winston.transports.File({
      filename: `${config.logs?.directory || 'logs'}/error.log`,
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: `${config.logs?.directory || 'logs'}/combined.log`,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // Email transport for critical errors (only in production)
    ...(config.env === 'production' ? [
      new EmailTransport({ level: 'error' })
    ] : [])
  ],
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: `${config.logs?.directory || 'logs'}/exceptions.log` 
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: `${config.logs?.directory || 'logs'}/rejections.log` 
    })
  ]
});

// Add rotation for production
if (config.env === 'production') {
  require('winston-daily-rotate-file');
  
  logger.add(new winston.transports.DailyRotateFile({
    filename: `${config.logs.directory}/application-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: config.logs.zippedArchive || true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'info'
  }));
}

// Stream for Express morgan logging
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

module.exports = logger;