import redisClient from './redis.js';
import pino from 'pino';

const logger = pino({ name: 'rate-limiter' });

class RateLimiter {
    constructor(options = {}) {
        this.points = options.points || 100; // Number of points
        this.duration = options.duration || 10; // Duration in seconds
        this.blockDuration = options.blockDuration || 60; // Block duration in seconds
    }

    getKey(identifier) {
        return `ratelimit:${identifier}`;
    }

    getBlockKey(identifier) {
        return `ratelimit:block:${identifier}`;
    }

    async isBlocked(identifier) {
        const blockKey = this.getBlockKey(identifier);
        const blocked = await redisClient.get(blockKey);
        return blocked !== null;
    }

    async block(identifier) {
        const blockKey = this.getBlockKey(identifier);
        await redisClient.set(blockKey, '1', { EX: this.blockDuration });
        logger.warn({ identifier, duration: this.blockDuration }, 'Identifier blocked');
    }

    async consume(identifier, points = 1) {
        if (await this.isBlocked(identifier)) {
            return {
                success: false,
                remainingPoints: 0,
                resetTime: Date.now() + this.blockDuration * 1000,
                blocked: true
            };
        }

        const key = this.getKey(identifier);
        
        try {
            const current = await redisClient.get(key);
            const count = current ? parseInt(current) : 0;
            
            if (count >= this.points) {
                await this.block(identifier);
                
                return {
                    success: false,
                    remainingPoints: 0,
                    resetTime: Date.now() + this.blockDuration * 1000,
                    blocked: true
                };
            }
            
            const newCount = await redisClient.incr(key);
            
            if (newCount === 1) {
                await redisClient.expire(key, this.duration);
            }
            
            const ttl = await redisClient.ttl(key);
            const resetTime = Date.now() + ttl * 1000;
            
            return {
                success: true,
                remainingPoints: this.points - newCount,
                resetTime,
                blocked: false
            };
            
        } catch (err) {
            logger.error({ identifier, err }, 'Rate limiter error');
            return {
                success: true,
                remainingPoints: this.points,
                resetTime: Date.now() + this.duration * 1000,
                blocked: false
            };
        }
    }

    async reset(identifier) {
        const key = this.getKey(identifier);
        const blockKey = this.getBlockKey(identifier);
        
        await Promise.all([
            redisClient.del(key),
            redisClient.del(blockKey)
        ]);
        
        logger.info({ identifier }, 'Rate limit reset');
    }

    async getState(identifier) {
        const key = this.getKey(identifier);
        const blockKey = this.getBlockKey(identifier);
        
        const [count, ttl, blocked] = await Promise.all([
            redisClient.get(key),
            redisClient.ttl(key),
            redisClient.get(blockKey)
        ]);
        
        const currentCount = count ? parseInt(count) : 0;
        
        return {
            consumed: currentCount,
            remaining: Math.max(0, this.points - currentCount),
            resetTime: ttl > 0 ? Date.now() + ttl * 1000 : null,
            blocked: blocked !== null
        };
    }
}

export const wsUpdateLimiter = new RateLimiter({
    points: 100,      // 100 updates
    duration: 10,     // per 10 seconds
    blockDuration: 60 // block for 1 minute if exceeded
});

export const wsConnectionLimiter = new RateLimiter({
    points: 10,       // 10 connections
    duration: 60,     // per minute
    blockDuration: 300 // block for 5 minutes if exceeded
});

export const apiLimiter = new RateLimiter({
    points: 100,      // 100 requests
    duration: 60,     // per minute
    blockDuration: 300 // block for 5 minutes if exceeded
});

export default RateLimiter;
