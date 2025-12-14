import authClient from '../auth/authClient.js';

export function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'No token provided'
        });
    }

    authClient.validateToken(token)
        .then(user => {
            req.user = user;
            req.accessToken = token;
            next();
        })
        .catch(error => {
            if (error.message.includes('expired')) {
                return res.status(401).json({
                    error: 'Token expired',
                    message: 'Please refresh your token',
                    code: 'TOKEN_EXPIRED'
                });
            }

            return res.status(403).json({
                error: 'Invalid token',
                message: error.message
            });
        });
}

/**
 * Опциональная auth - не падает если токен невалидный
 */
export function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return next();
    }

    authClient.validateToken(token)
        .then(user => {
            req.user = user;
            req.accessToken = token;
            next();
        })
        .catch(() => {
            next();
        });
}