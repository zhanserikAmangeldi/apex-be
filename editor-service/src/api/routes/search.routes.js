import { Router } from 'express';
import { authenticateToken } from '../middleware/index.js';
import { documentRepository } from '../../db/repositories/index.js';
import { apiLogger } from '../../services/logger.service.js';
import * as Y from 'yjs';
import pool from '../../db/pool/index.js';

const router = Router();

function extractText(data) {
    try {
        const ydoc = new Y.Doc();
        if (Array.isArray(data)) {
            for (const update of data) {
                Y.applyUpdate(ydoc, update);
            }
        } else {
            Y.applyUpdate(ydoc, data);
        }
        const fragment = ydoc.getXmlFragment('default');
        return fragmentToText(fragment);
    } catch {
        return '';
    }
}

function fragmentToText(node) {
    let text = '';
    if (node instanceof Y.XmlText) {
        return node.toString();
    }
    if (node instanceof Y.XmlFragment || node instanceof Y.XmlElement) {
        const len = node.length || 0;
        for (let i = 0; i < len; i++) {
            text += fragmentToText(node.get(i));
            const child = node.get(i);
            if (child instanceof Y.XmlElement) {
                const name = child.nodeName;
                if (['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem'].includes(name)) {
                    text += '\n';
                }
            }
        }
    }
    return text;
}

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

router.get('/fulltext', authenticateToken, async (req, res, next) => {
    try {
        const { query, vaultId, limit = 20 } = req.query;
        const userId = req.user.userId;

        if (!query || query.trim().length < 2) {
            return res.json({ results: [] });
        }

        const searchTerm = query.trim().toLowerCase();
        const maxResults = Math.min(parseInt(limit) || 20, 50);

        let docsQuery, docsParams;
        if (vaultId) {
            docsQuery = `SELECT d.id, d.title FROM documents d
                WHERE d.vault_id = $1 AND d.is_deleted = false AND d.is_folder = false
                AND (d.owner_id::text = $2::text
                     OR EXISTS (SELECT 1 FROM document_permissions WHERE document_id = d.id AND user_id::text = $2::text)
                     OR EXISTS (SELECT 1 FROM vault_permissions WHERE vault_id = d.vault_id AND user_id::text = $2::text))`;
            docsParams = [vaultId, userId];
        } else {
            docsQuery = `SELECT d.id, d.title FROM documents d
                WHERE d.is_deleted = false AND d.is_folder = false
                AND (d.owner_id::text = $1::text
                     OR EXISTS (SELECT 1 FROM document_permissions WHERE document_id = d.id AND user_id::text = $1::text)
                     OR EXISTS (SELECT 1 FROM vault_permissions WHERE vault_id = d.vault_id AND user_id::text = $1::text))`;
            docsParams = [userId];
        }

        const docsResult = await pool.query(docsQuery, docsParams);
        const docIds = docsResult.rows.map(d => d.id);
        const docMap = new Map(docsResult.rows.map(d => [d.id, d.title]));

        if (docIds.length === 0) {
            return res.json({ results: [] });
        }

        const snapshotsResult = await pool.query(
            `SELECT document_id, snapshot FROM crdt_snapshots WHERE document_id = ANY($1)`,
            [docIds]
        );
        const snapshotMap = new Map(snapshotsResult.rows.map(r => [r.document_id, r.snapshot]));

        const docIdsWithoutSnapshot = docIds.filter(id => !snapshotMap.has(id));
        let updatesMap = new Map();
        if (docIdsWithoutSnapshot.length > 0) {
            const updatesResult = await pool.query(
                `SELECT document_id, array_agg(update_data ORDER BY created_at) as updates
                 FROM crdt_updates WHERE document_id = ANY($1)
                 GROUP BY document_id`,
                [docIdsWithoutSnapshot]
            );
            updatesMap = new Map(updatesResult.rows.map(r => [r.document_id, r.updates]));
        }

        const results = [];
        for (const docId of docIds) {
            if (results.length >= maxResults) break;

            const data = snapshotMap.get(docId) || updatesMap.get(docId);
            if (!data) continue;

            const content = extractText(data);
            const lowerContent = content.toLowerCase();
            const idx = lowerContent.indexOf(searchTerm);

            if (idx !== -1) {
                const start = Math.max(0, idx - 40);
                const end = Math.min(content.length, idx + searchTerm.length + 40);
                let snippet = content.substring(start, end).replace(/\n/g, ' ').trim();
                if (start > 0) snippet = '...' + snippet;
                if (end < content.length) snippet = snippet + '...';

                results.push({
                    document_id: docId,
                    title: docMap.get(docId) || '',
                    snippet,
                    match_index: idx,
                });
            }
        }

        res.json({ results, count: results.length });
    } catch (err) {
        console.error('Full-text search error:', err);
        next(err);
    }
});

export default router;
