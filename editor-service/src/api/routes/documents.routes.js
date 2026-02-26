import { Router } from 'express';
import { authenticateToken } from '../middleware/index.js';
import { validateBody, validateParams } from '../validation/index.js';
import {
    createDocumentSchema,
    updateDocumentSchema,
    moveDocumentSchema,
    documentIdParamSchema,
    shareDocumentSchema
} from '../validation/schemas.js';
import { documentRepository, attachmentRepository } from '../../db/repositories/index.js';
import { crdtService } from '../../services/crdt.service.js';
import { minioService } from '../../storage/minio.service.js';
import { config } from '../../config/index.js';
import { NotFoundError, ForbiddenError } from '../middleware/index.js';
import { apiLogger, logAudit } from '../../services/logger.service.js';
import { deleteEmbedding } from '../../services/ai-indexer.service.js';

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
 * GET /documents/shared - Get documents shared with user
 */
router.get('/shared', authenticateToken, async (req, res, next) => {
    try {
        const documents = await documentRepository.getSharedWithUser(req.user.userId);

        apiLogger.debug('Shared documents fetched', {
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
 * PATCH /documents/:id - Partial update document
 */
router.patch('/:id',
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

            deleteEmbedding(id, req.user.userId).catch(() => {});

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

/**
 * POST /documents/:id/share - Share document with user
 */
router.post('/:id/share',
    authenticateToken,
    validateParams(documentIdParamSchema),
    validateBody(shareDocumentSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;
            let { userId, email, permission } = req.body;

            const isOwner = await documentRepository.isOwner(id, req.user.userId);
            if (!isOwner) {
                throw new ForbiddenError('Only document owner can share');
            }

            if (email && !userId) {
                try {
                    const userServiceUrl = process.env.USER_SERVICE_URL || 'http://user-service:8080';
                    const response = await fetch(`${userServiceUrl}/api/v1/users/search?email=${encodeURIComponent(email)}`, {
                        headers: {
                            'Authorization': req.headers.authorization
                        }
                    });

                    if (!response.ok) {
                        if (response.status === 404) {
                            throw new NotFoundError('User with this email not found');
                        }
                        throw new Error('Failed to fetch user by email');
                    }

                    const userData = await response.json();
                    userId = userData.id;
                } catch (error) {
                    if (error instanceof NotFoundError) {
                        throw error;
                    }
                    apiLogger.error('Error fetching user by email', { error: error.message });
                    throw new Error('Failed to find user');
                }
            }

            if (!userId) {
                throw new Error('Either userId or email must be provided');
            }

            apiLogger.info('Sharing document', {
                documentId: id,
                sharedWithUserId: userId,
                sharedWithEmail: email,
                permission
            });

            const result = await documentRepository.share(id, userId, permission);

            apiLogger.info('Document shared successfully', {
                documentId: id,
                sharedWithUserId: userId,
                permission,
                result
            });

            logAudit('document_shared', req.user.userId, {
                documentId: id,
                sharedWithUserId: userId,
                sharedWithEmail: email,
                permission,
            });

            res.json({
                message: 'Document shared successfully',
                permission: result
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * DELETE /documents/:id/share/:userId - Remove user access
 */
router.delete('/:id/share/:userId',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { id, userId } = req.params;

            const document = await documentRepository.getByIdWithPermission(id, req.user.userId);
            if (!document) {
                throw new NotFoundError('Document not found');
            }

            const canManageAccess = document.user_permission === 'owner' || document.user_permission === 'admin';
            if (!canManageAccess) {
                throw new ForbiddenError('Only owners and admins can modify sharing');
            }

            const result = await documentRepository.unshare(id, userId);

            if (!result) {
                throw new NotFoundError('User permission not found');
            }

            logAudit('document_unshared', req.user.userId, {
                documentId: id,
                removedUserId: userId,
            });

            res.json({ message: 'Access removed successfully' });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /documents/:id/collaborators - Get document collaborators
 */
router.get('/:id/collaborators',
    authenticateToken,
    validateParams(documentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            apiLogger.info('Fetching collaborators - START', {
                documentId: id,
                userId: req.user.userId,
                username: req.user.username
            });

            const document = await documentRepository.getByIdWithPermission(id, req.user.userId);
            
            apiLogger.info('Document query result', {
                documentId: id,
                userId: req.user.userId,
                found: !!document,
                permission: document?.user_permission
            });
            
            if (!document) {
                const exists = await documentRepository.exists(id);
                apiLogger.warn('Document access denied', {
                    documentId: id,
                    userId: req.user.userId,
                    documentExists: exists
                });
                
                if (!exists) {
                    throw new NotFoundError('Document not found');
                } else {
                    throw new ForbiddenError('No access to this document');
                }
            }

            const canManageAccess = document.user_permission === 'owner' || document.user_permission === 'admin';
            
            apiLogger.info('Permission check', {
                documentId: id,
                userId: req.user.userId,
                permission: document.user_permission,
                canManageAccess
            });
            
            if (!canManageAccess) {
                throw new ForbiddenError('Only owners and admins can view collaborators');
            }

            const collaborators = await documentRepository.getCollaborators(id);
            
            apiLogger.info('Collaborators fetched successfully', {
                documentId: id,
                count: collaborators.length,
                collaborators
            });
            
            res.json({ collaborators });
        } catch (err) {
            apiLogger.error('Error fetching collaborators', {
                documentId: req.params.id,
                userId: req.user?.userId,
                error: err.message,
                stack: err.stack
            });
            next(err);
        }
    }
);

/**
 * PATCH /documents/:id/share/:userId - Update user permission
 */
router.patch('/:id/share/:userId',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { id, userId } = req.params;
            const { permission } = req.body;

            const document = await documentRepository.getByIdWithPermission(id, req.user.userId);
            if (!document) {
                throw new NotFoundError('Document not found');
            }

            const canManageAccess = document.user_permission === 'owner' || document.user_permission === 'admin';
            if (!canManageAccess) {
                throw new ForbiddenError('Only owners and admins can modify permissions');
            }

            const result = await documentRepository.updatePermission(id, userId, permission);

            if (!result) {
                throw new NotFoundError('User permission not found');
            }

            logAudit('document_permission_updated', req.user.userId, {
                documentId: id,
                userId,
                newPermission: permission,
            });

            res.json({
                message: 'Permission updated successfully',
                permission: result
            });
        } catch (err) {
            next(err);
        }
    }
);

/**
 * GET /documents/:id/attachments - Get all attachments for document
 */
router.get('/:id/attachments',
    authenticateToken,
    validateParams(documentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const hasAccess = await documentRepository.checkAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this document');
            }

            const attachments = await attachmentRepository.getByDocumentId(id);

            const attachmentsWithUrls = attachments.map((attachment) => ({
                id: attachment.id,
                documentId: attachment.document_id,
                filename: attachment.filename,
                contentType: attachment.content_type,
                size_bytes: attachment.size_bytes,
                uploadedBy: attachment.uploaded_by,
                created_at: attachment.created_at,
                downloadUrl: `http://localhost:3000/public/attachments/${attachment.id}/download`,
            }));

            res.json({ attachments: attachmentsWithUrls });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
