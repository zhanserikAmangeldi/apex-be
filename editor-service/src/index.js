import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { config, isDevelopment } from './config/index.js';
import { minioService } from './storage/minio.service.js';
import { createHocuspocusServer } from './services/hocuspocus.server.js';
import { snapshotWorker } from './workers/snapshot.worker.js';

// Routes
import documentsRoutes from './api/routes/documents.routes.js';
import vaultsRoutes from './api/routes/vaults.routes.js';

// Middleware
import { errorHandler, notFoundHandler } from './api/middleware/index.js';
import {testConnection} from "./db/pool/index.js";

async function main() {
    console.log('🚀 Starting Editor Service...');
    console.log(`📦 Environment: ${config.nodeEnv}`);

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
        console.error('❌ Failed to connect to database');
        process.exit(1);
    }

    // Initialize MinIO buckets
    try {
        await minioService.initializeBuckets();
        console.log('✅ MinIO initialized');
    } catch (err) {
        console.error('❌ Failed to initialize MinIO:', err);
        process.exit(1);
    }

    // Create Express app
    const app = express();

    // Middleware
    app.use(helmet());
    app.use(cors({
        origin: isDevelopment() ? '*' : process.env.ALLOWED_ORIGINS?.split(','),
        credentials: true,
    }));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));
    
    if (isDevelopment()) {
        app.use(morgan('dev'));
    } else {
        app.use(morgan('combined'));
    }

    // Health check
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

    // API Routes
    app.use('/api/v1/documents', documentsRoutes);
    app.use('/api/v1/vaults', vaultsRoutes);

    // Worker stats endpoint
    app.get('/api/v1/stats/worker', async (req, res) => {
        const stats = await snapshotWorker.getStats();
        res.json(stats);
    });

    // Error handling
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Start HTTP server
    const httpServer = app.listen(config.port, () => {
        console.log(`✅ HTTP server running on port ${config.port}`);
    });

    // Start Hocuspocus WebSocket server
    const hocuspocusServer = createHocuspocusServer();
    await hocuspocusServer.listen();
    console.log(`✅ Hocuspocus WebSocket server running on port ${config.hocuspocusPort}`);

    // Start snapshot worker
    snapshotWorker.start();

    // Graceful shutdown
    const shutdown = async (signal) => {
        console.log(`\n${signal} received. Shutting down gracefully...`);

        // Stop accepting new connections
        httpServer.close(() => {
            console.log('✅ HTTP server closed');
        });

        // Stop worker
        snapshotWorker.stop();

        // Stop Hocuspocus
        await hocuspocusServer.destroy();
        console.log('✅ Hocuspocus server closed');

        // Give time for cleanup
        setTimeout(() => {
            console.log('👋 Goodbye!');
            process.exit(0);
        }, 1000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (err) => {
        console.error('❌ Uncaught Exception:', err);
        shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

main().catch((err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});
