import pool from './pool.js';
import { minioClient, downloadFromMinio, uploadToMinio } from '../storage/minio.js';

const SNAPSHOT_SIZE_LIMIT = parseInt(process.env.SNAPSHOT_SIZE_LIMIT_MB || '5') * 1024 * 1024;

/**
 * Load snapshot for a document
 * Returns Buffer or null
 */
export async function loadSnapshot(documentId) {
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
            return await downloadFromMinio(process.env.MINIO_BUCKET_SNAPSHOTS, path);
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
 * Automatically chooses storage (PG or MinIO) based on size
 */
export async function saveSnapshot(documentId, snapshotBuffer) {
    const size = snapshotBuffer.length;
    const storage = size > SNAPSHOT_SIZE_LIMIT ? 'minio' : 'pg';

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        if (storage === 'minio') {
            const path = `${documentId}.bin`;
            await uploadToMinio(
                process.env.MINIO_BUCKET_SNAPSHOTS,
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

        await client.query('COMMIT');

        return { storage, size };

    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Get snapshot metadata
 */
export async function getSnapshotInfo(documentId) {
    const result = await pool.query(
        `SELECT last_snapshot_at, snapshot_storage, snapshot_size_bytes 
     FROM documents 
     WHERE id = $1`,
        [documentId]
    );

    return result.rows[0] || null;
}