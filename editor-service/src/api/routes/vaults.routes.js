import { Router } from 'express';
import { authenticateToken } from '../middleware/index.js';
import { validateBody, validateParams } from '../validation/index.js';
import {
    createVaultSchema,
    updateVaultSchema,
    vaultIdParamSchema,
    shareVaultSchema,
} from '../validation/schemas.js';
import { vaultRepository, documentRepository } from '../../db/repositories/index.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../middleware/index.js';
import { apiLogger, logAudit } from '../../services/logger.service.js';

const router = Router();

router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const vaults = await vaultRepository.getAllByUserId(req.user.userId);

        apiLogger.debug('Vaults fetched', {
            userId: req.user.userId,
            count: vaults.length
        });

        res.json({ vaults });
    } catch (err) {
        next(err);
    }
});

router.get('/shared', authenticateToken, async (req, res, next) => {
    try {
        const vaults = await vaultRepository.getSharedWithUser(req.user.userId);

        apiLogger.debug('Shared vaults fetched', {
            userId: req.user.userId,
            count: vaults.length
        });

        res.json({ vaults });
    } catch (err) {
        next(err);
    }
});

router.post('/',
    authenticateToken,
    validateBody(createVaultSchema),
    async (req, res, next) => {
        try {
            const { name, description, icon, color } = req.body;

            const vault = await vaultRepository.create(
                req.user.userId,
                name,
                description,
                icon,
                color
            );

            logAudit('vault_created', req.user.userId, {
                vaultId: vault.id,
                name: vault.name,
            });

            res.status(201).json(vault);
        } catch (err) {
            next(err);
        }
    }
);

router.get('/:id',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);

            if (!vault) {
                throw new NotFoundError('Vault not found');
            }

            res.json(vault);
        } catch (err) {
            next(err);
        }
    }
);

router.put('/:id',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    validateBody(updateVaultSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const { name, description, icon, color, settings } = req.body;

            const vault = await vaultRepository.update(id, req.user.userId, {
                name,
                description,
                icon,
                color,
                settings
            });

            if (!vault) {
                throw new NotFoundError('Vault not found or no permission to update');
            }

            logAudit('vault_updated', req.user.userId, {
                vaultId: id,
                changes: { name, description, icon, color },
            });

            res.json(vault);
        } catch (err) {
            next(err);
        }
    }
);

router.patch('/:id',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    validateBody(updateVaultSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const { name, description, icon, color, settings } = req.body;

            const vault = await vaultRepository.update(id, req.user.userId, {
                name,
                description,
                icon,
                color,
                settings
            });

            if (!vault) {
                throw new NotFoundError('Vault not found or no permission to update');
            }

            logAudit('vault_updated', req.user.userId, {
                vaultId: id,
                changes: { name, description, icon, color },
            });

            res.json(vault);
        } catch (err) {
            next(err);
        }
    }
);

router.delete('/:id',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const result = await vaultRepository.delete(id, req.user.userId);

            if (!result) {
                throw new NotFoundError('Vault not found or no permission to delete');
            }

            logAudit('vault_deleted', req.user.userId, { vaultId: id });

            res.json({ message: 'Vault deleted successfully' });
        } catch (err) {
            next(err);
        }
    }
);

router.get('/:id/documents',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const hasAccess = await vaultRepository.checkAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this vault');
            }

            const documents = await documentRepository.getByVaultId(id, req.user.userId);
            res.json({ documents });
        } catch (err) {
            next(err);
        }
    }
);

router.post('/:id/documents',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    async (req, res, next) => {
        try {
            const { id: vaultId } = req.params;
            const { title, parentId, isFolder, content } = req.body;

            const hasAccess = await vaultRepository.checkWriteAccess(vaultId, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No write access to this vault');
            }

            const document = await documentRepository.create(
                req.user.userId,
                title || 'Untitled Document',
                vaultId,
                parentId || null,
                isFolder || false
            );

            if (content && !isFolder) {
                const Y = await import('yjs');
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
                const { crdtService } = await import('../../services/crdt.service.js');
                await crdtService.saveUpdate(document.id, update);
                
                const { indexDocumentNow } = await import('../../services/ai-indexer.service.js');
                indexDocumentNow(document.id, ydoc, req.user.userId).catch(err => {
                    console.warn('Failed to index new document:', err);
                });
            }

            logAudit('document_created_in_vault', req.user.userId, {
                documentId: document.id,
                vaultId,
                title: document.title,
            });

            res.status(201).json(document);
        } catch (err) {
            next(err);
        }
    }
);

router.post('/:id/share',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    validateBody(shareVaultSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;
            let { userId, email, permission } = req.body;

            const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);
            if (!vault || vault.user_permission !== 'owner') {
                throw new ForbiddenError('Only vault owner can share');
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

            const result = await vaultRepository.share(id, userId, permission);

            logAudit('vault_shared', req.user.userId, {
                vaultId: id,
                sharedWithUserId: userId,
                sharedWithEmail: email,
                permission,
            });

            res.json({
                message: 'Vault shared successfully',
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

            const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);
            if (!vault) {
                throw new NotFoundError('Vault not found');
            }

            const canManageAccess = vault.user_permission === 'owner' || vault.user_permission === 'admin';
            if (!canManageAccess) {
                throw new ForbiddenError('Only owners and admins can modify sharing');
            }

            const result = await vaultRepository.unshare(id, userId);

            if (!result) {
                throw new NotFoundError('User permission not found');
            }

            logAudit('vault_unshared', req.user.userId, {
                vaultId: id,
                removedUserId: userId,
            });

            res.json({ message: 'Access removed successfully' });
        } catch (err) {
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

            const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);
            if (!vault) {
                throw new NotFoundError('Vault not found');
            }

            const canManageAccess = vault.user_permission === 'owner' || vault.user_permission === 'admin';
            if (!canManageAccess) {
                throw new ForbiddenError('Only owners and admins can modify permissions');
            }

            const result = await vaultRepository.updatePermission(id, userId, permission);

            if (!result) {
                throw new NotFoundError('User permission not found');
            }

            logAudit('vault_permission_updated', req.user.userId, {
                vaultId: id,
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

router.get('/:id/collaborators',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);
            if (!vault) {
                throw new NotFoundError('Vault not found');
            }

            const canManageAccess = vault.user_permission === 'owner' || vault.user_permission === 'admin';
            if (!canManageAccess) {
                throw new ForbiddenError('Only owners and admins can view collaborators');
            }

            const collaborators = await vaultRepository.getCollaborators(id);
            res.json({ collaborators });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
