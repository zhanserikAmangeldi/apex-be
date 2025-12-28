import express from 'express';
import helmet from 'helmet';

import { config, isDevelopment } from './config/index.js';
import { testConnection } from './db/pool/index.js';
import { minioService } from './storage/minio.service.js';
import { createHocuspocusServer } from './services/hocuspocus.server.js';
import { snapshotWorker } from './workers/snapshot.worker.js';
import { logger, httpLogger } from './services/logger.service.js';

import documentsRoutes from './api/routes/documents.routes.js';
import vaultsRoutes from './api/routes/vaults.routes.js';

import { errorHandler, notFoundHandler } from './api/middleware/index.js';

async function main() {
    logger.info('Starting Editor Service', { env: config.nodeEnv });

    const dbConnected = await testConnection();
    if (!dbConnected) {
        logger.fatal('Failed to connect to database');
        process.exit(1);
    }

    try {
        await minioService.initializeBuckets();
        logger.info('MinIO initialized');
    } catch (err) {
        logger.fatal({ err }, 'Failed to initialize MinIO');
        process.exit(1);
    }

    const app = express();

    app.use(helmet({
        contentSecurityPolicy: false,
    }));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    app.use(httpLogger());

    app.get('/health', async (req, res) => {
        const workerStats = await snapshotWorker.getStats();

        res.json({
            status: 'healthy',
            service: 'editor-service',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            worker: {
                running: workerStats.isRunning,
                pendingSnapshots: workerStats.pendingSnapshots,
            },
        });
    });

    app.use('/api/v1/documents', documentsRoutes);
    app.use('/api/v1/vaults', vaultsRoutes);

    app.get('/api/v1/stats/worker', async (req, res) => {
        const stats = await snapshotWorker.getStats();
        res.json(stats);
    });

    app.use(notFoundHandler);
    app.use(errorHandler);

    const httpServer = app.listen(config.port, () => {
        logger.info(`HTTP server running on port ${config.port}`);
    });

    const hocuspocusServer = createHocuspocusServer();
    await hocuspocusServer.listen();
    logger.info(`Hocuspocus WebSocket server running on port ${config.hocuspocusPort}`);

    snapshotWorker.start();

    const shutdown = async (signal) => {
        logger.info(`${signal} received. Shutting down gracefully...`);

        httpServer.close(() => {
            logger.info('HTTP server closed');
        });

        snapshotWorker.stop();

        await hocuspocusServer.destroy();
        logger.info('Hocuspocus server closed');

        setTimeout(() => {
            logger.info('Goodbye!');
            process.exit(0);
        }, 1000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
        logger.fatal({ err }, 'Uncaught Exception');
        shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error({ reason }, 'Unhandled Rejection');
    });
}

main().catch((err) => {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
});
