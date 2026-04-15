import * as Y from 'yjs';
import { documentRepository } from '../db/repositories/index.js';
import { logger } from './logger.service.js';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:8090';

const pendingIndexes = new Map();
const DEBOUNCE_MS = 5000;

function extractTextFromYDoc(ydoc) {
    try {
        const xmlFragment = ydoc.getXmlFragment('default');
        return xmlFragmentToText(xmlFragment);
    } catch (err) {
        logger.warn({ err }, 'Failed to extract text from YDoc');
        return '';
    }
}

function xmlFragmentToText(node) {
    let text = '';

    if (node.toString) {
        const len = node.length || 0;
        for (let i = 0; i < len; i++) {
            const child = node.get(i);
            if (child instanceof Y.XmlText) {
                text += child.toString();
            } else if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
                text += xmlFragmentToText(child);
                const nodeName = child.nodeName;
                if (['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'bulletList', 'orderedList'].includes(nodeName)) {
                    text += '\n';
                }
            }
        }
    }

    return text;
}

async function indexDocument(documentId, userId, vaultId, title, content) {
    try {
        const url = `${AI_SERVICE_URL}/api/v1/embeddings`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-User-ID': userId,
                'X-User-Email': '',
                'X-User-Username': '',
            },
            body: JSON.stringify({
                document_id: documentId,
                vault_id: vaultId,
                title: title || '',
                content: content,
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            const body = await response.text();
            logger.warn({ documentId, status: response.status, body }, 'AI indexing failed');
            return;
        }

        const result = await response.json();
        logger.info({ documentId, created: result.created }, 'AI indexing complete');
    } catch (err) {
        logger.warn({ err, documentId }, 'AI indexing request failed (non-blocking)');
    }
}

export function scheduleIndexing(documentId, ydoc, userId) {
    if (pendingIndexes.has(documentId)) {
        clearTimeout(pendingIndexes.get(documentId));
    }

    const timeout = setTimeout(async () => {
        pendingIndexes.delete(documentId);

        try {
            const content = extractTextFromYDoc(ydoc);

            const doc = await documentRepository.getById(documentId);
            if (!doc || doc.is_folder || doc.is_deleted) return;

            if (!content || content.trim().length < 10) {
                // Content is empty/too short — remove stale embedding if exists
                await deleteEmbedding(documentId, userId || doc.owner_id);
                return;
            }

            await indexDocument(documentId, userId || doc.owner_id, doc.vault_id, doc.title, content.trim());
        } catch (err) {
            logger.warn({ err, documentId }, 'Scheduled indexing failed');
        }
    }, DEBOUNCE_MS);

    pendingIndexes.set(documentId, timeout);
}

export async function indexDocumentNow(documentId, ydoc, userId) {
    try {
        const content = extractTextFromYDoc(ydoc);

        const doc = await documentRepository.getById(documentId);
        if (!doc || doc.is_folder || doc.is_deleted) return;

        if (!content || content.trim().length < 10) {
            await deleteEmbedding(documentId, userId || doc.owner_id);
            return;
        }

        await indexDocument(documentId, userId || doc.owner_id, doc.vault_id, doc.title, content.trim());
    } catch (err) {
        logger.warn({ err, documentId }, 'Immediate indexing failed');
    }
}

export async function deleteEmbedding(documentId, userId) {
    try {
        const url = `${AI_SERVICE_URL}/api/v1/embeddings/${documentId}`;

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'X-User-ID': userId,
                'X-User-Email': '',
                'X-User-Username': '',
            },
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            logger.warn({ documentId, status: response.status }, 'AI embedding delete failed');
            return;
        }

        logger.info({ documentId }, 'AI embedding deleted');
    } catch (err) {
        logger.warn({ err, documentId }, 'AI embedding delete request failed (non-blocking)');
    }
}

export default { scheduleIndexing, indexDocumentNow, deleteEmbedding };
