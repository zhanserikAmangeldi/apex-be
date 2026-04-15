import { Router } from 'express';
import { authenticateToken } from '../middleware/index.js';
import { connectionRepository } from '../../db/repositories/connection.repository.js';
import { documentRepository } from '../../db/repositories/index.js';
import { NotFoundError, ForbiddenError } from '../middleware/index.js';
import { apiLogger, logAudit } from '../../services/logger.service.js';

const router = Router();

const VALID_TYPES = ['related', 'supports', 'contradicts', 'extends', 'references', 'inspired_by'];

router.post('/', authenticateToken, async (req, res, next) => {
    try {
        const { sourceNoteId, targetNoteId, connectionType = 'related', description, isInline = false } = req.body;
        const userId = req.user.userId;

        if (!sourceNoteId || !targetNoteId) {
            return res.status(400).json({ error: 'sourceNoteId and targetNoteId are required' });
        }

        if (sourceNoteId === targetNoteId) {
            return res.status(400).json({ error: 'Cannot connect a note to itself' });
        }

        if (!VALID_TYPES.includes(connectionType)) {
            return res.status(400).json({ error: `Invalid connection type. Valid: ${VALID_TYPES.join(', ')}` });
        }

        const [sourceDoc, targetDoc] = await Promise.all([
            documentRepository.getByIdWithPermission(sourceNoteId, userId),
            documentRepository.getByIdWithPermission(targetNoteId, userId),
        ]);

        if (!sourceDoc) throw new NotFoundError('Source note not found');
        if (!targetDoc) throw new NotFoundError('Target note not found');

        const exists = await connectionRepository.exists(sourceNoteId, targetNoteId);
        if (exists) {
            return res.status(409).json({ error: 'Connection already exists between these notes' });
        }

        const connection = await connectionRepository.create(
            sourceNoteId, targetNoteId, userId, connectionType, description, isInline
        );

        logAudit('connection_created', userId, {
            connectionId: connection.id,
            sourceNoteId,
            targetNoteId,
            connectionType,
        });

        res.status(201).json(connection);
    } catch (err) {
        next(err);
    }
});

router.get('/note/:noteId', authenticateToken, async (req, res, next) => {
    try {
        const { noteId } = req.params;
        const userId = req.user.userId;

        const doc = await documentRepository.getByIdWithPermission(noteId, userId);
        if (!doc) throw new NotFoundError('Note not found');

        const connections = await connectionRepository.getByNoteId(noteId);
        res.json({ connections, count: connections.length });
    } catch (err) {
        next(err);
    }
});

router.get('/vault/:vaultId', authenticateToken, async (req, res, next) => {
    try {
        const { vaultId } = req.params;
        const connections = await connectionRepository.getByVaultId(vaultId);
        res.json({ connections, count: connections.length });
    } catch (err) {
        next(err);
    }
});

router.put('/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { connectionType, description } = req.body;
        const userId = req.user.userId;

        if (connectionType && !VALID_TYPES.includes(connectionType)) {
            return res.status(400).json({ error: `Invalid connection type. Valid: ${VALID_TYPES.join(', ')}` });
        }

        const connection = await connectionRepository.update(id, userId, { connectionType, description });
        if (!connection) {
            throw new NotFoundError('Connection not found or no permission to update');
        }

        logAudit('connection_updated', userId, { connectionId: id, connectionType, description });

        res.json(connection);
    } catch (err) {
        next(err);
    }
});

router.delete('/inline/:sourceId/:targetId', authenticateToken, async (req, res, next) => {
    try {
        const { sourceId, targetId } = req.params;

        const deleted = await connectionRepository.deleteInline(sourceId, targetId);

        if (deleted) {
            logAudit('inline_connection_deleted', req.user.userId, { sourceId, targetId });
        }

        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

router.delete('/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        const deleted = await connectionRepository.delete(id, userId);
        if (!deleted) {
            throw new NotFoundError('Connection not found or no permission to delete');
        }

        logAudit('connection_deleted', userId, { connectionId: id });

        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

router.get('/types', authenticateToken, (req, res) => {
    res.json({
        types: VALID_TYPES.map(type => ({
            value: type,
            label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        })),
    });
});

export default router;
