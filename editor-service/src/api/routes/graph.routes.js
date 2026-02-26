import express from 'express';
import { graphRepository } from '../../db/repositories/graph.repository.js';
import { authenticateToken } from '../middleware/index.js';
import { apiLogger } from '../../services/logger.service.js';
import * as Y from 'yjs';

const router = express.Router();

/**
 * Extract document links from Yjs document
 */
function extractDocumentLinks(snapshotOrUpdates) {
    try {
        const ydoc = new Y.Doc();
        
        if (Array.isArray(snapshotOrUpdates)) {
            for (const update of snapshotOrUpdates) {
                Y.applyUpdate(ydoc, update);
            }
        } else {
            Y.applyUpdate(ydoc, snapshotOrUpdates);
        }
        
        const fragment = ydoc.getXmlFragment('default');
        const links = [];
        
        function traverse(node) {
            if (!node) return;
            
            // Check if this is a documentLink node
            if (node.nodeName === 'documentLink') {
                const attrs = node.getAttributes ? node.getAttributes() : {};
                if (attrs.id) {
                    links.push(attrs.id);
                }
            }
            
            // Only XmlFragment and XmlElement have children via .get()
            if (node instanceof Y.XmlFragment || node instanceof Y.XmlElement) {
                const len = node.length || 0;
                for (let i = 0; i < len; i++) {
                    traverse(node.get(i));
                }
            }
        }
        
        traverse(fragment);
        return links;
    } catch (error) {
        console.error('Error extracting document links:', error);
        return [];
    }
}

/**
 * GET /api/v1/vaults/:vaultId/graph
 * Get graph data for a vault (nodes and edges)
 */
router.get('/vaults/:vaultId/graph', authenticateToken, async (req, res, next) => {
    try {
        const { vaultId } = req.params;
        const userId = req.user.userId;

        apiLogger.debug('Graph API request', {
            vaultId,
            userId,
            username: req.user.username
        });

        // Get all graph data
        const { documents, tags, snapshots, updates } = await graphRepository.getVaultGraph(vaultId, userId);

        // Build nodes
        const nodes = documents.map(doc => {
            const docTags = tags.filter(t => t.document_id === doc.id);
            return {
                id: doc.id,
                title: doc.title,
                icon: doc.icon || (doc.is_folder ? '📁' : '📄'),
                isFolder: doc.is_folder,
                parentId: doc.parent_id,
                tags: docTags.map(t => ({
                    id: t.tag_id,
                    name: t.name,
                    color: t.color
                })),
                createdAt: doc.created_at,
                updatedAt: doc.updated_at
            };
        });

        // Build edges
        const edges = [];
        const edgeSet = new Set(); // To avoid duplicates

        // 1. Parent-child relationships
        documents.forEach(doc => {
            if (doc.parent_id) {
                const edgeId = `parent-${doc.parent_id}-${doc.id}`;
                if (!edgeSet.has(edgeId)) {
                    edges.push({
                        id: edgeId,
                        source: doc.parent_id,
                        target: doc.id,
                        type: 'hierarchy'
                    });
                    edgeSet.add(edgeId);
                }
            }
        });

        // 2. Document links from snapshots
        snapshots.forEach(snapshot => {
            const sourceId = snapshot.document_id;
            const linkedDocIds = extractDocumentLinks(snapshot.snapshot);
            
            linkedDocIds.forEach(targetId => {
                const edgeId = `link-${sourceId}-${targetId}`;
                if (!edgeSet.has(edgeId) && documents.find(d => d.id === targetId)) {
                    edges.push({
                        id: edgeId,
                        source: sourceId,
                        target: targetId,
                        type: 'document-link'
                    });
                    edgeSet.add(edgeId);
                }
            });
        });

        // 2b. Document links from updates (for docs without snapshots)
        updates.forEach(row => {
            const sourceId = row.document_id;
            const linkedDocIds = extractDocumentLinks(row.updates);
            
            linkedDocIds.forEach(targetId => {
                const edgeId = `link-${sourceId}-${targetId}`;
                if (!edgeSet.has(edgeId) && documents.find(d => d.id === targetId)) {
                    edges.push({
                        id: edgeId,
                        source: sourceId,
                        target: targetId,
                        type: 'document-link'
                    });
                    edgeSet.add(edgeId);
                }
            });
        });

        // 3. Tag relationships (documents with same tags)
        const tagGroups = {};
        tags.forEach(tag => {
            if (!tagGroups[tag.tag_id]) {
                tagGroups[tag.tag_id] = [];
            }
            tagGroups[tag.tag_id].push(tag.document_id);
        });

        // Create edges between documents with same tags
        Object.entries(tagGroups).forEach(([tagId, docIds]) => {
            if (docIds.length > 1) {
                // Connect documents with the same tag
                for (let i = 0; i < docIds.length; i++) {
                    for (let j = i + 1; j < docIds.length; j++) {
                        const edgeId = `tag-${tagId}-${docIds[i]}-${docIds[j]}`;
                        const reverseEdgeId = `tag-${tagId}-${docIds[j]}-${docIds[i]}`;
                        
                        if (!edgeSet.has(edgeId) && !edgeSet.has(reverseEdgeId)) {
                            edges.push({
                                id: edgeId,
                                source: docIds[i],
                                target: docIds[j],
                                type: 'tag',
                                tagId: tagId
                            });
                            edgeSet.add(edgeId);
                        }
                    }
                }
            }
        });

        apiLogger.debug('Graph API result', {
            vaultId,
            userId,
            nodesCount: nodes.length,
            edgesCount: edges.length
        });

        res.json({
            nodes,
            edges,
            stats: {
                totalNodes: nodes.length,
                totalEdges: edges.length,
                hierarchyEdges: edges.filter(e => e.type === 'hierarchy').length,
                documentLinkEdges: edges.filter(e => e.type === 'document-link').length,
                tagEdges: edges.filter(e => e.type === 'tag').length
            }
        });
    } catch (error) {
        console.error('Graph API Error:', error);
        next(error);
    }
});

/**
 * GET /api/v1/documents/:documentId/backlinks
 * Get all documents that link to the given document
 */
router.get('/documents/:documentId/backlinks', authenticateToken, async (req, res, next) => {
    try {
        const { documentId } = req.params;
        const userId = req.user.userId;

        // Get the document to find its vault
        const { document: doc, vaultDocuments, snapshots, updates } = await graphRepository.getBacklinksData(documentId, userId);

        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Find all documents that contain a link to documentId
        const backlinks = [];

        // Check snapshots
        for (const snapshot of snapshots) {
            if (snapshot.document_id === documentId) continue;
            const linkedIds = extractDocumentLinks(snapshot.snapshot);
            if (linkedIds.includes(documentId)) {
                const sourceDoc = vaultDocuments.find(d => d.id === snapshot.document_id);
                if (sourceDoc) {
                    backlinks.push({
                        id: sourceDoc.id,
                        title: sourceDoc.title,
                        icon: sourceDoc.icon || '📄',
                    });
                }
            }
        }

        // Check updates
        for (const row of updates) {
            if (row.document_id === documentId) continue;
            if (backlinks.find(b => b.id === row.document_id)) continue; // already found via snapshot
            const linkedIds = extractDocumentLinks(row.updates);
            if (linkedIds.includes(documentId)) {
                const sourceDoc = vaultDocuments.find(d => d.id === row.document_id);
                if (sourceDoc) {
                    backlinks.push({
                        id: sourceDoc.id,
                        title: sourceDoc.title,
                        icon: sourceDoc.icon || '📄',
                    });
                }
            }
        }

        res.json({ backlinks, count: backlinks.length });
    } catch (error) {
        console.error('Backlinks API Error:', error);
        next(error);
    }
});

export default router;
