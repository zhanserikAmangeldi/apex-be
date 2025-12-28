import { authService } from '../../services/auth.service.js';

/**
 * Authenticate token middleware
 * Requires valid access token in Authorization header
 */
export function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            error: 'authentication_required',
            message: 'No token provided',
        });
    }

    authService.validateToken(token)
        .then(user => {
            req.user = user;
            req.accessToken = token;
            next();
        })
        .catch(error => {
            if (error.message.includes('expired')) {
                return res.status(401).json({
                    error: 'token_expired',
                    message: 'Please refresh your token',
                    code: 'TOKEN_EXPIRED',
                });
            }

            return res.status(403).json({
                error: 'invalid_token',
                message: error.message,
            });
        });
}

/**
 * Optional authentication middleware
 * Doesn't fail if token is invalid, just doesn't set user
 */
export function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return next();
    }

    authService.validateToken(token)
        .then(user => {
            req.user = user;
            req.accessToken = token;
            next();
        })
        .catch(() => {
            next();
        });
}

/**
 * Require specific permission level
 */
export function requirePermission(minPermission) {
    const permissionLevels = {
        'read': 1,
        'write': 2,
        'admin': 3,
        'owner': 4,
    };

    return (req, res, next) => {
        const userPermission = req.userPermission || 'none';
        const minLevel = permissionLevels[minPermission] || 0;
        const userLevel = permissionLevels[userPermission] || 0;

        if (userLevel < minLevel) {
            return res.status(403).json({
                error: 'insufficient_permissions',
                message: `Requires at least '${minPermission}' permission`,
            });
        }

        next();
    };
}

export default {
    authenticateToken,
    optionalAuth,
    requirePermission,
};
