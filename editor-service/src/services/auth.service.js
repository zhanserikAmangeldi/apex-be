import axios from 'axios';
import NodeCache from 'node-cache';
import { config } from '../config/index.js';

class AuthService {
    constructor() {
        this.client = axios.create({
            baseURL: config.auth.serviceUrl,
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        this.tokenCache = new NodeCache({
            stdTTL: config.auth.tokenCacheTTL,
            checkperiod: 120,
        });
    }

    /**
     * Validate access token using auth service
     */
    async validateToken(accessToken) {
        const cacheKey = `token:${accessToken}`;
        const cached = this.tokenCache.get(cacheKey);

        if (cached) {
            return cached;
        }

        try {
            const response = await this.client.get('/api/v1/users/me', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            const userData = {
                userId: response.data.id,
                username: response.data.username,
                email: response.data.email,
                displayName: response.data.display_name,
            };

            this.tokenCache.set(cacheKey, userData);
            return userData;

        } catch (error) {
            if (error.response?.status === 401) {
                throw new Error('Token expired or invalid');
            }
            throw new Error(`Auth service error: ${error.message}`);
        }
    }

    /**
     * Refresh access token
     */
    async refreshToken(refreshToken) {
        try {
            const response = await this.client.post('/api/v1/auth/refresh', {
                refresh_token: refreshToken,
            });

            return {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
                expiresIn: response.data.expires_in,
            };
        } catch (error) {
            throw new Error('Failed to refresh token');
        }
    }

    /**
     * Invalidate cached token
     */
    invalidateCache(accessToken) {
        const cacheKey = `token:${accessToken}`;
        this.tokenCache.del(cacheKey);
    }

    /**
     * Clear all cached tokens
     */
    clearCache() {
        this.tokenCache.flushAll();
    }

    /**
     * Get user by ID (for internal use)
     */
    async getUserById(userId, accessToken) {
        try {
            const response = await this.client.get(`/api/v1/users/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });
            return response.data;
        } catch (error) {
            return null;
        }
    }
}

export const authService = new AuthService();
export default authService;
