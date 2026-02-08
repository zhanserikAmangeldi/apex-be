import { Router } from 'express';
import { authenticateToken } from '../middleware/index.js';
import { documentRepository } from '../../db/repositories/index.js';
import { apiLogger } from '../../services/logger.service.js';

const router = Router();

/**
 * GET /search/documents - Search documents by title
 */
router.get('/documents', authenticateToken, async (req, res, next) => {
    try {
        const { query, vaultId, limit = 10 } = req.query;

        if (!query || query.trim().length === 0) {
            return res.json({ documents: [] });
        }

        const documents = await documentRepository.searchByTitle(
            req.user.userId,
            query.trim(),
            vaultId || null,
            parseInt(limit)
        );

        apiLogger.debug('Documents searched', {
            userId: req.user.userId,
            query,
            vaultId,
            count: documents.length
        });

        res.json({ documents });
    } catch (err) {
        next(err);
    }
});

export default router;
