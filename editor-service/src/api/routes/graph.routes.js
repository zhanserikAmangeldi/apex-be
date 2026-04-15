import express from 'express';
import { graphRepository } from '../../db/repositories/graph.repository.js';
import { connectionRepository } from '../../db/repositories/connection.repository.js';
import { authenticateToken } from '../middleware/index.js';
import { apiLogger } from '../../services/logger.service.js';
import * as Y from 'yjs';

const router = express.Router();

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
            
            if (node.nodeName === 'documentLink') {
                const attrs = node.getAttributes ? node.getAttributes() : {};
                if (attrs.id) {
                    links.push(attrs.id);
                }
            }
            
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

router.get('/vaults/:vaultId/graph', authenticateToken, async (req, res, next) => {
    try {
        const { vaultId } = req.params;
        const userId = req.user.userId;

        apiLogger.debug('Graph API request', {
            vaultId,
            userId,
            username: req.user.username
        });

        const { documents, tags, snapshots, updates, connections } = await graphRepository.getVaultGraph(vaultId, userId);

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

        const edges = [];
        const edgeSet = new Set();

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

        const tagGroups = {};
        tags.forEach(tag => {
            if (!tagGroups[tag.tag_id]) {
                tagGroups[tag.tag_id] = [];
            }
            tagGroups[tag.tag_id].push(tag.document_id);
        });

        Object.entries(tagGroups).forEach(([tagId, docIds]) => {
            if (docIds.length > 1) {
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

        connections.forEach(conn => {
            const edgeId = `connection-${conn.id}`;
            if (!edgeSet.has(edgeId)) {
                edges.push({
                    id: edgeId,
                    source: conn.source_note_id,
                    target: conn.target_note_id,
                    type: 'connection',
                    connectionType: conn.connection_type,
                    description: conn.description
                });
                edgeSet.add(edgeId);
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
                tagEdges: edges.filter(e => e.type === 'tag').length,
                connectionEdges: edges.filter(e => e.type === 'connection').length
            }
        });
    } catch (error) {
        console.error('Graph API Error:', error);
        next(error);
    }
});

router.get('/documents/:documentId/backlinks', authenticateToken, async (req, res, next) => {
    try {
        const { documentId } = req.params;

        const rows = await connectionRepository.getBacklinks(documentId);
        const backlinks = rows.map(r => ({
            id: r.id,
            title: r.title,
            icon: r.icon || '📄',
            connectionType: r.connection_type,
        }));

        res.json({ backlinks, count: backlinks.length });
    } catch (error) {
        console.error('Backlinks API Error:', error);
        next(error);
    }
});

export default router;
