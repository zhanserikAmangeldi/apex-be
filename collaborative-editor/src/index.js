import dotenv from 'dotenv';
import { createHocuspocusServer } from './hocuspocus.js';
import { startApiServer } from './api.js';
import { initializeBuckets } from './storage/minio.js';
import { startSnapshotWorker } from './workers/snapshot.js';
import pool from './db/pool.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000');
const HOCUSPOCUS_PORT = parseInt(process.env.HOCUSPOCUS_PORT || '1234');

async function main() {
    console.log('🚀 Starting Collaborative Editor Backend...\n');

    try {
        console.log('📦 Initializing MinIO buckets...');
        await initializeBuckets();
        console.log('');

        console.log('Starting Hocuspocus WebSocket server...');
        const hocuspocusServer = createHocuspocusServer();
        await hocuspocusServer.listen();
        console.log(`Hocuspocus listening on port ${HOCUSPOCUS_PORT}\n`);

        console.log('Starting REST API server...');
        startApiServer(PORT);
        console.log('');

        console.log('Starting snapshot worker...');
        startSnapshotWorker();
        console.log('');

        console.log('All services started successfully!\n');
        console.log(`REST API:       http://localhost:${PORT}`);
        console.log(`WebSocket:      ws://localhost:${HOCUSPOCUS_PORT}`);
        console.log(`Database:       ${process.env.DB_HOST}:${process.env.DB_PORT}`);
        console.log(`MinIO:          ${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}`);

        process.on('SIGTERM', async () => {
            console.log('\nShutting down gracefully...');
            await hocuspocusServer.destroy();
            await pool.end();
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            console.log('\nShutting down gracefully...');
            await hocuspocusServer.destroy();
            await pool.end();
            process.exit(0);
        });

    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

main();