import dotenv from 'dotenv';

dotenv.config();

export const config = {
    // Server
    port: parseInt(process.env.PORT || '3000'),
    hocuspocusPort: parseInt(process.env.HOCUSPOCUS_PORT || '1234'),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        name: process.env.DB_NAME || 'editor',
        user: process.env.DB_USER || 'editor',
        password: process.env.DB_PASSWORD || 'editor',
        maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
        idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
    },

    // MinIO
    minio: {
        endpoint: process.env.MINIO_ENDPOINT || 'localhost',
        port: parseInt(process.env.MINIO_PORT || '9000'),
        useSSL: process.env.MINIO_USE_SSL === 'true',
        accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
        secretKey: process.env.MINIO_SECRET_KEY || 'admin123',
        buckets: {
            snapshots: process.env.MINIO_BUCKET_SNAPSHOTS || 'crdt-snapshots',
            attachments: process.env.MINIO_BUCKET_ATTACHMENTS || 'attachments',
        },
    },

    // Auth Service
    auth: {
        serviceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:8080',
        tokenCacheTTL: parseInt(process.env.AUTH_TOKEN_CACHE_TTL || '60'),
    },

    // Snapshot Worker
    snapshot: {
        threshold: parseInt(process.env.SNAPSHOT_THRESHOLD_UPDATES || '200'),
        workerInterval: parseInt(process.env.SNAPSHOT_WORKER_INTERVAL_MS || '30000'),
        sizeLimitMB: parseInt(process.env.SNAPSHOT_SIZE_LIMIT_MB || '5'),
    },

    // Hocuspocus
    hocuspocus: {
        timeout: parseInt(process.env.HOCUSPOCUS_TIMEOUT || '30000'),
        debounce: parseInt(process.env.HOCUSPOCUS_DEBOUNCE || '2000'),
        maxDebounce: parseInt(process.env.HOCUSPOCUS_MAX_DEBOUNCE || '10000'),
    },
};

export const isDevelopment = () => config.nodeEnv === 'development';
export const isProduction = () => config.nodeEnv === 'production';

export default config;
