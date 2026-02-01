import * as Y from 'yjs';
import pool from '../db/pool.js';
import { loadSnapshot, saveSnapshot } from '../db/snapshots.js';
import { loadAllUpdates, deleteOldUpdates, getUpdateCount } from '../db/updates.js';
import redisClient from '../services/redis.js';
import lockService from '../services/lock.js';
import { snapshotsCreatedTotal, snapshotDuration } from '../services/metrics.js';
import pino from 'pino';

const logger = pino({ name: 'snapshot-worker' });
const SNAPSHOT_THRESHOLD = parseInt(process.env.SNAPSHOT_THRESHOLD_UPDATES || '200');
const WORKER_INTERVAL = parseInt(process.env.SNAPSHOT_WORKER_INTERVAL_MS || '30000');

let isRunning = false;
let workerInterval = null;
let lastFullScan = 0;

export async function createSnapshotForDocument(documentId) {
    const startTime = Date.now();
    logger.info({ documentId }, 'Creating snapshot');

    return await lockService.withLock(`snapshot:${documentId}`, async () => {
        try {
            const currentSnapshot = await loadSnapshot(documentId);
            const updates = await loadAllUpdates(documentId);

            if (updates.length === 0 && !currentSnapshot) {
                logger.info({ documentId }, 'No updates, skipping snapshot');
                return null;
            }

            const ydoc = new Y.Doc();

            if (currentSnapshot) {
                Y.applyUpdate(ydoc, currentSnapshot);
            }

            for (const update of updates) {
                Y.applyUpdate(ydoc, update);
            }

            const newSnapshot = Y.encodeStateAsUpdate(ydoc);
            const { storage, size } = await saveSnapshot(documentId, Buffer.from(newSnapshot));

            logger.info({ documentId, size, storage }, 'Snapshot created');

            const deletedCount = await deleteOldUpdates(documentId, new Date());
            logger.info({ documentId, deletedCount }, 'Old updates deleted');

            snapshotsCreatedTotal.labels(storage).inc();
            const duration = (Date.now() - startTime) / 1000;
            snapshotDuration.labels(documentId, storage).observe(duration);

            return { storage, size, deletedUpdates: deletedCount };

        } catch (err) {
            logger.error({ documentId, err }, 'Failed to create snapshot');
            throw err;
        }
    }, 30000); // 30 second lock timeout
}

async function findDocumentsNeedingSnapshot() {
    const pendingDocs = await redisClient.sMembers('pending_snapshots');
    
    if (pendingDocs.length > 0) {
        await redisClient.del('pending_snapshots');
        
        logger.info({ count: pendingDocs.length }, 'Found pending snapshots in Redis');
        return pendingDocs.slice(0, 10).map(id => ({ id })); // Process max 10 at once
    }

    const now = Date.now();
    if (now - lastFullScan < 3600000) {
        return [];
    }

    lastFullScan = now;
    logger.info('Running full database scan for snapshots');

    const result = await pool.query(
        `SELECT DISTINCT d.id, COUNT(u.id) as update_count
         FROM documents d
         JOIN crdt_updates u ON u.document_id = d.id
         WHERE d.is_deleted = false
         GROUP BY d.id
         HAVING COUNT(u.id) >= $1
         ORDER BY COUNT(u.id) DESC
         LIMIT 10`,
        [SNAPSHOT_THRESHOLD]
    );

    return result.rows;
}

async function runSnapshotWorker() {
    if (isRunning) {
        logger.warn('Snapshot worker already running, skipping');
        return;
    }

    isRunning = true;
    logger.info('Running snapshot worker');

    try {
        const documents = await findDocumentsNeedingSnapshot();

        if (documents.length === 0) {
            logger.info('No documents need snapshots');
            return;
        }

        logger.info({ count: documents.length }, 'Processing snapshots');

        for (const doc of documents) {
            try {
                await createSnapshotForDocument(doc.id);
            } catch (err) {
                logger.error({ documentId: doc.id, err }, 'Failed to create snapshot');
            }
        }

    } catch (err) {
        logger.error({ err }, 'Snapshot worker error');
    } finally {
        isRunning = false;
    }
}

export async function getWorkerStats() {
    const pendingSnapshots = await redisClient.sCard('pending_snapshots');
    
    return {
        isRunning,
        pendingSnapshots,
        threshold: SNAPSHOT_THRESHOLD,
        interval: WORKER_INTERVAL,
        lastFullScan: lastFullScan ? new Date(lastFullScan).toISOString() : null
    };
}

export function startSnapshotWorker() {
    logger.info({ 
        interval: WORKER_INTERVAL, 
        threshold: SNAPSHOT_THRESHOLD 
    }, 'Starting snapshot worker');

    runSnapshotWorker();

    workerInterval = setInterval(runSnapshotWorker, WORKER_INTERVAL);

    return workerInterval;
}

export function stopSnapshotWorker() {
    if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
        logger.info('Snapshot worker stopped');
    }
}

process.on('SIGTERM', stopSnapshotWorker);
process.on('SIGINT', stopSnapshotWorker);

if (import.meta.url === `file://${process.argv[1]}`) {
    startSnapshotWorker();
}