import { ZodError } from 'zod';
import { logger } from '../../services/logger.service.js';

/**
 * Validate request body against Zod schema
 */
export function validateBody(schema) {
    return (req, res, next) => {
        try {
            const validated = schema.parse(req.body);
            req.body = validated;
            next();
        } catch (error) {
            handleValidationError(error, res, 'body');
        }
    };
}

/**
 * Validate request params against Zod schema
 */
export function validateParams(schema) {
    return (req, res, next) => {
        try {
            const validated = schema.parse(req.params);
            req.params = validated;
            next();
        } catch (error) {
            handleValidationError(error, res, 'params');
        }
    };
}

/**
 * Validate request query against Zod schema
 */
export function validateQuery(schema) {
    return (req, res, next) => {
        try {
            const validated = schema.parse(req.query);
            req.query = validated;
            next();
        } catch (error) {
            handleValidationError(error, res, 'query');
        }
    };
}

/**
 * Validate multiple parts of request
 */
export function validate(schemas) {
    return (req, res, next) => {
        const errors = [];

        if (schemas.body) {
            try {
                req.body = schemas.body.parse(req.body);
            } catch (error) {
                if (error instanceof ZodError) {
                    errors.push(...formatZodErrors(error, 'body'));
                }
            }
        }

        if (schemas.params) {
            try {
                req.params = schemas.params.parse(req.params);
            } catch (error) {
                if (error instanceof ZodError) {
                    errors.push(...formatZodErrors(error, 'params'));
                }
            }
        }

        if (schemas.query) {
            try {
                req.query = schemas.query.parse(req.query);
            } catch (error) {
                if (error instanceof ZodError) {
                    errors.push(...formatZodErrors(error, 'query'));
                }
            }
        }

        if (errors.length > 0) {
            logger.warn('Validation failed', { 
                path: req.path, 
                method: req.method,
                errors 
            });

            return res.status(400).json({
                error: 'validation_error',
                message: 'Request validation failed',
                details: errors,
            });
        }

        next();
    };
}

/**
 * Format Zod errors for API response
 */
function formatZodErrors(error, location) {
    return error.errors.map((err) => ({
        location,
        path: err.path.join('.'),
        message: err.message,
        code: err.code,
    }));
}

/**
 * Handle validation error response
 */
function handleValidationError(error, res, location) {
    if (error instanceof ZodError) {
        const details = formatZodErrors(error, location);
        
        logger.warn('Validation failed', { location, details });

        return res.status(400).json({
            error: 'validation_error',
            message: 'Request validation failed',
            details,
        });
    }

    logger.error('Unexpected validation error', { error: error.message });

    return res.status(500).json({
        error: 'internal_error',
        message: 'Validation processing failed',
    });
}

export default {
    validateBody,
    validateParams,
    validateQuery,
    validate,
};
