import pool from '../pool/index.js';

export class DocumentRepository {
    /**
     * Create a new document
     */
    async create(ownerId, title, vaultId = null, parentId = null, isFolder = false) {
        const result = await pool.query(
            `INSERT INTO documents (owner_id, vault_id, parent_id, title, is_folder)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [ownerId, vaultId, parentId, title || 'Untitled Document', isFolder]
        );
        return result.rows[0];
    }

    /**
     * Get document by ID
     */
    async getById(documentId) {
        const result = await pool.query(
            `SELECT * FROM documents WHERE id = $1 AND is_deleted = false`,
            [documentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get document with user permission
     */
    async getByIdWithPermission(documentId, userId) {
        const result = await pool.query(
            `SELECT d.*,
                    CASE
                        WHEN d.owner_id = $2 THEN 'owner'
                        WHEN dp.permission IS NOT NULL THEN dp.permission
                        WHEN d.vault_id IS NOT NULL AND vp.permission IS NOT NULL THEN vp.permission
                        ELSE 'none'
                    END as user_permission
             FROM documents d
                      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $2
                      LEFT JOIN vault_permissions vp ON vp.vault_id = d.vault_id AND vp.user_id = $2
             WHERE d.id = $1 AND d.is_deleted = false
               AND (d.owner_id = $2 
                    OR EXISTS (SELECT 1 FROM document_permissions WHERE document_id = $1 AND user_id = $2)
                    OR EXISTS (SELECT 1 FROM vault_permissions WHERE vault_id = d.vault_id AND user_id = $2)
               )`,
            [documentId, userId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get all documents for a user
     */
    async getAllByUserId(userId) {
        const result = await pool.query(
            `SELECT d.id, d.title, d.created_at, d.updated_at,
                    d.snapshot_size_bytes, d.snapshot_storage,
                    d.last_snapshot_at, d.is_folder, d.vault_id, d.parent_id
             FROM documents d
             WHERE d.owner_id = $1 AND d.is_deleted = false
             ORDER BY d.updated_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Get documents shared with user
     */
    async getSharedWithUser(userId) {
        const result = await pool.query(
            `SELECT d.id, d.title, d.created_at, d.updated_at,
                    d.snapshot_size_bytes, d.snapshot_storage,
                    d.last_snapshot_at, d.is_folder, d.vault_id, d.parent_id,
                    d.owner_id, dp.permission as user_permission
             FROM documents d
             INNER JOIN document_permissions dp ON dp.document_id = d.id
             WHERE dp.user_id = $1 AND d.is_deleted = false
             ORDER BY d.updated_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Get documents in vault with user permissions
     */
    async getByVaultId(vaultId, userId) {
        const result = await pool.query(
            `SELECT d.id, d.vault_id, d.parent_id, d.owner_id, d.title, d.icon, d.is_folder,
                    d.created_at, d.updated_at, d.snapshot_size_bytes, d.snapshot_storage, d.last_snapshot_at,
                    CASE
                        WHEN d.owner_id = $2 THEN 'owner'
                        WHEN dp.permission IS NOT NULL THEN dp.permission
                        WHEN vp.permission IS NOT NULL THEN vp.permission
                        ELSE 'none'
                    END as user_permission
             FROM documents d
                      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $2
                      LEFT JOIN vault_permissions vp ON vp.vault_id = d.vault_id AND vp.user_id = $2
             WHERE d.vault_id = $1 AND d.is_deleted = false
             ORDER BY d.is_folder DESC, d.title ASC`,
            [vaultId, userId]
        );
        return result.rows;
    }

    /**
     * Update document title
     */
    async updateTitle(documentId, ownerId, title) {
        const result = await pool.query(
            `UPDATE documents
             SET title = COALESCE($1, title), updated_at = NOW()
             WHERE id = $2 AND owner_id = $3
             RETURNING *`,
            [title, documentId, ownerId]
        );
        return result.rows[0] || null;
    }

    /**
     * Update document metadata
     */
    async update(documentId, updates) {
        const { title, icon, parentId } = updates;
        const result = await pool.query(
            `UPDATE documents
             SET title = COALESCE($1, title),
                 icon = COALESCE($2, icon),
                 parent_id = COALESCE($3, parent_id),
                 updated_at = NOW()
             WHERE id = $4 AND is_deleted = false
             RETURNING *`,
            [title, icon, parentId, documentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Move document to different parent
     */
    async move(documentId, parentId) {
        const result = await pool.query(
            `UPDATE documents
             SET parent_id = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [parentId, documentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Soft delete document
     */
    async delete(documentId, ownerId) {
        const result = await pool.query(
            `UPDATE documents
             SET is_deleted = true, updated_at = NOW()
             WHERE id = $1 AND owner_id = $2
             RETURNING id`,
            [documentId, ownerId]
        );
        return result.rows[0] || null;
    }

    /**
     * Update snapshot info
     */
    async updateSnapshotInfo(documentId, storage, sizeBytes) {
        await pool.query(
            `UPDATE documents
             SET last_snapshot_at = NOW(),
                 snapshot_storage = $2,
                 snapshot_size_bytes = $3
             WHERE id = $1`,
            [documentId, storage, sizeBytes]
        );
    }

    /**
     * Update last activity timestamp
     */
    async touch(documentId) {
        await pool.query(
            'UPDATE documents SET updated_at = NOW() WHERE id = $1',
            [documentId]
        );
    }

    /**
     * Check if document exists and is active
     */
    async exists(documentId) {
        const result = await pool.query(
            'SELECT 1 FROM documents WHERE id = $1 AND is_deleted = false',
            [documentId]
        );
        return result.rows.length > 0;
    }

    /**
     * Check user access to document
     */
    async checkAccess(documentId, userId) {
        const result = await pool.query(
            `SELECT 1 FROM documents d
             WHERE d.id = $1 AND d.is_deleted = false
               AND (d.owner_id = $2 
                    OR EXISTS (SELECT 1 FROM document_permissions WHERE document_id = $1 AND user_id = $2)
                    OR EXISTS (SELECT 1 FROM vault_permissions WHERE vault_id = d.vault_id AND user_id = $2)
               )`,
            [documentId, userId]
        );
        return result.rows.length > 0;
    }

    /**
     * Check write access
     */
    async checkWriteAccess(documentId, userId) {
        const result = await pool.query(
            `SELECT 1 FROM documents d
             WHERE d.id = $1 AND d.is_deleted = false
               AND (d.owner_id = $2 
                    OR EXISTS (
                        SELECT 1 FROM document_permissions
                        WHERE document_id = $1 AND user_id = $2
                        AND permission IN ('write', 'admin')
                    )
                    OR EXISTS (
                        SELECT 1 FROM vault_permissions
                        WHERE vault_id = d.vault_id AND user_id = $2
                        AND permission IN ('write', 'admin')
                    )
               )`,
            [documentId, userId]
        );
        return result.rows.length > 0;
    }

    /**
     * Share document with user
     */
    async share(documentId, userId, permission) {
        const result = await pool.query(
            `INSERT INTO document_permissions (document_id, user_id, permission)
             VALUES ($1, $2, $3)
             ON CONFLICT (document_id, user_id)
                 DO UPDATE SET permission = EXCLUDED.permission
             RETURNING *`,
            [documentId, userId, permission]
        );
        return result.rows[0];
    }

    /**
     * Remove user access from document
     */
    async unshare(documentId, userId) {
        const result = await pool.query(
            'DELETE FROM document_permissions WHERE document_id = $1 AND user_id = $2 RETURNING id',
            [documentId, userId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get all collaborators of a document
     */
    async getCollaborators(documentId) {
        const result = await pool.query(
            `SELECT dp.user_id, dp.permission, dp.created_at
             FROM document_permissions dp
             WHERE dp.document_id = $1
             ORDER BY dp.created_at DESC`,
            [documentId]
        );
        return result.rows;
    }

    /**
     * Update user permission for document
     */
    async updatePermission(documentId, userId, permission) {
        const result = await pool.query(
            `UPDATE document_permissions
             SET permission = $3
             WHERE document_id = $1 AND user_id = $2
             RETURNING *`,
            [documentId, userId, permission]
        );
        return result.rows[0] || null;
    }

    /**
     * Check if user is document owner
     */
    async isOwner(documentId, userId) {
        const result = await pool.query(
            `SELECT 1 FROM documents WHERE id = $1 AND owner_id = $2`,
            [documentId, userId]
        );
        return result.rows.length > 0;
    }

    /**
     * Search documents by title
     */
    async searchByTitle(userId, query, vaultId = null, limit = 10) {
        const searchPattern = `%${query}%`;
        
        let sql = `
            SELECT d.id, d.vault_id, d.title, d.icon, d.is_folder,
                   CASE
                       WHEN d.owner_id = $1 THEN 'owner'
                       WHEN dp.permission IS NOT NULL THEN dp.permission
                       WHEN d.vault_id IS NOT NULL AND vp.permission IS NOT NULL THEN vp.permission
                       ELSE 'none'
                   END as user_permission
            FROM documents d
            LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $1
            LEFT JOIN vault_permissions vp ON vp.vault_id = d.vault_id AND vp.user_id = $1
            WHERE d.is_deleted = false
              AND d.is_folder = false
              AND d.title ILIKE $2
              AND (d.owner_id = $1 
                   OR EXISTS (SELECT 1 FROM document_permissions WHERE document_id = d.id AND user_id = $1)
                   OR EXISTS (SELECT 1 FROM vault_permissions WHERE vault_id = d.vault_id AND user_id = $1)
              )
        `;
        
        const params = [userId, searchPattern];
        
        if (vaultId) {
            sql += ` AND d.vault_id = $${params.length + 1}`;
            params.push(vaultId);
        }
        
        sql += ` ORDER BY d.title ASC LIMIT $${params.length + 1}`;
        params.push(limit);
        
        const result = await pool.query(sql, params);
        return result.rows;
    }
}

export const documentRepository = new DocumentRepository();
export default documentRepository;
