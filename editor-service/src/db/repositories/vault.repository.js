import pool from '../pool/index.js';

export class VaultRepository {
    /**
     * Create a new vault
     */
    async create(ownerId, name, description = null, icon = '📁', color = '#6366f1') {
        const result = await pool.query(
            `INSERT INTO vaults (owner_id, name, description, icon, color)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [ownerId, name.trim(), description, icon, color]
        );
        return result.rows[0];
    }

    /**
     * Get vault by ID with user permission
     */
    async getByIdWithPermission(vaultId, userId) {
        const result = await pool.query(
            `SELECT v.*,
                    CASE
                        WHEN v.owner_id = $2 THEN 'owner'
                        ELSE COALESCE(vp.permission, 'none')
                        END as user_permission
             FROM vaults v
                      LEFT JOIN vault_permissions vp ON vp.vault_id = v.id AND vp.user_id = $2
             WHERE v.id = $1 AND v.is_deleted = false
               AND (v.owner_id = $2 OR EXISTS (
                 SELECT 1 FROM vault_permissions
                 WHERE vault_id = $1 AND user_id = $2
             ))`,
            [vaultId, userId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get all vaults accessible by user
     */
    async getAllByUserId(userId) {
        const result = await pool.query(
            `SELECT v.*,
                    COUNT(DISTINCT d.id) FILTER (WHERE d.is_folder = false) as document_count,
                    CASE
                        WHEN v.owner_id = $1 THEN 'owner'
                        ELSE COALESCE(vp.permission, 'none')
                        END as user_permission
             FROM vaults v
                      LEFT JOIN vault_permissions vp ON vp.vault_id = v.id AND vp.user_id = $1
                      LEFT JOIN documents d ON d.vault_id = v.id AND d.is_deleted = false
             WHERE v.is_deleted = false
               AND (v.owner_id = $1 OR EXISTS (
                 SELECT 1 FROM vault_permissions
                 WHERE vault_id = v.id AND user_id = $1
             ))
             GROUP BY v.id, vp.permission
             ORDER BY v.updated_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Update vault
     */
    async update(vaultId, ownerId, updates) {
        const { name, description, icon, color, settings } = updates;
        const result = await pool.query(
            `UPDATE vaults
             SET name = COALESCE($1, name),
                 description = COALESCE($2, description),
                 icon = COALESCE($3, icon),
                 color = COALESCE($4, color),
                 settings = COALESCE($5, settings),
                 updated_at = NOW()
             WHERE id = $6 AND owner_id = $7
             RETURNING *`,
            [name, description, icon, color, settings, vaultId, ownerId]
        );
        return result.rows[0] || null;
    }

    /**
     * Soft delete vault
     */
    async delete(vaultId, ownerId) {
        const result = await pool.query(
            `UPDATE vaults
             SET is_deleted = true, updated_at = NOW()
             WHERE id = $1 AND owner_id = $2
             RETURNING id`,
            [vaultId, ownerId]
        );
        return result.rows[0] || null;
    }

    /**
     * Check user access to vault
     */
    async checkAccess(vaultId, userId) {
        const result = await pool.query(
            `SELECT 1 FROM vaults
             WHERE id = $1 AND is_deleted = false
               AND (owner_id = $2 OR EXISTS (
                 SELECT 1 FROM vault_permissions
                 WHERE vault_id = $1 AND user_id = $2
             ))`,
            [vaultId, userId]
        );
        return result.rows.length > 0;
    }

    /**
     * Check write access to vault
     */
    async checkWriteAccess(vaultId, userId) {
        const result = await pool.query(
            `SELECT 1 FROM vaults
             WHERE id = $1 AND is_deleted = false
               AND (owner_id = $2 OR EXISTS (
                 SELECT 1 FROM vault_permissions
                 WHERE vault_id = $1 AND user_id = $2
                   AND permission IN ('write', 'admin')
             ))`,
            [vaultId, userId]
        );
        return result.rows.length > 0;
    }

    /**
     * Share vault with user
     */
    async share(vaultId, userId, permission) {
        const result = await pool.query(
            `INSERT INTO vault_permissions (vault_id, user_id, permission)
             VALUES ($1, $2, $3)
             ON CONFLICT (vault_id, user_id)
                 DO UPDATE SET permission = EXCLUDED.permission
             RETURNING *`,
            [vaultId, userId, permission]
        );
        return result.rows[0];
    }

    /**
     * Remove user access from vault
     */
    async unshare(vaultId, userId) {
        const result = await pool.query(
            'DELETE FROM vault_permissions WHERE vault_id = $1 AND user_id = $2 RETURNING id',
            [vaultId, userId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get all collaborators of a vault
     */
    async getCollaborators(vaultId) {
        const result = await pool.query(
            `SELECT vp.user_id, vp.permission, vp.created_at
             FROM vault_permissions vp
             WHERE vp.vault_id = $1
             ORDER BY vp.created_at DESC`,
            [vaultId]
        );
        return result.rows;
    }
}

export const vaultRepository = new VaultRepository();
export default vaultRepository;
