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

            const documents = await documentRepository.getByVaultId(id);
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
            const { userId, permission } = req.body;

            const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);
            if (!vault || vault.user_permission !== 'owner') {
                throw new ForbiddenError('Only vault owner can share');
            }

            const result = await vaultRepository.share(id, userId, permission);

            logAudit('vault_shared', req.user.userId, {
                vaultId: id,
                sharedWithUserId: userId,
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

            const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);
            if (!vault || vault.user_permission !== 'owner') {
                throw new ForbiddenError('Only vault owner can modify sharing');
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
 * GET /vaults/:id/collaborators - Get vault collaborators
 */
router.get('/:id/collaborators',
    authenticateToken,
    validateParams(vaultIdParamSchema),
    async (req, res, next) => {
        try {
            const { id } = req.params;

            const hasAccess = await vaultRepository.checkAccess(id, req.user.userId);
            if (!hasAccess) {
                throw new ForbiddenError('No access to this vault');
            }

            const collaborators = await vaultRepository.getCollaborators(id);
            res.json({ collaborators });
        } catch (err) {
            next(err);
        }
    }
);

export default router;
