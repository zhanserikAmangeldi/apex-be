import express from 'express';
import cors from 'cors';
import pool from './db/pool.js';
import authClient from './auth/authClient.js';
import { authenticateToken, optionalAuth } from './middleware/auth.js';
import {
    generatePresignedUploadUrl,
    generatePresignedDownloadUrl
} from './storage/minio.js';
import vaultRouter from './vaults-api.js'

const app = express();

app.use(express.json());
app.use('/api', vaultRouter)

app.post('/api/auth/refresh', async (req, res) => {
    const { refresh_token } = req.body;

    if (!refresh_token) {
        return res.status(400).json({
            error: 'Refresh token required'
        });
    }

    try {
        const tokens = await authClient.refreshToken(refresh_token);
        res.json(tokens);
    } catch (err) {
        console.error('Token refresh error:', err);
        res.status(401).json({
            error: 'Invalid refresh token',
            message: err.message
        });
    }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        // Очищаем кэш для этого токена
        authClient.invalidateCache(req.accessToken);

        res.json({ success: true });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/documents', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.id, d.title, d.created_at, d.updated_at, 
                    d.snapshot_size_bytes, d.snapshot_storage,
                    d.last_snapshot_at
             FROM documents d
             WHERE d.owner_id = $1 AND d.is_deleted = false
             ORDER BY d.updated_at DESC`,
            [req.user.userId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/documents/:id', authenticateToken, async (req, res) => {
    try {
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
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/documents', authenticateToken, async (req, res) => {
    const { title } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO documents (owner_id, title) 
             VALUES ($1, $2) 
             RETURNING id, owner_id, title, created_at, updated_at, is_deleted`,
            [req.user.userId, title || 'Untitled Document']
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/documents/:id', authenticateToken, async (req, res) => {
    const { title } = req.body;

    try {
        const result = await pool.query(
            `UPDATE documents
             SET title = COALESCE($1, title),
                 updated_at = NOW()
             WHERE id = $2 AND owner_id = $3
             RETURNING *`,
            [title, req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/documents/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE documents 
             SET is_deleted = true, updated_at = NOW() 
             WHERE id = $1 AND owner_id = $2 
             RETURNING id`,
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/documents/:id/share', authenticateToken, async (req, res) => {
    const { user_id, permission } = req.body; // permission: 'read' | 'write' | 'admin'

    if (!user_id || !permission) {
        return res.status(400).json({ error: 'user_id and permission are required' });
    }

    if (!['read', 'write', 'admin'].includes(permission)) {
        return res.status(400).json({ error: 'Invalid permission type' });
    }

    try {
        const docCheck = await pool.query(
            `SELECT 1 FROM documents 
             WHERE id = $1 AND owner_id = $2`,
            [req.params.id, req.user.userId]
        );

        if (docCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Only document owner can share' });
        }

        const result = await pool.query(
            `INSERT INTO document_permissions (document_id, user_id, permission)
             VALUES ($1, $2, $3)
             ON CONFLICT (document_id, user_id) 
             DO UPDATE SET permission = EXCLUDED.permission, updated_at = NOW()
             RETURNING *`,
            [req.params.id, user_id, permission]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/documents/:id/collaborators', authenticateToken, async (req, res) => {
    try {
        const accessCheck = await pool.query(
            `SELECT 1 FROM documents 
             WHERE id = $1 AND (owner_id = $2 OR EXISTS (
               SELECT 1 FROM document_permissions 
               WHERE document_id = $1 AND user_id = $2
             ))`,
            [req.params.id, req.user.userId]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await pool.query(
            `SELECT dp.user_id, dp.permission, dp.created_at
             FROM document_permissions dp
             WHERE dp.document_id = $1
             ORDER BY dp.created_at DESC`,
            [req.params.id]
        );

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/attachments/initiate', authenticateToken, async (req, res) => {
    const { documentId, filename, mimeType, size } = req.body;

    if (!documentId || !filename) {
        return res.status(400).json({ error: 'documentId and filename are required' });
    }

    try {
        const docCheck = await pool.query(
            `SELECT 1 FROM documents 
             WHERE id = $1 AND (
               owner_id = $2 OR EXISTS (
                 SELECT 1 FROM document_permissions 
                 WHERE document_id = $1 AND user_id = $2 
                   AND permission IN ('write', 'admin')
               )
             )`,
            [documentId, req.user.userId]
        );

        if (docCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Write access required' });
        }

        const timestamp = Date.now();
        const path = `${req.user.userId}/${documentId}/${timestamp}-${filename}`;

        const attachmentResult = await pool.query(
            `INSERT INTO attachments 
             (document_id, owner_id, filename, mime_type, size_bytes, minio_path)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, minio_path`,
            [documentId, req.user.userId, filename, mimeType, size, path]
        );

        const attachment = attachmentResult.rows[0];

        const uploadUrl = await generatePresignedUploadUrl(
            process.env.MINIO_BUCKET_ATTACHMENTS,
            attachment.minio_path,
            3600
        );

        res.json({
            attachmentId: attachment.id,
            uploadUrl
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/attachments/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT a.* 
             FROM attachments a
             JOIN documents d ON a.document_id = d.id
             WHERE a.id = $1 AND a.is_deleted = false
               AND (d.owner_id = $2 OR EXISTS (
                 SELECT 1 FROM document_permissions 
                 WHERE document_id = d.id AND user_id = $2
               ))`,
            [req.params.id, req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const attachment = result.rows[0];

        const downloadUrl = await generatePresignedDownloadUrl(
            process.env.MINIO_BUCKET_ATTACHMENTS,
            attachment.minio_path,
            3600
        );

        res.json({
            ...attachment,
            downloadUrl
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/documents/:id/attachments', authenticateToken, async (req, res) => {
    try {
        const accessCheck = await pool.query(
            `SELECT 1 FROM documents 
             WHERE id = $1 AND (owner_id = $2 OR EXISTS (
               SELECT 1 FROM document_permissions 
               WHERE document_id = $1 AND user_id = $2
             ))`,
            [req.params.id, req.user.userId]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await pool.query(
            `SELECT id, filename, mime_type, size_bytes, created_at
             FROM attachments
             WHERE document_id = $1 AND is_deleted = false
             ORDER BY created_at DESC`,
            [req.params.id]
        );

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: {
                database: 'connected',
                auth: process.env.AUTH_SERVICE_URL
            }
        });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: err.message
        });
    }
});

export function startApiServer(port = 3000) {
    app.listen(port, () => {
        console.log(`✓ REST API listening on port ${port}`);
        console.log(`✓ Auth service: ${process.env.AUTH_SERVICE_URL}`);
    });
}

export default app;