/**
 * Global error handler middleware
 */
export function errorHandler(err, req, res, next) {
    console.error('❌ Error:', err);

    // Handle specific error types
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'validation_error',
            message: err.message,
            details: err.details || null,
        });
    }

    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'unauthorized',
            message: err.message || 'Authentication required',
        });
    }

    if (err.name === 'ForbiddenError') {
        return res.status(403).json({
            error: 'forbidden',
            message: err.message || 'Access denied',
        });
    }

    if (err.name === 'NotFoundError') {
        return res.status(404).json({
            error: 'not_found',
            message: err.message || 'Resource not found',
        });
    }

    // Database errors
    if (err.code === '23505') {
        return res.status(409).json({
            error: 'conflict',
            message: 'Resource already exists',
        });
    }

    if (err.code === '23503') {
        return res.status(400).json({
            error: 'invalid_reference',
            message: 'Referenced resource does not exist',
        });
    }

    // Default error response
    const statusCode = err.statusCode || err.status || 500;
    const message = statusCode === 500 
        ? 'Internal server error' 
        : err.message;

    res.status(statusCode).json({
        error: 'server_error',
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
}

/**
 * Not found handler - for undefined routes
 */
export function notFoundHandler(req, res) {
    res.status(404).json({
        error: 'not_found',
        message: `Route ${req.method} ${req.path} not found`,
    });
}

/**
 * Custom error classes
 */
export class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message, details = null) {
        super(message, 400);
        this.name = 'ValidationError';
        this.details = details;
    }
}

export class UnauthorizedError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401);
        this.name = 'UnauthorizedError';
    }
}

export class ForbiddenError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403);
        this.name = 'ForbiddenError';
    }
}

export class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404);
        this.name = 'NotFoundError';
    }
}

export class ConflictError extends AppError {
    constructor(message = 'Resource already exists') {
        super(message, 409);
        this.name = 'ConflictError';
    }
}

export default {
    errorHandler,
    notFoundHandler,
    AppError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
};
