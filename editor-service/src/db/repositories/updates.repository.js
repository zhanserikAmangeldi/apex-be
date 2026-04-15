import pool from '../pool/index.js';

export class UpdatesRepository {
    async save(documentId, updateBuffer) {
        await pool.query(
            'INSERT INTO crdt_updates (document_id, update_data) VALUES ($1, $2)',
            [documentId, updateBuffer]
        );
    }

    async loadSince(documentId, since = null) {
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

    async loadAll(documentId) {
        return this.loadSince(documentId, null);
    }

    async getCount(documentId) {
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM crdt_updates WHERE document_id = $1',
            [documentId]
        );
        return parseInt(result.rows[0].count);
    }

    async deleteOldUpdates(documentId, beforeTimestamp) {
        const result = await pool.query(
            'DELETE FROM crdt_updates WHERE document_id = $1 AND created_at < $2',
            [documentId, beforeTimestamp]
        );
        return result.rowCount;
    }

    async deleteAll(documentId) {
        const result = await pool.query(
            'DELETE FROM crdt_updates WHERE document_id = $1',
            [documentId]
        );
        return result.rowCount;
    }

    async getTimeRange(documentId) {
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

    async getTotalSize(documentId) {
        const result = await pool.query(
            `SELECT COALESCE(SUM(LENGTH(update_data)), 0) as total_size
             FROM crdt_updates
             WHERE document_id = $1`,
            [documentId]
        );
        return parseInt(result.rows[0].total_size);
    }
}

export const updatesRepository = new UpdatesRepository();
export default updatesRepository;
