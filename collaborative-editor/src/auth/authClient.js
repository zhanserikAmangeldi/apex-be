import axios from 'axios';
import NodeCache from 'node-cache';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:8080';
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
    }

    /**
     * Validation access token using auth service
     */
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

    /**
     * Очистить кэш для конкретного токена
     */
    invalidateCache(accessToken) {
        const cacheKey = `token:${accessToken}`;
        tokenCache.del(cacheKey);
    }

    /**
     * Очистить весь кэш (при logout)
     */
    clearCache() {
        tokenCache.flushAll();
    }
}

export const authClient = new AuthClient();
export default authClient;