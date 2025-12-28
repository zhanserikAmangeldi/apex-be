import pool, { transaction } from '../pool/index.js';
import { minioService } from '../../storage/minio.service.js';
import { config } from '../../config/index.js';

const SNAPSHOT_SIZE_LIMIT = config.snapshot.sizeLimitMB * 1024 * 1024;

export class SnapshotRepository {
    /**
     * Load snapshot for a document
     * Returns Buffer or null
     */
    async load(documentId) {
        const docResult = await pool.query(
            'SELECT snapshot_storage FROM documents WHERE id = $1',
            [documentId]
        );

        if (!docResult.rows[0]) {
            return null;
        }

        const { snapshot_storage } = docResult.rows[0];

        if (snapshot_storage === 'minio') {
            const path = `${documentId}.bin`;
            try {
                return await minioService.download(config.minio.buckets.snapshots, path);
            } catch (err) {
                console.error(`Failed to load snapshot from MinIO for ${documentId}:`, err);
                return null;
            }
        } else {
            const snapResult = await pool.query(
                'SELECT snapshot FROM crdt_snapshots WHERE document_id = $1',
                [documentId]
            );
            return snapResult.rows[0]?.snapshot || null;
        }
    }

    /**
     * Save snapshot
     * Automatically chooses storage (PostgreSQL or MinIO) based on size
     */
    async save(documentId, snapshotBuffer) {
        const size = snapshotBuffer.length;
        const storage = size > SNAPSHOT_SIZE_LIMIT ? 'minio' : 'pg';

        return await transaction(async (client) => {
            if (storage === 'minio') {
                const path = `${documentId}.bin`;
                await minioService.upload(
                    config.minio.buckets.snapshots,
                    path,
                    snapshotBuffer
                );

                await client.query(
                    `UPDATE documents
                     SET last_snapshot_at = NOW(),
                         snapshot_storage = $2,
                         snapshot_size_bytes = $3
                     WHERE id = $1`,
                    [documentId, 'minio', size]
                );

                await client.query(
                    'DELETE FROM crdt_snapshots WHERE document_id = $1',
                    [documentId]
                );
            } else {
                await client.query(
                    `INSERT INTO crdt_snapshots (document_id, snapshot)
                     VALUES ($1, $2)
                     ON CONFLICT (document_id)
                         DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
                    [documentId, snapshotBuffer]
                );

                await client.query(
                    `UPDATE documents
                     SET last_snapshot_at = NOW(),
                         snapshot_storage = $2,
                         snapshot_size_bytes = $3
                     WHERE id = $1`,
                    [documentId, 'pg', size]
                );
            }

            return { storage, size };
        });
    }

    /**
     * Get snapshot metadata
     */
    async getInfo(documentId) {
        const result = await pool.query(
            `SELECT last_snapshot_at, snapshot_storage, snapshot_size_bytes
             FROM documents
             WHERE id = $1`,
            [documentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Delete snapshot
     */
    async delete(documentId) {
        const info = await this.getInfo(documentId);

        if (!info) return;

        if (info.snapshot_storage === 'minio') {
            try {
                await minioService.delete(config.minio.buckets.snapshots, `${documentId}.bin`);
            } catch (err) {
                console.error(`Failed to delete snapshot from MinIO: ${err.message}`);
            }
        }

        await pool.query('DELETE FROM crdt_snapshots WHERE document_id = $1', [documentId]);

        await pool.query(
            `UPDATE documents
             SET snapshot_storage = NULL, snapshot_size_bytes = 0, last_snapshot_at = NULL
             WHERE id = $1`,
            [documentId]
        );
    }
}

export const snapshotRepository = new SnapshotRepository();
export default snapshotRepository;
