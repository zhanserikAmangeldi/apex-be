import pool from '../pool/index.js';

export class GraphRepository {
    /**
     * Get all documents in vault with their relationships
     */
    async getVaultGraph(vaultId, userId) {
        console.log('GraphRepository: Getting graph for vault', vaultId, 'user', userId);
        console.log('GraphRepository: userId type:', typeof userId, 'value:', userId);
        
        // Get all documents user has access to in the vault
        const documentsResult = await pool.query(
            `SELECT d.id, d.title, d.icon, d.parent_id, d.is_folder,
                    d.created_at, d.updated_at, d.owner_id,
                    CASE
                        WHEN d.owner_id::text = $2::text THEN 'owner'
                        WHEN dp.permission IS NOT NULL THEN dp.permission
                        WHEN vp.permission IS NOT NULL THEN vp.permission
                        ELSE 'none'
                    END as user_permission
             FROM documents d
                      LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id::text = $2::text
                      LEFT JOIN vault_permissions vp ON vp.vault_id = d.vault_id AND vp.user_id::text = $2::text
             WHERE d.vault_id = $1 AND d.is_deleted = false
               AND (d.owner_id::text = $2::text
                    OR EXISTS (SELECT 1 FROM document_permissions WHERE document_id = d.id AND user_id::text = $2::text)
                    OR EXISTS (SELECT 1 FROM vault_permissions WHERE vault_id = d.vault_id AND user_id::text = $2::text)
               )
             ORDER BY d.title ASC`,
            [vaultId, userId]
        );

        console.log('GraphRepository: Found', documentsResult.rows.length, 'documents');
        if (documentsResult.rows.length > 0) {
            console.log('GraphRepository: First document owner_id:', documentsResult.rows[0].owner_id);
        }

        // Get all tags for documents in this vault
        const tagsResult = await pool.query(
            `SELECT dt.document_id, t.id as tag_id, t.name, t.color
             FROM document_tags dt
             INNER JOIN tags t ON t.id = dt.tag_id
             INNER JOIN documents d ON d.id = dt.document_id
             WHERE d.vault_id = $1 AND d.is_deleted = false`,
            [vaultId]
        );

        // Get document links from CRDT snapshots
        const linksResult = await pool.query(
            `SELECT cs.document_id, cs.snapshot
             FROM crdt_snapshots cs
             INNER JOIN documents d ON d.id = cs.document_id
             WHERE d.vault_id = $1 AND d.is_deleted = false`,
            [vaultId]
        );

        return {
            documents: documentsResult.rows,
            tags: tagsResult.rows,
            snapshots: linksResult.rows
        };
    }

    /**
     * Get documents by tag for graph clustering
     */
    async getDocumentsByTags(vaultId) {
        const result = await pool.query(
            `SELECT t.id as tag_id, t.name, t.color,
                    array_agg(dt.document_id) as document_ids
             FROM tags t
             INNER JOIN document_tags dt ON dt.tag_id = t.id
             INNER JOIN documents d ON d.id = dt.document_id
             WHERE t.vault_id = $1 AND d.is_deleted = false
             GROUP BY t.id, t.name, t.color`,
            [vaultId]
        );
        return result.rows;
    }
}

export const graphRepository = new GraphRepository();
