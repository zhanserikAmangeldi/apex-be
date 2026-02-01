import redisClient from './redis.js';
import pino from 'pino';

const logger = pino({ name: 'lock-service' });

class LockService {
    async acquireLock(key, ttl = 5000) {
        const lockKey = `lock:${key}`;
        const lockValue = `${Date.now()}:${Math.random()}`;
        
        try {
            const result = await redisClient.set(lockKey, lockValue, {
                PX: ttl,
                NX: true
            });
            
            return result === 'OK';
        } catch (err) {
            logger.error({ key, err }, 'Failed to acquire lock');
            return false;
        }
    }

    async releaseLock(key) {
        const lockKey = `lock:${key}`;
        
        try {
            await redisClient.del(lockKey);
        } catch (err) {
            logger.error({ key, err }, 'Failed to release lock');
        }
    }

    async withLock(key, fn, ttl = 5000, maxRetries = 3) {
        let retries = 0;
        
        while (retries < maxRetries) {
            const acquired = await this.acquireLock(key, ttl);
            
            if (acquired) {
                try {
                    return await fn();
                } finally {
                    await this.releaseLock(key);
                }
            }
            
            retries++;
            if (retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retries)));
            }
        }
        
        throw new Error(`Failed to acquire lock after ${maxRetries} attempts: ${key}`);
    }

    async tryWithLock(key, fn, ttl = 5000) {
        const acquired = await this.acquireLock(key, ttl);
        
        if (!acquired) {
            return null;
        }
        
        try {
            return await fn();
        } finally {
            await this.releaseLock(key);
        }
    }
}

export const lockService = new LockService();
export default lockService;
