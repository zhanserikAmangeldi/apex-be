import pool from '../pool/index.js';

export class ConnectionRepository {
    /**
     * Create a connection between two notes
     */
    async create(sourceNoteId, targetNoteId, createdBy, connectionType = 'related', description = null, isInline = false) {
            const result = await pool.query(
                `INSERT INTO notes_connections (source_note_id, target_note_id, created_by, connection_type, description, is_inline)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [sourceNoteId, targetNoteId, createdBy, connectionType, description, isInline]
            );
            return result.rows[0];
        }

    /**
     * Get all connections for a note (both directions)
     */
    async getByNoteId(noteId) {
        const result = await pool.query(
            `SELECT nc.*,
                    CASE WHEN nc.source_note_id = $1 THEN d_target.id ELSE d_source.id END AS connected_note_id,
                    CASE WHEN nc.source_note_id = $1 THEN d_target.title ELSE d_source.title END AS connected_note_title,
                    CASE WHEN nc.source_note_id = $1 THEN d_target.icon ELSE d_source.icon END AS connected_note_icon,
                    CASE WHEN nc.source_note_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction
             FROM notes_connections nc
             INNER JOIN documents d_source ON d_source.id = nc.source_note_id AND d_source.is_deleted = false
             INNER JOIN documents d_target ON d_target.id = nc.target_note_id AND d_target.is_deleted = false
             WHERE nc.source_note_id = $1 OR nc.target_note_id = $1
             ORDER BY nc.created_at DESC`,
            [noteId]
        );
        return result.rows;
    }

    /**
     * Get connections for a vault (for graph view)
     */
    async getByVaultId(vaultId) {
        const result = await pool.query(
            `SELECT nc.id, nc.source_note_id, nc.target_note_id,
                    nc.connection_type, nc.description, nc.created_at
             FROM notes_connections nc
             INNER JOIN documents d_source ON d_source.id = nc.source_note_id
                AND d_source.vault_id = $1 AND d_source.is_deleted = false
             INNER JOIN documents d_target ON d_target.id = nc.target_note_id
                AND d_target.vault_id = $1 AND d_target.is_deleted = false
             ORDER BY nc.created_at DESC`,
            [vaultId]
        );
        return result.rows;
    }

    /**
     * Update a connection
     */
    async update(connectionId, userId, { connectionType, description }) {
            const result = await pool.query(
                `UPDATE notes_connections nc
                 SET connection_type = COALESCE($1, nc.connection_type),
                     description = COALESCE($2, nc.description)
                 WHERE nc.id = $3
                   AND (nc.created_by = $4
                        OR EXISTS (SELECT 1 FROM documents d WHERE d.id IN (nc.source_note_id, nc.target_note_id)
                                   AND (d.owner_id::text = $4::text
                                        OR EXISTS (SELECT 1 FROM document_permissions dp WHERE dp.document_id = d.id AND dp.user_id::text = $4::text))))
                 RETURNING *`,
                [connectionType ?? null, description ?? null, connectionId, userId]
            );
            return result.rows[0] || null;
        }

    /**
     * Delete a connection
     */
    async delete(connectionId, userId) {
            const result = await pool.query(
                `DELETE FROM notes_connections nc
                 WHERE nc.id = $1 AND nc.is_inline = false
                   AND (nc.created_by = $2
                        OR EXISTS (SELECT 1 FROM documents d WHERE d.id IN (nc.source_note_id, nc.target_note_id)
                                   AND (d.owner_id::text = $2::text
                                        OR EXISTS (SELECT 1 FROM document_permissions dp WHERE dp.document_id = d.id AND dp.user_id::text = $2::text))))
                 RETURNING id`,
                [connectionId, userId]
            );
            return result.rows.length > 0;
        }
    /**
     * Delete an inline connection by source and target document IDs
     */
    async deleteInline(sourceNoteId, targetNoteId) {
        const result = await pool.query(
            `DELETE FROM notes_connections
             WHERE source_note_id = $1 AND target_note_id = $2 AND is_inline = true
             RETURNING id`,
            [sourceNoteId, targetNoteId]
        );
        return result.rows.length > 0;
    }


    /**
     * Check if connection exists
     */
    async exists(sourceNoteId, targetNoteId) {
            const result = await pool.query(
                `SELECT 1 FROM notes_connections
                 WHERE source_note_id = $1 AND target_note_id = $2`,
                [sourceNoteId, targetNoteId]
            );
            return result.rows.length > 0;
        }
    /**
     * Get backlinks — documents that link TO the given note via connections
     */
    async getBacklinks(noteId) {
        const result = await pool.query(
            `SELECT d.id, d.title, d.icon, nc.connection_type
             FROM notes_connections nc
             INNER JOIN documents d ON d.id = nc.source_note_id AND d.is_deleted = false
             WHERE nc.target_note_id = $1
             ORDER BY nc.created_at DESC`,
            [noteId]
        );
        return result.rows;
    }
    /**
     * Sync inline document links — ensure connections of type 'inline_link' match
     * the set of targetIds extracted from the document content.
     * Adds missing ones, removes stale ones.
     */
    /**
         * Sync inline document links — ensure inline connections match
         * the set of targetIds extracted from the document content.
         * Only touches connections with is_inline=true.
         * Adds missing ones (as 'references'), removes stale ones.
         */
        async syncInlineLinks(sourceNoteId, targetIds, userId) {
            // Get current inline connections from this source
            const current = await pool.query(
                `SELECT id, target_note_id FROM notes_connections
                 WHERE source_note_id = $1 AND is_inline = true`,
                [sourceNoteId]
            );

            const existingTargets = new Set(current.rows.map(r => r.target_note_id));
            const desiredTargets = new Set(targetIds.filter(id => id !== sourceNoteId));

            // Add missing — default to 'references', user may have already created
            // a connection with a chosen type via the UI (ON CONFLICT keeps existing)
            for (const targetId of desiredTargets) {
                if (!existingTargets.has(targetId)) {
                    try {
                        await pool.query(
                            `INSERT INTO notes_connections (source_note_id, target_note_id, created_by, connection_type, is_inline)
                             VALUES ($1, $2, $3, 'references', true)
                             ON CONFLICT (source_note_id, target_note_id) DO UPDATE SET is_inline = true`,
                            [sourceNoteId, targetId, userId]
                        );
                    } catch (e) {
                        // target document may not exist (FK violation) — skip
                    }
                }
            }

            // Remove stale inline connections (link removed from document)
            const staleIds = current.rows
                .filter(r => !desiredTargets.has(r.target_note_id))
                .map(r => r.id);

            if (staleIds.length > 0) {
                await pool.query(
                    `DELETE FROM notes_connections WHERE id = ANY($1) AND is_inline = true`,
                    [staleIds]
                );
            }
        }


}

export const connectionRepository = new ConnectionRepository();
