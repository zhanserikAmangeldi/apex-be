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

/**
 * GET /vaults - Get all user's vaults
 */
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

/**
 * GET /vaults/shared - Get vaults shared with user
 */
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

/**
 * POST /vaults - Create new vault
 */
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

/**
 * GET /vaults/:id - Get vault by ID
 */
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

/**
 * PUT /vaults/:id - Update vault
 */
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

/**
 * PATCH /vaults/:id - Partial update vault
 */
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

/**
 * DELETE /vaults/:id - Delete vault
 */
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

/**
 * GET /vaults/:id/documents - Get all documents in vault
 */
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

/**
 * POST /vaults/:id/documents - Create document in vault
 */
router.post('/:id/documents',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    async (req, res, next) => {
        try {
            const { id: vaultId } = req.params;
            const { title, parentId, isFolder } = req.body;

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

/**
 * POST /vaults/:id/share - Share vault with user
 */
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

            // If email is provided, fetch userId from user-service
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

/**
 * DELETE /vaults/:id/share/:userId - Remove user access
 */
router.delete('/:id/share/:userId',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { id, userId } = req.params;

            // Check if user is owner or admin
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

/**
 * PATCH /vaults/:id/share/:userId - Update user permission
 */
router.patch('/:id/share/:userId',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { id, userId } = req.params;
            const { permission } = req.body;

            // Check if user is owner or admin
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

/**
 * GET /vaults/:id/collaborators - Get vault collaborators
 */
router.get('/:id/collaborators',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            // Check if user is owner or admin
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
