import promClient from 'prom-client';

const register = new promClient.Registry();

promClient.collectDefaultMetrics({ register });

export const httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [register],
});

export const wsConnectionsActive = new promClient.Gauge({
    name: 'ws_connections_active',
    help: 'Number of active WebSocket connections',
    labelNames: ['document_id'],
    registers: [register],
});

export const crdtUpdatesTotal = new promClient.Counter({
    name: 'crdt_updates_total',
    help: 'Total number of CRDT updates processed',
    labelNames: ['document_id'],
    registers: [register],
});

export const snapshotsCreatedTotal = new promClient.Counter({
    name: 'snapshots_created_total',
    help: 'Total number of snapshots created',
    labelNames: ['storage'],
    registers: [register],
});

export const snapshotDuration = new promClient.Histogram({
    name: 'snapshot_creation_duration_seconds',
    help: 'Duration of snapshot creation in seconds',
    labelNames: ['document_id', 'storage'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [register],
});

export const lockAcquisitionDuration = new promClient.Histogram({
    name: 'lock_acquisition_duration_seconds',
    help: 'Duration of lock acquisition attempts',
    labelNames: ['key', 'success'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [register],
});

export const authValidationDuration = new promClient.Histogram({
    name: 'auth_validation_duration_seconds',
    help: 'Duration of auth token validation',
    labelNames: ['cached'],
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [register],
});

export function metricsMiddleware() {
    return (req, res, next) => {
        const start = Date.now();
        
        res.on('finish', () => {
            const duration = (Date.now() - start) / 1000;
            httpRequestDuration
                .labels(req.method, req.route?.path || req.path, res.statusCode)
                .observe(duration);
        });
        
        next();
    };
}

export async function getMetrics() {
    return await register.metrics();
}

export { register };
