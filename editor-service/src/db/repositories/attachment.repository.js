import pool from '../pool/index.js';

export class AttachmentRepository {
    /**
     * Create a new attachment record
     */
    async create(documentId, filename, minioPath, contentType, sizeBytes, uploadedBy) {
        const result = await pool.query(
            `INSERT INTO attachments (document_id, filename, minio_path, content_type, size_bytes, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [documentId, filename, minioPath, contentType, sizeBytes, uploadedBy]
        );
        return result.rows[0];
    }

    /**
     * Get attachment by ID
     */
    async getById(attachmentId) {
        const result = await pool.query(
            `SELECT * FROM attachments WHERE id = $1`,
            [attachmentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get all attachments for a document
     */
    async getByDocumentId(documentId) {
        const result = await pool.query(
            `SELECT id, document_id, filename, minio_path, content_type, size_bytes, 
                    uploaded_by, created_at
             FROM attachments
             WHERE document_id = $1
             ORDER BY created_at DESC`,
            [documentId]
        );
        return result.rows;
    }

    /**
     * Delete attachment
     */
    async delete(attachmentId) {
        const result = await pool.query(
            `DELETE FROM attachments WHERE id = $1 RETURNING *`,
            [attachmentId]
        );
        return result.rows[0] || null;
    }

    /**
     * Check if user has access to attachment (via document)
     */
    async checkAccess(attachmentId, userId) {
        const result = await pool.query(
            `SELECT 1 FROM attachments a
             JOIN documents d ON d.id = a.document_id
             WHERE a.id = $1 AND d.is_deleted = false
               AND (d.owner_id = $2 OR EXISTS (
                 SELECT 1 FROM document_permissions
                 WHERE document_id = d.id AND user_id = $2
             ))`,
            [attachmentId, userId]
        );
        return result.rows.length > 0;
    }

    /**
     * Get total size of attachments for a document
     */
    async getTotalSize(documentId) {
        const result = await pool.query(
            `SELECT COALESCE(SUM(size_bytes), 0) as total_size
             FROM attachments
             WHERE document_id = $1`,
            [documentId]
        );
        return parseInt(result.rows[0].total_size);
    }
}

export const attachmentRepository = new AttachmentRepository();
export default attachmentRepository;
