import express from 'express';
import pool from './db/pool.js';
import { authenticateToken } from './middleware/auth.js';

const router = express.Router();

router.get('/vaults', authenticateToken, async (req, res) => {
    try {
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
            [req.user.userId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/vaults/:id', authenticateToken, async (req, res) => {
    try {
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
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Vault not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/vaults', authenticateToken, async (req, res) => {
    const { name, description, icon, color } = req.body;

    if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Vault name is required' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO vaults (owner_id, name, description, icon, color) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING *`,
            [req.user.userId, name.trim(), description, icon || '📁', color || '#6366f1']
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/vaults/:id', authenticateToken, async (req, res) => {
    const { name, description, icon, color, settings } = req.body;

    try {
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
            [name, description, icon, color, settings, req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Vault not found or access denied' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/vaults/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE vaults 
             SET is_deleted = true, updated_at = NOW() 
             WHERE id = $1 AND owner_id = $2 
             RETURNING id`,
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Vault not found or access denied' });
        }

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});


router.get('/vaults/:id/documents', authenticateToken, async (req, res) => {
    try {
        const accessCheck = await pool.query(
            `SELECT 1 FROM vaults 
             WHERE id = $1 AND is_deleted = false
               AND (owner_id = $2 OR EXISTS (
                 SELECT 1 FROM vault_permissions 
                 WHERE vault_id = $1 AND user_id = $2
               ))`,
            [req.params.id, req.user.userId]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await pool.query(
            `SELECT id, vault_id, parent_id, title, icon, is_folder, 
                    created_at, updated_at, snapshot_size_bytes
             FROM documents
             WHERE vault_id = $1 AND is_deleted = false
             ORDER BY is_folder DESC, title ASC`,
            [req.params.id]
        );

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/vaults/:vaultId/documents', authenticateToken, async (req, res) => {
    const { title, parent_id, is_folder, icon } = req.body;
    const { vaultId } = req.params;

    if (!title || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
    }

    try {
        const accessCheck = await pool.query(
            `SELECT 1 FROM vaults 
             WHERE id = $1 AND is_deleted = false
               AND (owner_id = $2 OR EXISTS (
                 SELECT 1 FROM vault_permissions 
                 WHERE vault_id = $1 AND user_id = $2 
                   AND permission IN ('write', 'admin')
               ))`,
            [vaultId, req.user.userId]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Write access required' });
        }

        if (parent_id) {
            const parentCheck = await pool.query(
                `SELECT 1 FROM documents 
                 WHERE id = $1 AND vault_id = $2 AND is_folder = true`,
                [parent_id, vaultId]
            );

            if (parentCheck.rows.length === 0) {
                return res.status(400).json({ error: 'Invalid parent folder' });
            }
        }

        const result = await pool.query(
            `INSERT INTO documents (vault_id, parent_id, owner_id, title, is_folder, icon) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING *`,
            [vaultId, parent_id || null, req.user.userId, title.trim(), is_folder || false, icon]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/documents/:id/move', authenticateToken, async (req, res) => {
    const { parent_id } = req.body;

    try {
        const docResult = await pool.query(
            `SELECT vault_id FROM documents WHERE id = $1 AND is_deleted = false`,
            [req.params.id]
        );

        if (docResult.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        const { vault_id } = docResult.rows[0];

        const accessCheck = await pool.query(
            `SELECT 1 FROM vaults 
             WHERE id = $1 AND is_deleted = false
               AND (owner_id = $2 OR EXISTS (
                 SELECT 1 FROM vault_permissions 
                 WHERE vault_id = $1 AND user_id = $2 
                   AND permission IN ('write', 'admin')
               ))`,
            [vault_id, req.user.userId]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (parent_id) {
            const parentCheck = await pool.query(
                `SELECT 1 FROM documents 
                 WHERE id = $1 AND vault_id = $2 AND is_folder = true`,
                [parent_id, vault_id]
            );

            if (parentCheck.rows.length === 0) {
                return res.status(400).json({ error: 'Invalid parent folder' });
            }
        }

        const result = await pool.query(
            `UPDATE documents
             SET parent_id = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [parent_id || null, req.params.id]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/vaults/:id/share', authenticateToken, async (req, res) => {
    const { user_id, permission } = req.body;

    if (!user_id || !permission) {
        return res.status(400).json({ error: 'user_id and permission are required' });
    }

    if (!['read', 'write', 'admin'].includes(permission)) {
        return res.status(400).json({ error: 'Invalid permission type' });
    }

    try {
        const vaultCheck = await pool.query(
            `SELECT 1 FROM vaults 
             WHERE id = $1 AND owner_id = $2`,
            [req.params.id, req.user.userId]
        );

        if (vaultCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Only vault owner can share' });
        }

        const result = await pool.query(
            `INSERT INTO vault_permissions (vault_id, user_id, permission)
             VALUES ($1, $2, $3)
             ON CONFLICT (vault_id, user_id) 
             DO UPDATE SET permission = EXCLUDED.permission
             RETURNING *`,
            [req.params.id, user_id, permission]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

export default router;