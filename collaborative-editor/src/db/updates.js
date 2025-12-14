import pool from './pool.js';

/**
 * Save a new update
 */
export async function saveUpdate(documentId, updateBuffer) {
    await pool.query(
        'INSERT INTO crdt_updates (document_id, update_data) VALUES ($1, $2)',
        [documentId, updateBuffer]
    );
}

/**
 * Load all updates since a specific timestamp
 * Used after loading snapshot to get recent changes
 */
export async function loadUpdatesSince(documentId, since = null) {
    let query = `
    SELECT update_data, created_at 
    FROM crdt_updates 
    WHERE document_id = $1
  `;

    const params = [documentId];

    if (since) {
        query += ' AND created_at > $2';
        params.push(since);
    }

    query += ' ORDER BY created_at ASC';

    const result = await pool.query(query, params);
    return result.rows.map(row => row.update_data);
}

/**
 * Load all updates for a document
 */
export async function loadAllUpdates(documentId) {
    return loadUpdatesSince(documentId, null);
}

/**
 * Get count of updates for a document
 */
export async function getUpdateCount(documentId) {
    const result = await pool.query(
        'SELECT COUNT(*) as count FROM crdt_updates WHERE document_id = $1',
        [documentId]
    );
    return parseInt(result.rows[0].count);
}

/**
 * Delete old updates (called after snapshot creation)
 * Keeps updates newer than the snapshot timestamp
 */
export async function deleteOldUpdates(documentId, beforeTimestamp) {
    const result = await pool.query(
        'DELETE FROM crdt_updates WHERE document_id = $1 AND created_at < $2',
        [documentId, beforeTimestamp]
    );
    return result.rowCount;
}

/**
 * Delete all updates for a document (cleanup)
 */
export async function deleteAllUpdates(documentId) {
    const result = await pool.query(
        'DELETE FROM crdt_updates WHERE document_id = $1',
        [documentId]
    );
    return result.rowCount;
}

/**
 * Get oldest and newest update timestamps
 */
export async function getUpdateTimeRange(documentId) {
    const result = await pool.query(
        `SELECT 
       MIN(created_at) as oldest,
       MAX(created_at) as newest,
       COUNT(*) as count
     FROM crdt_updates 
     WHERE document_id = $1`,
        [documentId]
    );

    return result.rows[0];
}