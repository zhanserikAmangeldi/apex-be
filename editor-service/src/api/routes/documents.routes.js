import { Router } from 'express';
import { authenticateToken } from '../middleware/index.js';
import { validateBody, validateParams } from '../validation/index.js';
import {
    createDocumentSchema,
    updateDocumentSchema,
    moveDocumentSchema,
    documentIdParamSchema
} from '../validation/schemas.js';
import { documentRepository } from '../../db/repositories/index.js';
import { crdtService } from '../../services/crdt.service.js';
import { NotFoundError, ForbiddenError } from '../middleware/index.js';
import { apiLogger, logAudit } from '../../services/logger.service.js';

const router = Router();

/**
 * GET /documents - Get all user's documents
 */
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const documents = await documentRepository.getAllByUserId(req.user.userId);

        apiLogger.debug('Documents fetched', {
            userId: req.user.userId,
            count: documents.length
        });

        res.json({ documents });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /documents - Create new document
 */
router.post('/',
    authenticateToken,
    validateBody(createDocumentSchema),
    async (req, res, next) => {
        try {
            const { title, vaultId, parentId, isFolder, icon } = req.body;

            const document = await documentRepository.create(
                req.user.userId,
                title,
                vaultId,
                parentId,
                isFolder
            );

            logAudit('document_created', req.user.userId, {
                documentId: document.id,
                title: document.title,
                isFolder,
            });

            res.status(201).json(document);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /documents/:id - Get document by ID
 */
router.get('/:id',
    authenticateToken,
    validateParams(documentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const document = await documentRepository.getByIdWithPermission(id, req.user.userId);

            if (!document) {
                throw new NotFoundError('Document not found');
            }

            res.json(document);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * PUT /documents/:id - Update document
 */
router.put('/:id',
    authenticateToken,
    validateParams(documentIdParamSchema),
    validateBody(updateDocumentSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const { title, icon, parentId } = req.body;

            const hasAccess = await documentRepository.checkWriteAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

            const document = await documentRepository.update(id, { title, icon, parentId });

            if (!document) {
                throw new NotFoundError('Document not found');
            }

            logAudit('document_updated', req.user.userId, {
                documentId: id,
                changes: { title, icon, parentId },
            });

            res.json(document);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * DELETE /documents/:id - Delete document
 */
router.delete('/:id',
    authenticateToken,
    validateParams(documentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const result = await documentRepository.delete(id, req.user.userId);

            if (!result) {
                throw new NotFoundError('Document not found or no permission to delete');
            }

            logAudit('document_deleted', req.user.userId, { documentId: id });

            res.json({ message: 'Document deleted successfully' });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /documents/:id/move - Move document to different parent
 */
router.post('/:id/move',
    authenticateToken,
    validateParams(documentIdParamSchema),
    validateBody(moveDocumentSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const { parentId } = req.body;

            const hasAccess = await documentRepository.checkWriteAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

            const document = await documentRepository.move(id, parentId);

            if (!document) {
                throw new NotFoundError('Document not found');
            }

            logAudit('document_moved', req.user.userId, {
                documentId: id,
                newParentId: parentId,
            });

            res.json(document);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /documents/:id/stats - Get document statistics
 */
router.get('/:id/stats',
    authenticateToken,
    validateParams(documentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const hasAccess = await documentRepository.checkAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this document');
            }

            const stats = await crdtService.getDocumentStats(id);
            res.json(stats);
        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /documents/:id/snapshot - Force create snapshot
 */
router.post('/:id/snapshot',
    authenticateToken,
    validateParams(documentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const hasAccess = await documentRepository.checkWriteAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this document');
            }

            const result = await crdtService.createSnapshot(id);

            logAudit('snapshot_created', req.user.userId, {
                documentId: id,
                ...result
            });

            res.json({
                message: 'Snapshot created',
                ...result
            });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
