const winston = require('winston');
const { combine, timestamp, printf, colorize, json, errors } = winston.format;
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');
const { inspect } = require('util');

// Define custom colors for different log levels
winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
});

// Custom formatter that handles errors and objects
const customFormatter = printf(({ level, message, timestamp, stack, ...meta }) => {
  let msg = `${timestamp} [${level.toUpperCase()}] ${message}`;
  
  // Handle error stacks
  if (stack) {
    msg += `\n${stack}`;
  }
  
  // Stringify metadata if present
  if (Object.keys(meta).length > 0) {
    msg += `\n${inspect(meta, { colors: true, depth: 5 })}`;
  }
  
  return msg;
});

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: combine(
    errors({ stack: true }), // Proper error stack traces
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    process.env.NODE_ENV === 'production' ? json() : combine(colorize(), customFormatter)
  ),
  transports: [
    // Console transport for development
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true
    }),
    
    // Daily rotating file transport for all logs
    new DailyRotateFile({
      filename: path.join(__dirname, '../logs/application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info'
    }),
    
    // Daily rotating file transport for errors
    new DailyRotateFile({
      filename: path.join(__dirname, '../logs/error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error'
    })
  ],
  exitOnError: false
});

// Special HTTP logger middleware
logger.http = (info) => {
  const { method, url, status, responseTime, ip, userAgent } = info;
  logger.log({
    level: 'http',
    message: `${method} ${url} ${status} - ${responseTime}ms`,
    meta: {
      ip,
      userAgent,
      statusCode: status
    }
  });
};

// Stream for morgan (if you're using it)
logger.stream = {
  write: (message) => {
    logger.http(JSON.parse(message));
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Don't exit in production, let the process manager handle it
  if (process.env.NODE_ENV !== 'production') process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = logger;