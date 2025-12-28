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
                        ELSE COALESCE(dp.permission, 'none')
                    END as user_permission
             FROM documents d
             LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $2
             WHERE d.id = $1 AND d.is_deleted = false
               AND (d.owner_id = $2 OR EXISTS (
                 SELECT 1 FROM document_permissions 
                 WHERE document_id = $1 AND user_id = $2
               ))`,
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
     * Get documents in vault
     */
    async getByVaultId(vaultId) {
        const result = await pool.query(
            `SELECT id, vault_id, parent_id, title, icon, is_folder, 
                    created_at, updated_at, snapshot_size_bytes
             FROM documents
             WHERE vault_id = $1 AND is_deleted = false
             ORDER BY is_folder DESC, title ASC`,
            [vaultId]
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
            `SELECT 1 FROM documents 
             WHERE id = $1 AND is_deleted = false
               AND (owner_id = $2 OR EXISTS (
                 SELECT 1 FROM document_permissions 
                 WHERE document_id = $1 AND user_id = $2
               ))`,
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
               AND (d.owner_id = $2 OR EXISTS (
                 SELECT 1 FROM document_permissions 
                 WHERE document_id = $1 AND user_id = $2 
                   AND permission IN ('write', 'admin')
               ))`,
            [documentId, userId]
        );
        return result.rows.length > 0;
    }
}

export const documentRepository = new DocumentRepository();
export default documentRepository;
