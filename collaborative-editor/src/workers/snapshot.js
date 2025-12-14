import * as Y from 'yjs';
import pool from '../db/pool.js';
import { loadSnapshot, saveSnapshot } from '../db/snapshots.js';
import { loadAllUpdates, deleteOldUpdates, getUpdateCount } from '../db/updates.js';

const SNAPSHOT_THRESHOLD = parseInt(process.env.SNAPSHOT_THRESHOLD_UPDATES || '200');
const WORKER_INTERVAL = parseInt(process.env.SNAPSHOT_WORKER_INTERVAL_MS || '30000');

/**
 * Create snapshot for a specific document
 */
export async function createSnapshotForDocument(documentId) {
    console.log(`📸 Creating snapshot for document: ${documentId}`);

    try {
        const currentSnapshot = await loadSnapshot(documentId);

        const updates = await loadAllUpdates(documentId);

        if (updates.length === 0 && !currentSnapshot) {
            console.log(`⏭️  No updates for ${documentId}, skipping snapshot`);
            return;
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

        console.log(`Snapshot created: ${documentId} (${size} bytes, storage: ${storage})`);

        const deletedCount = await deleteOldUpdates(documentId, new Date());
        console.log(`Deleted ${deletedCount} old updates for ${documentId}`);

        return { storage, size, deletedUpdates: deletedCount };

    } catch (err) {
        console.error(`Failed to create snapshot for ${documentId}:`, err);
        throw err;
    }
}

/**
 * Find documents that need snapshots
 */
async function findDocumentsNeedingSnapshot() {
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

/**
 * Run snapshot worker (process documents needing snapshots)
 */
async function runSnapshotWorker() {
    console.log('🔄 Running snapshot worker...');

    try {
        const documents = await findDocumentsNeedingSnapshot();

        if (documents.length === 0) {
            console.log('✓ No documents need snapshots');
            return;
        }

        console.log(`Found ${documents.length} documents needing snapshots`);

        for (const doc of documents) {
            try {
                await createSnapshotForDocument(doc.id);
            } catch (err) {
                console.error(`Failed to snapshot ${doc.id}:`, err);
            }
        }

    } catch (err) {
        console.error('Snapshot worker error:', err);
    }
}

/**
 * Start snapshot worker as interval
 */
export function startSnapshotWorker() {
    console.log(`Snapshot worker started (interval: ${WORKER_INTERVAL}ms, threshold: ${SNAPSHOT_THRESHOLD} updates)`);

    runSnapshotWorker();

    const interval = setInterval(runSnapshotWorker, WORKER_INTERVAL);

    process.on('SIGTERM', () => {
        clearInterval(interval);
        console.log('Snapshot worker stopped');
    });

    return interval;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    startSnapshotWorker();
}