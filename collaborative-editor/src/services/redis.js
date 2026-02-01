import { createClient } from 'redis';
import pino from 'pino';

const logger = pino({ name: 'redis-client' });

const redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                logger.error('Redis reconnection failed after 10 attempts');
                return new Error('Redis reconnection limit exceeded');
            }
            return Math.min(retries * 100, 3000);
        }
    }
});

redisClient.on('error', (err) => logger.error('Redis Client Error:', err));
redisClient.on('connect', () => logger.info('Redis Client Connected'));
redisClient.on('ready', () => logger.info('Redis Client Ready'));
redisClient.on('reconnecting', () => logger.warn('Redis Client Reconnecting...'));

await redisClient.connect();

export default redisClient;
