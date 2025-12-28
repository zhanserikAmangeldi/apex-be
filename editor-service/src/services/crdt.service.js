import * as Y from 'yjs';
import { snapshotRepository, updatesRepository } from '../db/repositories/index.js';
import { config } from '../config/index.js';

class CRDTService {
    /**
     * Merge snapshot and updates into single state
     */
    mergeUpdates(snapshot, updates) {
        const ydoc = new Y.Doc();

        if (snapshot) {
            Y.applyUpdate(ydoc, snapshot);
        }

        for (const update of updates) {
            Y.applyUpdate(ydoc, update);
        }

        return Y.encodeStateAsUpdate(ydoc);
    }

    /**
     * Load full document state (snapshot + updates)
     */
    async loadDocumentState(documentId, snapshotTime = null) {
        const snapshot = await snapshotRepository.load(documentId);
        const updates = await updatesRepository.loadSince(documentId, snapshotTime);

        console.log(`Loaded: snapshot=${!!snapshot}, updates=${updates.length}`);

        return this.mergeUpdates(snapshot, updates);
    }

    /**
     * Save update for document
     */
    async saveUpdate(documentId, updateData) {
        await updatesRepository.save(documentId, Buffer.from(updateData));
    }

    /**
     * Create snapshot for document
     */
    async createSnapshot(documentId) {
        console.log(`Creating snapshot for document: ${documentId}`);

        try {
            const currentSnapshot = await snapshotRepository.load(documentId);
            const updates = await updatesRepository.loadAll(documentId);

            if (updates.length === 0 && !currentSnapshot) {
                console.log(`No updates for ${documentId}, skipping snapshot`);
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
            const { storage, size } = await snapshotRepository.save(
                documentId,
                Buffer.from(newSnapshot)
            );

            console.log(`Snapshot created: ${documentId} (${size} bytes, storage: ${storage})`);

            // Delete old updates
            const deletedCount = await updatesRepository.deleteOldUpdates(documentId, new Date());
            console.log(`🗑️ Deleted ${deletedCount} old updates for ${documentId}`);

            return { storage, size, deletedUpdates: deletedCount };
        } catch (err) {
            console.error(`Failed to create snapshot for ${documentId}:`, err);
            throw err;
        }
    }

    /**
     * Check if document needs snapshot
     */
    async needsSnapshot(documentId) {
        const updateCount = await updatesRepository.getCount(documentId);
        return updateCount >= config.snapshot.threshold;
    }

    /**
     * Get update count for document
     */
    async getUpdateCount(documentId) {
        return await updatesRepository.getCount(documentId);
    }

    /**
     * Get document statistics
     */
    async getDocumentStats(documentId) {
        const [snapshotInfo, updateTimeRange, totalUpdateSize] = await Promise.all([
            snapshotRepository.getInfo(documentId),
            updatesRepository.getTimeRange(documentId),
            updatesRepository.getTotalSize(documentId),
        ]);

        return {
            snapshotStorage: snapshotInfo?.snapshot_storage || null,
            snapshotSize: snapshotInfo?.snapshot_size_bytes || 0,
            lastSnapshotAt: snapshotInfo?.last_snapshot_at || null,
            updateCount: parseInt(updateTimeRange?.count || 0),
            oldestUpdate: updateTimeRange?.oldest || null,
            newestUpdate: updateTimeRange?.newest || null,
            totalUpdateSize,
        };
    }
}

export const crdtService = new CRDTService();
export default crdtService;
