import { config } from '../config/index.js';
import { crdtService } from '../services/crdt.service.js';
import { updatesRepository } from '../db/repositories/index.js';
import pool from '../db/pool/index.js';

class SnapshotWorker {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
    }

    /**
     * Start the snapshot worker
     */
    start() {
        if (this.isRunning) {
            console.log('⚠️ Snapshot worker already running');
            return;
        }

        this.isRunning = true;
        console.log(`🔄 Snapshot worker started (interval: ${config.snapshot.workerInterval}ms)`);

        // Run immediately on start
        this.processSnapshots();

        // Then run on interval
        this.intervalId = setInterval(() => {
            this.processSnapshots();
        }, config.snapshot.workerInterval);
    }

    /**
     * Stop the snapshot worker
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        console.log('🛑 Snapshot worker stopped');
    }

    /**
     * Process documents that need snapshots
     */
    async processSnapshots() {
        try {
            // Find documents with updates exceeding threshold
            const documentsNeedingSnapshot = await this.findDocumentsNeedingSnapshot();

            if (documentsNeedingSnapshot.length === 0) {
                return;
            }

            console.log(`📸 Processing ${documentsNeedingSnapshot.length} documents for snapshot`);

            for (const doc of documentsNeedingSnapshot) {
                try {
                    await crdtService.createSnapshot(doc.document_id);
                } catch (err) {
                    console.error(`❌ Failed to create snapshot for ${doc.document_id}:`, err);
                }
            }
        } catch (err) {
            console.error('❌ Snapshot worker error:', err);
        }
    }

    /**
     * Find documents that have exceeded update threshold
     */
    async findDocumentsNeedingSnapshot() {
        const result = await pool.query(`
            SELECT document_id, COUNT(*) as update_count
            FROM crdt_updates
            GROUP BY document_id
            HAVING COUNT(*) >= $1
            ORDER BY update_count DESC
            LIMIT 10
        `, [config.snapshot.threshold]);

        return result.rows;
    }

    /**
     * Cleanup old expired sessions (run daily)
     */
    async cleanupExpiredData() {
        try {
            // Delete very old updates (safety measure)
            const oldUpdatesResult = await pool.query(`
                DELETE FROM crdt_updates
                WHERE created_at < NOW() - INTERVAL '30 days'
                  AND document_id IN (
                    SELECT d.id FROM documents d
                    WHERE d.last_snapshot_at IS NOT NULL
                      AND d.last_snapshot_at > crdt_updates.created_at
                  )
            `);

            if (oldUpdatesResult.rowCount > 0) {
                console.log(`🗑️ Cleaned up ${oldUpdatesResult.rowCount} old updates`);
            }

            // Delete updates for deleted documents
            const deletedDocsResult = await pool.query(`
                DELETE FROM crdt_updates
                WHERE document_id IN (
                    SELECT id FROM documents WHERE is_deleted = true
                )
            `);

            if (deletedDocsResult.rowCount > 0) {
                console.log(`🗑️ Cleaned up ${deletedDocsResult.rowCount} updates for deleted documents`);
            }
        } catch (err) {
            console.error('❌ Cleanup error:', err);
        }
    }

    /**
     * Get worker statistics
     */
    async getStats() {
        const result = await pool.query(`
            SELECT 
                COUNT(DISTINCT document_id) as documents_with_updates,
                COUNT(*) as total_updates,
                SUM(LENGTH(update_data)) as total_size_bytes
            FROM crdt_updates
        `);

        const pendingResult = await pool.query(`
            SELECT COUNT(*) as pending_snapshots
            FROM (
                SELECT document_id
                FROM crdt_updates
                GROUP BY document_id
                HAVING COUNT(*) >= $1
            ) sub
        `, [config.snapshot.threshold]);

        return {
            isRunning: this.isRunning,
            interval: config.snapshot.workerInterval,
            threshold: config.snapshot.threshold,
            documentsWithUpdates: parseInt(result.rows[0].documents_with_updates),
            totalUpdates: parseInt(result.rows[0].total_updates),
            totalSizeBytes: parseInt(result.rows[0].total_size_bytes || 0),
            pendingSnapshots: parseInt(pendingResult.rows[0].pending_snapshots),
        };
    }
}

export const snapshotWorker = new SnapshotWorker();
export default snapshotWorker;
