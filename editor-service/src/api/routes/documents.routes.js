import { Router } from 'express';
import * as Y from 'yjs';
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

router.post('/',
    authenticateToken,
    validateBody(createDocumentSchema),
    async (req, res, next) => {
        try {
            const { title, vaultId, parentId, isFolder, icon, content } = req.body;

            const document = await documentRepository.create(
                req.user.userId,
                title,
                vaultId,
                parentId,
                isFolder
            );

            if (content && !isFolder) {
                const ydoc = new Y.Doc();
                const xmlFragment = ydoc.getXmlFragment('default');
                
                const lines = content.split('\n');
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    
                    if (!trimmed) {
                        const paragraph = new Y.XmlElement('paragraph');
                        xmlFragment.push([paragraph]);
                        continue;
                    }
                    
                    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
                    if (headingMatch) {
                        const level = headingMatch[1].length;
                        const text = headingMatch[2];
                        const heading = new Y.XmlElement('heading');
                        heading.setAttribute('level', level);
                        const textNode = new Y.XmlText();
                        textNode.insert(0, text);
                        heading.insert(0, [textNode]);
                        xmlFragment.push([heading]);
                        continue;
                    }
                    
                    if (trimmed === '---' || trimmed === '***') {
                        const hr = new Y.XmlElement('horizontalRule');
                        xmlFragment.push([hr]);
                        continue;
                    }
                    
                    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
                    if (listMatch) {
                        const text = listMatch[1];
                        const listItem = new Y.XmlElement('listItem');
                        const paragraph = new Y.XmlElement('paragraph');
                        const textNode = new Y.XmlText();
                        textNode.insert(0, text);
                        paragraph.insert(0, [textNode]);
                        listItem.insert(0, [paragraph]);
                        
                        const bulletList = new Y.XmlElement('bulletList');
                        bulletList.insert(0, [listItem]);
                        xmlFragment.push([bulletList]);
                        continue;
                    }
                    
                    const paragraph = new Y.XmlElement('paragraph');
                    
                    let remaining = trimmed;
                    const tokens = [];
                    
                    const regex = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
                    let lastIndex = 0;
                    let match;
                    
                    while ((match = regex.exec(remaining)) !== null) {
                        if (match.index > lastIndex) {
                            tokens.push({ type: 'text', content: remaining.slice(lastIndex, match.index) });
                        }
                        
                        const matched = match[0];
                        if (matched.startsWith('**') && matched.endsWith('**')) {
                            tokens.push({ type: 'bold', content: matched.slice(2, -2) });
                        } else if (matched.startsWith('[')) {
                            const linkMatch = matched.match(/\[([^\]]+)\]\(([^)]+)\)/);
                            if (linkMatch) {
                                tokens.push({ type: 'link', text: linkMatch[1], href: linkMatch[2] });
                            }
                        }
                        
                        lastIndex = regex.lastIndex;
                    }
                    
                    if (lastIndex < remaining.length) {
                        tokens.push({ type: 'text', content: remaining.slice(lastIndex) });
                    }
                    
                    if (tokens.length === 0) {
                        const textNode = new Y.XmlText();
                        textNode.insert(0, trimmed);
                        paragraph.push([textNode]);
                    } else {
                        for (const token of tokens) {
                            if (token.type === 'text' && token.content) {
                                const textNode = new Y.XmlText();
                                textNode.insert(0, token.content);
                                paragraph.push([textNode]);
                            } else if (token.type === 'bold') {
                                const textNode = new Y.XmlText();
                                textNode.insert(0, token.content);
                                textNode.format(0, token.content.length, { bold: true });
                                paragraph.push([textNode]);
                            } else if (token.type === 'link') {
                                const textNode = new Y.XmlText();
                                textNode.insert(0, token.text);
                                textNode.format(0, token.text.length, { link: { href: token.href } });
                                paragraph.push([textNode]);
                            }
                        }
                    }
                    
                    xmlFragment.push([paragraph]);
                }
                
                const update = Y.encodeStateAsUpdate(ydoc);
                await crdtService.saveUpdate(document.id, update);
                
                apiLogger.info('Initial content saved for document', { documentId: document.id, contentLength: content.length });
                
                const { indexDocumentNow } = await import('../../services/ai-indexer.service.js');
                indexDocumentNow(document.id, ydoc, req.user.userId).catch(err => {
                    apiLogger.warn({ err, documentId: document.id }, 'Failed to index new document');
                });
            }

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

router.get('/:id/export/text',
    authenticateToken,
    validateParams(documentIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const hasAccess = await documentRepository.checkAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this document');
            }

            const document = await documentRepository.getById(id);
            if (!document) {
                throw new NotFoundError('Document not found');
            }

            const state = await crdtService.loadDocumentState(id);
            
            const ydoc = new Y.Doc();
            Y.applyUpdate(ydoc, state);
            
            const xmlFragment = ydoc.getXmlFragment('default');
            let text = '';
            
            const extractText = (node) => {
                if (node._item && node._item.content) {
                    const content = node._item.content;
                    if (content.str) {
                        text += content.str;
                    }
                }
                
                if (node._first) {
                    let item = node._first;
                    while (item) {
                        if (item.content && item.content.str) {
                            text += item.content.str;
                        } else if (item.content && item.content.type) {
                            extractText(item.content.type);
                        }
                        item = item.right;
                    }
                }
            };
            
            extractText(xmlFragment);

            res.json({
                document_id: id,
                title: document.title,
                content: text.trim() || ''
            });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
