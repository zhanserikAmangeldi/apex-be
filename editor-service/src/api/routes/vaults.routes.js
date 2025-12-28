import { Router } from 'express';
import { authenticateToken } from '../middleware/index.js';
import { vaultRepository, documentRepository } from '../../db/repositories/index.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../middleware/index.js';

const router = Router();

/**
 * GET /vaults - Get all user's vaults
 */
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const vaults = await vaultRepository.getAllByUserId(req.user.userId);
        res.json({ vaults });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /vaults - Create new vault
 */
router.post('/', authenticateToken, async (req, res, next) => {
    try {
        const { name, description, icon, color } = req.body;

        if (!name || name.trim().length === 0) {
            throw new ValidationError('Vault name is required');
        }

        const vault = await vaultRepository.create(
            req.user.userId,
            name.trim(),
            description,
            icon,
            color
        );

        res.status(201).json(vault);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /vaults/:id - Get vault by ID
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
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
});

/**
 * PUT /vaults/:id - Update vault
 */
router.put('/:id', authenticateToken, async (req, res, next) => {
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

        res.json(vault);
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /vaults/:id - Delete vault
 */
router.delete('/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;

        const result = await vaultRepository.delete(id, req.user.userId);
        
        if (!result) {
            throw new NotFoundError('Vault not found or no permission to delete');
        }

        res.json({ message: 'Vault deleted successfully' });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /vaults/:id/documents - Get all documents in vault
 */
router.get('/:id/documents', authenticateToken, async (req, res, next) => {
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
});

/**
 * POST /vaults/:id/documents - Create document in vault
 */
router.post('/:id/documents', authenticateToken, async (req, res, next) => {
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

        res.status(201).json(document);
    } catch (err) {
        next(err);
    }
});

/**
 * POST /vaults/:id/share - Share vault with user
 */
router.post('/:id/share', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { userId, permission } = req.body;

        if (!userId) {
            throw new ValidationError('User ID is required');
        }

        if (!['read', 'write', 'admin'].includes(permission)) {
            throw new ValidationError('Invalid permission level');
        }

        // Check if current user is owner
        const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);
        if (!vault || vault.user_permission !== 'owner') {
            throw new ForbiddenError('Only vault owner can share');
        }

        const result = await vaultRepository.share(id, userId, permission);
        res.json({ 
            message: 'Vault shared successfully',
            permission: result 
        });
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /vaults/:id/share/:userId - Remove user access
 */
router.delete('/:id/share/:userId', authenticateToken, async (req, res, next) => {
    try {
        const { id, userId } = req.params;

        // Check if current user is owner
        const vault = await vaultRepository.getByIdWithPermission(id, req.user.userId);
        if (!vault || vault.user_permission !== 'owner') {
            throw new ForbiddenError('Only vault owner can modify sharing');
        }

        const result = await vaultRepository.unshare(id, userId);
        
        if (!result) {
            throw new NotFoundError('User permission not found');
        }

        res.json({ message: 'Access removed successfully' });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /vaults/:id/collaborators - Get vault collaborators
 */
router.get('/:id/collaborators', authenticateToken, async (req, res, next) => {
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
});

export default router;
