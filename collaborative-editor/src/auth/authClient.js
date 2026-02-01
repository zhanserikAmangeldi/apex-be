import axios from 'axios';
import axiosRetry from 'axios-retry';
import NodeCache from 'node-cache';
import jwt from 'jsonwebtoken';
import pino from 'pino';

const logger = pino({ name: 'auth-client' });
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_SECRET;
const tokenCache = new NodeCache({ stdTTL: 60 });

class AuthClient {
    constructor() {
        this.client = axios.create({
            baseURL: AUTH_SERVICE_URL,
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        axiosRetry(this.client, {
            retries: 3,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) => {
                return axiosRetry.isNetworkOrIdempotentRequestError(error) 
                    || error.response?.status === 503;
            },
            onRetry: (retryCount, error) => {
                logger.warn({ retryCount, error: error.message }, 'Retrying auth request');
            }
        });
    }

    async validateToken(accessToken) {
        const cacheKey = `token:${accessToken}`;
        const cached = tokenCache.get(cacheKey);
        
        if (cached) {
            return cached;
        }

        try {
            const response = await this.client.get('/api/v1/users/me', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            const userData = {
                userId: response.data.id,
                username: response.data.username,
                email: response.data.email,
                displayName: response.data.display_name
            };

            tokenCache.set(cacheKey, userData);

            return userData;

        } catch (error) {
            // Fallback: if auth-service is unavailable, validate JWT locally
            if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
                logger.warn('Auth service unavailable, falling back to local JWT validation');
                return this.validateTokenLocally(accessToken);
            }

            if (error.response?.status === 401) {
                throw new Error('Token expired or invalid');
            }
            
            throw new Error(`Auth service error: ${error.message}`);
        }
    }

    validateTokenLocally(accessToken) {
        if (!JWT_SECRET) {
            throw new Error('JWT_SECRET not configured, cannot validate token locally');
        }

        try {
            const decoded = jwt.verify(accessToken, JWT_SECRET);
            
            if (!decoded.user_id) {
                throw new Error('Invalid token structure: missing user_id');
            }

            const userData = {
                userId: decoded.user_id,
                username: decoded.username,
                email: decoded.email,
                displayName: decoded.display_name
            };

            // Cache with shorter TTL for local validation
            tokenCache.set(`token:${accessToken}`, userData, 30);

            logger.info({ userId: userData.userId }, 'Token validated locally');

            return userData;

        } catch (err) {
            logger.error({ err }, 'Local token validation failed');
            throw new Error('Invalid token');
        }
    }

    async refreshToken(refreshToken) {
        try {
            const response = await this.client.post('/api/v1/auth/refresh', {
                refresh_token: refreshToken
            });

            return {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
                expiresIn: response.data.expires_in
            };

        } catch (error) {
            throw new Error('Failed to refresh token');
        }
    }

    invalidateCache(accessToken) {
        const cacheKey = `token:${accessToken}`;
        tokenCache.del(cacheKey);
    }

    clearCache() {
        tokenCache.flushAll();
    }
}

export const authClient = new AuthClient();
export default authClient;