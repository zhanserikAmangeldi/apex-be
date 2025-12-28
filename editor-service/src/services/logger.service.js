import pino from 'pino';
import { config, isDevelopment } from '../config/index.js';

// Create base logger
const baseLogger = pino({
    level: config.logLevel || (isDevelopment() ? 'debug' : 'info'),
    
    // Pretty print in development
    transport: isDevelopment() 
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        }
        : undefined,

    // Base context
    base: {
        service: 'editor-service',
        env: config.nodeEnv,
    },

    // Timestamp format
    timestamp: pino.stdTimeFunctions.isoTime,

    // Custom serializers
    serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
        req: (req) => ({
            method: req.method,
            url: req.url,
            path: req.path,
            query: req.query,
            params: req.params,
            headers: {
                'user-agent': req.headers['user-agent'],
                'content-type': req.headers['content-type'],
                'x-request-id': req.headers['x-request-id'],
            },
            remoteAddress: req.ip,
            userId: req.user?.userId,
        }),
        res: (res) => ({
            statusCode: res.statusCode,
        }),
    },

    // Redact sensitive data
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'password',
            'token',
            'accessToken',
            'refreshToken',
            'secret',
        ],
        censor: '[REDACTED]',
    },
});

// Create child loggers for different modules
export const logger = baseLogger;

export function createLogger(module) {
    return baseLogger.child({ module });
}

// Pre-configured module loggers
export const dbLogger = createLogger('database');
export const authLogger = createLogger('auth');
export const wsLogger = createLogger('websocket');
export const apiLogger = createLogger('api');
export const workerLogger = createLogger('worker');

// HTTP request logging middleware
export function httpLogger() {
    return (req, res, next) => {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] || generateRequestId();
        
        // Attach request ID
        req.requestId = requestId;
        res.setHeader('X-Request-ID', requestId);

        // Log request start
        apiLogger.info({
            type: 'request_start',
            requestId,
            method: req.method,
            path: req.path,
            query: req.query,
            userId: req.user?.userId,
            ip: req.ip,
        });

        // Log response on finish
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            const logLevel = res.statusCode >= 500 ? 'error' 
                          : res.statusCode >= 400 ? 'warn' 
                          : 'info';

            apiLogger[logLevel]({
                type: 'request_complete',
                requestId,
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                duration,
                userId: req.user?.userId,
            });
        });

        next();
    };
}

// Error logging helper
export function logError(error, context = {}) {
    logger.error({
        type: 'error',
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: error.code,
        },
        ...context,
    });
}

// Audit logging for sensitive operations
export function logAudit(action, userId, details = {}) {
    logger.info({
        type: 'audit',
        action,
        userId,
        timestamp: new Date().toISOString(),
        ...details,
    });
}

// Performance logging
export function logPerformance(operation, duration, details = {}) {
    const level = duration > 1000 ? 'warn' : 'debug';
    logger[level]({
        type: 'performance',
        operation,
        duration,
        slow: duration > 1000,
        ...details,
    });
}

// WebSocket connection logging
export function logWsConnection(event, documentId, userId, details = {}) {
    wsLogger.info({
        type: `ws_${event}`,
        documentId,
        userId,
        timestamp: new Date().toISOString(),
        ...details,
    });
}

function generateRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
}

export default logger;
