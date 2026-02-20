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
import attachmentsRoutes from './api/routes/attachments.routes.js';
import tagsRoutes from './api/routes/tags.routes.js';
import searchRoutes from './api/routes/search.routes.js';
import graphRoutes from './api/routes/graph.routes.js';

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
        frameguard: false, // Disable X-Frame-Options to allow iframe embedding
        crossOriginResourcePolicy: false, // Disable CORP to allow cross-origin loading
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
    app.use('/api/v1/attachments', attachmentsRoutes);
    app.use('/api/v1', tagsRoutes);
    app.use('/api/v1/search', searchRoutes);
    app.use('/api/v1', graphRoutes);
    
    // Public download endpoint (bypasses API Gateway auth)
    app.get('/public/attachments/:id/download', async (req, res, next) => {
        try {
            const { id } = req.params;
            const token = req.query.token;

            console.log('Public download request:', {
                id,
                hasToken: !!token,
                tokenPreview: token ? token.substring(0, 20) + '...' : 'none'
            });

            if (!token) {
                console.log('No token provided');
                return res.status(401).json({ error: 'Token required' });
            }

            // Verify JWT token directly (same as API Gateway)
            let userId;
            try {
                const jwt = await import('jsonwebtoken');
                const jwtSecret = process.env.JWT_SECRET || config.auth.jwtSecret;
                
                if (!jwtSecret) {
                    console.error('JWT_SECRET not configured');
                    return res.status(500).json({ error: 'Server configuration error' });
                }

                console.log('Verifying JWT token...');
                const decoded = jwt.default.verify(token, jwtSecret);
                userId = decoded.user_id;
                console.log('Token verified for user:', userId);
            } catch (error) {
                console.error('JWT verification failed:', error.message);
                return res.status(401).json({ error: 'Invalid token' });
            }

            const { attachmentRepository } = await import('./db/repositories/index.js');
            const { minioService } = await import('./storage/minio.service.js');

            const attachment = await attachmentRepository.getById(id);
            if (!attachment) {
                console.log('Attachment not found:', id);
                return res.status(404).json({ error: 'Attachment not found' });
            }

            console.log('Found attachment:', attachment.filename);

            // Check access
            const hasAccess = await attachmentRepository.checkAccess(id, userId);
            if (!hasAccess) {
                console.log('Access denied for user:', userId);
                return res.status(403).json({ error: 'No access to this attachment' });
            }

            console.log('Downloading from MinIO:', attachment.minio_path);

            // Download from MinIO
            const fileBuffer = await minioService.download(
                config.minio.buckets.attachments,
                attachment.minio_path
            );

            console.log('File downloaded, size:', fileBuffer.length);

            // Set headers - allow cross-origin access
            res.removeHeader('X-Frame-Options');
            res.removeHeader('Cross-Origin-Resource-Policy');
            res.setHeader('Content-Type', attachment.content_type || 'application/octet-stream');
            res.setHeader('Content-Length', fileBuffer.length);
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
            res.setHeader('Cache-Control', 'private, max-age=3600');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

            // Send file
            res.send(fileBuffer);
            console.log('File sent successfully');
        } catch (err) {
            console.error('Public download error:', err);
            next(err);
        }
    });

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
