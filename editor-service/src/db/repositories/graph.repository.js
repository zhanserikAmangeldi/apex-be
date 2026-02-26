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

        // Also get updates for documents without snapshots
        const updatesResult = await pool.query(
            `SELECT cu.document_id, array_agg(cu.update_data ORDER BY cu.created_at) as updates
             FROM crdt_updates cu
             INNER JOIN documents d ON d.id = cu.document_id
             WHERE d.vault_id = $1 AND d.is_deleted = false
               AND cu.document_id NOT IN (
                   SELECT cs.document_id FROM crdt_snapshots cs
                   INNER JOIN documents d2 ON d2.id = cs.document_id
                   WHERE d2.vault_id = $1
               )
             GROUP BY cu.document_id`,
            [vaultId]
        );

        return {
            documents: documentsResult.rows,
            tags: tagsResult.rows,
            snapshots: linksResult.rows,
            updates: updatesResult.rows
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
    /**
     * Get data needed to compute backlinks for a document
     */
    async getBacklinksData(documentId, userId) {
        // Get the document and its vault
        const docResult = await pool.query(
            `SELECT id, title, vault_id FROM documents
             WHERE id = $1 AND is_deleted = false
               AND (owner_id::text = $2::text
                    OR EXISTS (SELECT 1 FROM document_permissions WHERE document_id = $1 AND user_id::text = $2::text)
                    OR EXISTS (SELECT 1 FROM vault_permissions vp
                               INNER JOIN documents d2 ON d2.vault_id = vp.vault_id
                               WHERE d2.id = $1 AND vp.user_id::text = $2::text))`,
            [documentId, userId]
        );

        if (docResult.rows.length === 0) {
            return { document: null, vaultDocuments: [], snapshots: [], updates: [] };
        }

        const doc = docResult.rows[0];
        const vaultId = doc.vault_id;

        // Get all documents in the same vault
        const vaultDocsResult = await pool.query(
            `SELECT id, title, icon FROM documents
             WHERE vault_id = $1 AND is_deleted = false AND is_folder = false`,
            [vaultId]
        );

        // Get snapshots
        const snapshotsResult = await pool.query(
            `SELECT cs.document_id, cs.snapshot
             FROM crdt_snapshots cs
             INNER JOIN documents d ON d.id = cs.document_id
             WHERE d.vault_id = $1 AND d.is_deleted = false`,
            [vaultId]
        );

        // Get updates for docs without snapshots
        const updatesResult = await pool.query(
            `SELECT cu.document_id, array_agg(cu.update_data ORDER BY cu.created_at) as updates
             FROM crdt_updates cu
             INNER JOIN documents d ON d.id = cu.document_id
             WHERE d.vault_id = $1 AND d.is_deleted = false
               AND cu.document_id NOT IN (
                   SELECT cs.document_id FROM crdt_snapshots cs
                   INNER JOIN documents d2 ON d2.id = cs.document_id
                   WHERE d2.vault_id = $1
               )
             GROUP BY cu.document_id`,
            [vaultId]
        );

        return {
            document: doc,
            vaultDocuments: vaultDocsResult.rows,
            snapshots: snapshotsResult.rows,
            updates: updatesResult.rows
        };
    }
}

export const graphRepository = new GraphRepository();
