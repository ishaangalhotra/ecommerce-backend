const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { inspect } = require('util');
const { performance, PerformanceObserver } = require('perf_hooks');
const CircularJSON = require('circular-json');
const cls = require('cls-hooked');
const { MESSAGE } = require('triple-beam');

// Create async context for request tracing
const asyncContext = cls.createNamespace('loggerContext');

// Enhanced format configurations with circular reference handling
const {
    combine,
    timestamp,
    printf,
    errors,
    json,
    colorize,
    align,
    splat,
    metadata,
    label
} = winston.format;

// Enterprise log levels with severity scores
const enterpriseLevels = {
    levels: {
        emergency: 0,    // System is unusable
        alert: 1,        // Action must be taken immediately
        critical: 2,     // Critical conditions
        error: 3,        // Error conditions
        warning: 4,      // Warning conditions
        notice: 5,       // Normal but significant condition
        info: 6,         // Informational messages
        debug: 7,        // Debug-level messages
        trace: 8         // Trace-level messages
    },
    colors: {
        emergency: 'red bold underline',
        alert: 'red bold',
        critical: 'red',
        error: 'magenta',
        warning: 'yellow',
        notice: 'cyan',
        info: 'green',
        debug: 'blue',
        trace: 'grey'
    }
};

// ANSI color codes for terminal output
const ansiColors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    underline: '\x1b[4m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    grey: '\x1b[90m'
};

// Enhanced console format with performance metrics
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    const ctx = asyncContext.get('context') || {};
    const color = ansiColors[enterpriseLevels.colors[level].split(' ')[0]] || ansiColors.white;
    const styles = enterpriseLevels.colors[level].split(' ').slice(1).map(s => ansiColors[s]).join('');
    
    const metaStr = Object.keys(meta).length 
        ? `\n${ansiColors.grey}${inspect(meta, { colors: true, depth: 4, compact: false })}${ansiColors.reset}`
        : '';
    const errorStr = stack ? `\n${ansiColors.red}${stack}${ansiColors.reset}` : '';
    const ctxStr = Object.keys(ctx).length 
        ? `\n${ansiColors.cyan}Context: ${inspect(ctx, { colors: true, depth: 2, compact: true })}${ansiColors.reset}`
        : '';
    
    const memoryUsage = `[${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB]`;
    const cpuUsage = `[CPU:${(process.cpuUsage().user / 1000).toFixed(0)}ms]`;
    
    return `${ansiColors.grey}${timestamp}${ansiColors.reset} ` +
           `${ansiColors.yellow}[${process.pid}]${ansiColors.reset} ` +
           `${ansiColors.magenta}${memoryUsage}${cpuUsage}${ansiColors.reset} ` +
           `${styles}${color}[${level.toUpperCase()}]${ansiColors.reset} ` +
           `${message}${errorStr}${metaStr}${ctxStr}`;
});

// Enhanced JSON format with circular reference handling
const fileFormat = combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    errors({ stack: true }),
    metadata(),
    json(),
    printf((info) => {
        // Handle circular references
        const safeMeta = {};
        Object.keys(info.metadata).forEach(key => {
            try {
                JSON.stringify(info.metadata[key]);
                safeMeta[key] = info.metadata[key];
            } catch (e) {
                safeMeta[key] = '[Circular]';
            }
        });

        // Add comprehensive system information
        const enhanced = {
            ...info,
            severity: enterpriseLevels.levels[info.level] || 6,
            host: {
                hostname: os.hostname(),
                platform: os.platform(),
                release: os.release(),
                arch: os.arch(),
                cpus: os.cpus().length,
                load: os.loadavg(),
                memory: {
                    total: os.totalmem(),
                    free: os.freemem(),
                    used: os.totalmem() - os.freemem()
                }
            },
            process: {
                pid: process.pid,
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                uptime: process.uptime(),
                version: process.version,
                argv: process.argv,
                execArgv: process.execArgv
            },
            context: asyncContext.get('context') || {},
            metadata: safeMeta
        };

        return CircularJSON.stringify(enhanced);
    })
);

// Create log directory structure
const createLogDirectories = () => {
    const baseDir = path.join(__dirname, '../logs');
    const subDirs = ['application', 'error', 'audit', 'security', 'performance', 'http'];
    
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    
    subDirs.forEach(dir => {
        const dirPath = path.join(baseDir, dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath);
        }
    });
};
createLogDirectories();

// Enhanced file transport with encryption support
class SecureDailyRotateFile extends DailyRotateFile {
    constructor(options) {
        super(options);
        this.encryptionKey = options.encryptionKey;
    }
    
    _write(chunk, encoding, callback) {
        if (this.encryptionKey) {
            const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, crypto.randomBytes(16));
            chunk = cipher.update(chunk, 'utf8', 'hex') + cipher.final('hex');
        }
        super._write(chunk, encoding, callback);
    }
}

// Configure transports with encryption option
const createSecureFileTransport = (filename, level, options = {}) => {
    return new SecureDailyRotateFile({
        filename: path.join(__dirname, `../logs/${filename.split('-')[0]}/${filename}`),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: options.maxSize || '100m',
        maxFiles: options.maxFiles || '30d',
        level,
        format: fileFormat,
        auditFile: path.join(__dirname, `../logs/${filename.split('-')[0]}/.${filename.split('-')[0]}-audit.json`),
        createSymlink: true,
        symlinkName: `${filename.split('-')[0]}-current.log`,
        handleExceptions: level === 'error',
        handleRejections: level === 'error',
        encryptionKey: options.encryptionKey,
        ...options
    });
};

// Performance monitoring setup
const perfObserver = new PerformanceObserver((items) => {
    items.getEntries().forEach(entry => {
        logger.performance(entry.name, entry.duration, {
            detail: entry.detail,
            startTime: entry.startTime
        });
    });
});
perfObserver.observe({ entryTypes: ['measure'], buffered: true });

// Create logger instance with enhanced configuration
const logger = winston.createLogger({
    levels: enterpriseLevels.levels,
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        errors({ stack: true }),
        splat(),
        metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
        label({ label: process.env.SERVICE_NAME || 'app' })
    ),
    defaultMeta: {
        service: process.env.SERVICE_NAME || 'app',
        version: process.env.APP_VERSION || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        deployment: process.env.DEPLOYMENT_ID || 'local'
    },
    transports: [
        // Enhanced console transport with colors
        new winston.transports.Console({
            format: combine(
                colorize({ all: true, colors: enterpriseLevels.colors }),
                align(),
                consoleFormat
            ),
            handleExceptions: true,
            handleRejections: true,
            level: process.env.CONSOLE_LOG_LEVEL || 
                  (process.env.NODE_ENV === 'production' ? 'warning' : 'trace')
        }),

        // Application logs (all levels)
        createSecureFileTransport('application-%DATE%.log', 'trace', {
            maxSize: '200m',
            maxFiles: '30d'
        }),

        // Error logs (errors and above)
        createSecureFileTransport('error-%DATE%.log', 'error', {
            maxSize: '100m',
            maxFiles: '90d',
            encryptionKey: process.env.LOG_ENCRYPTION_KEY
        }),

        // Audit logs for compliance
        createSecureFileTransport('audit-%DATE%.log', 'notice', {
            maxSize: '100m',
            maxFiles: '365d',
            encryptionKey: process.env.LOG_ENCRYPTION_KEY
        }),

        // Security logs
        createSecureFileTransport('security-%DATE%.log', 'notice', {
            maxSize: '100m',
            maxFiles: '365d',
            encryptionKey: process.env.LOG_ENCRYPTION_KEY
        }),

        // Performance logs
        createSecureFileTransport('performance-%DATE%.log', 'info', {
            maxSize: '100m',
            maxFiles: '30d'
        }),

        // HTTP access logs
        createSecureFileTransport('http-%DATE%.log', 'http', {
            maxSize: '500m',
            maxFiles: '14d'
        })
    ],
    exceptionHandlers: [
        createSecureFileTransport('exceptions-%DATE%.log', 'emergency', {
            maxFiles: '90d',
            encryptionKey: process.env.LOG_ENCRYPTION_KEY
        })
    ],
    rejectionHandlers: [
        createSecureFileTransport('rejections-%DATE%.log', 'emergency', {
            maxFiles: '90d',
            encryptionKey: process.env.LOG_ENCRYPTION_KEY
        })
    ],
    exitOnError: false
});

// Add colors to winston
winston.addColors(enterpriseLevels.colors);

// Enhanced logging methods with context support
class EnhancedLogger {
    constructor(winstonLogger) {
        this.logger = winstonLogger;
    }

    // Context management
    withContext(context, fn) {
        return asyncContext.runAndReturn(() => {
            asyncContext.set('context', context);
            return fn();
        });
    }

    addContext(context) {
        const current = asyncContext.get('context') || {};
        asyncContext.set('context', { ...current, ...context });
    }

    clearContext() {
        asyncContext.set('context', {});
    }

    // Performance monitoring
    startTimer(name) {
        performance.mark(`${name}-start`);
        return {
            end: (meta = {}) => {
                performance.mark(`${name}-end`);
                performance.measure(name, `${name}-start`, `${name}-end`);
                performance.clearMarks(`${name}-start`);
                performance.clearMarks(`${name}-end`);
                
                const measure = performance.getEntriesByName(name)[0];
                this.logger.performance(name, measure.duration, meta);
                performance.clearMeasures(name);
            }
        };
    }

    // Security logging
    securityEvent(event, meta = {}) {
        this.logger.log('notice', `SECURITY: ${event}`, {
            ...meta,
            category: 'security',
            severity: 'high'
        });
    }

    // Audit logging
    auditLog(action, actor, target, meta = {}) {
        this.logger.log('notice', `AUDIT: ${action}`, {
            actor,
            target,
            ...meta,
            category: 'audit',
            compliance: true
        });
    }

    // Business transaction logging
    transaction(type, id, status, meta = {}) {
        this.logger.log('info', `TX: ${type}`, {
            transactionId: id,
            status,
            ...meta,
            category: 'transaction'
        });
    }

    // API request/response logging
    apiRequest(req, res, duration, meta = {}) {
        const level = res.statusCode >= 500 ? 'error' : 
                     res.statusCode >= 400 ? 'warning' : 'info';
        
        this.logger.log(level, `API ${req.method} ${req.path}`, {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            ...meta,
            category: 'api'
        });
    }

    // Database query logging
    dbQuery(operation, collection, duration, meta = {}) {
        const level = duration > 100 ? 'warning' : 'debug';
        this.logger.log(level, `DB ${operation}`, {
            operation,
            collection,
            duration,
            ...meta,
            category: 'database'
        });
    }

    // Error with context
    errorWithContext(error, context = {}, meta = {}) {
        this.logger.log('error', error.message, {
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: error.code,
                details: error.details
            },
            ...context,
            ...meta,
            category: 'error'
        });
    }

    // Structured logging for all levels
    log(level, message, meta = {}) {
        this.logger.log(level, message, meta);
    }
}

// Create enhanced logger instance
const enhancedLogger = new EnhancedLogger(logger);

// Add Express middleware for request logging
enhancedLogger.requestMiddleware = (options = {}) => {
    const {
        includeHeaders = false,
        includeBody = false,
        includeResponse = false,
        sensitiveFields = ['password', 'token', 'secret', 'authorization', 'cookie'],
        ignorePaths = ['/health', '/metrics', '/favicon.ico']
    } = options;

    return (req, res, next) => {
        if (ignorePaths.includes(req.path)) return next();

        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] || crypto.randomUUID();
        
        // Store in async context
        enhancedLogger.addContext({ requestId });

        // Log request
        const requestMeta = {
            requestId,
            method: req.method,
            path: req.path,
            query: req.query,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            ...(includeHeaders && { headers: this.sanitizeData(req.headers, sensitiveFields) }),
            ...(includeBody && req.body && { body: this.sanitizeData(req.body, sensitiveFields) })
        };

        enhancedLogger.log('info', `Request: ${req.method} ${req.path}`, requestMeta);

        // Hook response to log completion
        const originalEnd = res.end;
        res.end = function(chunk, encoding) {
            const duration = Date.now() - startTime;
            
            const responseMeta = {
                requestId,
                statusCode: res.statusCode,
                duration,
                ...(includeResponse && chunk && { response: this.sanitizeData(
                    JSON.parse(chunk.toString()), 
                    sensitiveFields
                )})
            };

            const level = res.statusCode >= 500 ? 'error' : 
                         res.statusCode >= 400 ? 'warning' : 'info';
            
            enhancedLogger.log(level, `Response: ${req.method} ${req.path}`, responseMeta);
            
            originalEnd.call(this, chunk, encoding);
        };

        next();
    };
};

// Add sanitization method
enhancedLogger.sanitizeData = (data, sensitiveFields) => {
    if (!data || typeof data !== 'object') return data;
    
    const sanitized = Array.isArray(data) ? [...data] : { ...data };
    
    Object.keys(sanitized).forEach(key => {
        const lowerKey = key.toLowerCase();
        if (sensitiveFields.some(field => lowerKey.includes(field.toLowerCase()))) {
            sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'object') {
            sanitized[key] = this.sanitizeData(sanitized[key], sensitiveFields);
        }
    });
    
    return sanitized;
};

// Add health check
enhancedLogger.healthCheck = () => {
    const transports = logger.transports.map(t => t.name || t.constructor.name);
    const activeTransports = logger.transports.filter(t => t._writableState && !t._writableState.destroyed);
    
    return {
        status: activeTransports.length === logger.transports.length ? 'healthy' : 'degraded',
        level: logger.level,
        transports,
        activeTransports: activeTransports.length,
        logDirectory: path.join(__dirname, '../logs'),
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
    };
};

// Add log rotation handler
enhancedLogger.handleRotation = () => {
    logger.transports.forEach(transport => {
        if (transport.on && typeof transport.on === 'function') {
            transport.on('rotate', (oldFile, newFile) => {
                logger.notice(`Log file rotated from ${oldFile} to ${newFile}`, {
                    category: 'system',
                    event: 'logRotation'
                });
            });
        }
    });
};
enhancedLogger.handleRotation();

// Add graceful shutdown
enhancedLogger.gracefulShutdown = () => {
    return new Promise((resolve) => {
        logger.notice('Initiating logger shutdown...', { category: 'system' });
        
        let closedCount = 0;
        const totalTransports = logger.transports.length;
        
        const checkComplete = () => {
            if (++closedCount >= totalTransports) {
                logger.notice('Logger shutdown complete', { category: 'system' });
                resolve();
            }
        };
        
        logger.transports.forEach(transport => {
            if (transport.close) {
                transport.close().then(checkComplete).catch(err => {
                    logger.error('Error closing transport', {
                        transport: transport.name,
                        error: err.message,
                        category: 'system'
                    });
                    checkComplete();
                });
            } else {
                checkComplete();
            }
        });
    });
};

// Export enhanced logger
module.exports = enhancedLogger;