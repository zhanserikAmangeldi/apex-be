import dotenv from 'dotenv';
import { createHocuspocusServer } from './hocuspocus.js';
import { startApiServer } from './api.js';
import { initializeBuckets } from './storage/minio.js';
import { startSnapshotWorker, stopSnapshotWorker } from './workers/snapshot.js';
import pool from './db/pool.js';
import redisClient from './services/redis.js';
import pino from 'pino';

dotenv.config();

const logger = pino({ name: 'main' });
const PORT = parseInt(process.env.PORT || '3000');
const HOCUSPOCUS_PORT = parseInt(process.env.HOCUSPOCUS_PORT || '1234');

let hocuspocusServer = null;
let httpServer = null;
let isShuttingDown = false;

async function main() {
    logger.info('Starting Collaborative Editor Backend...');

    try {
        logger.info('Initializing MinIO buckets...');
        await initializeBuckets();

        logger.info('Starting Hocuspocus WebSocket server...');
        hocuspocusServer = createHocuspocusServer();
        await hocuspocusServer.listen();
        logger.info({ port: HOCUSPOCUS_PORT }, 'Hocuspocus listening');

        logger.info('Starting REST API server...');
        httpServer = startApiServer(PORT);

        logger.info('Starting snapshot worker...');
        startSnapshotWorker();

        logger.info({
            restApi: `http://localhost:${PORT}`,
            webSocket: `ws://localhost:${HOCUSPOCUS_PORT}`,
            database: `${process.env.DB_HOST}:${process.env.DB_PORT}`,
            minio: `${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`
        }, 'All services started successfully');

    } catch (err) {
        logger.error({ err }, 'Failed to start server');
        process.exit(1);
    }
}

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger.warn('Shutdown already in progress');
        return;
    }

    isShuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal, shutting down gracefully...');

    try {
        if (httpServer) {
            await new Promise((resolve) => {
                httpServer.close(() => {
                    logger.info('HTTP server closed');
                    resolve();
                });
            });
        }

        stopSnapshotWorker();
        logger.info('Snapshot worker stopped');

        if (hocuspocusServer) {
            await hocuspocusServer.destroy();
            logger.info('Hocuspocus server closed');
        }

        logger.info('Waiting for active operations to complete...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        await pool.end();
        logger.info('Database connections closed');

        await redisClient.quit();
        logger.info('Redis connection closed');

        logger.info('Graceful shutdown completed');
        process.exit(0);

    } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled rejection');
    gracefulShutdown('unhandledRejection');
});

main();