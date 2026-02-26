import { Hocuspocus } from '@hocuspocus/server';
import { Logger } from '@hocuspocus/extension-logger';
import * as Y from 'yjs';
import { config } from '../config/index.js';
import { authService } from './auth.service.js';
import { crdtService } from './crdt.service.js';
import { documentRepository, updatesRepository } from '../db/repositories/index.js';
import { connectionRepository } from '../db/repositories/connection.repository.js';
import { scheduleIndexing } from './ai-indexer.service.js';
import { extractDocumentLinks } from './document-links.service.js';

const pendingSnapshots = new Map();

export function createHocuspocusServer() {
    const server = new Hocuspocus({
        port: config.hocuspocusPort,
        timeout: config.hocuspocus.timeout,
        debounce: config.hocuspocus.debounce,
        maxDebounce: config.hocuspocus.maxDebounce,

        extensions: [
            new Logger({
                log: (message) => console.log(`[Hocuspocus] ${message}`),
            }),
        ],

        async onAuthenticate({ token, documentName }) {
            if (!token) {
                throw new Error('Authentication required');
            }

            try {
                const user = await authService.validateToken(token);

                const documentId = documentName;
                const hasAccess = await documentRepository.checkAccess(documentId, user.userId);

                if (!hasAccess) {
                    throw new Error('Access denied to this document');
                }

                const hasWriteAccess = await documentRepository.checkWriteAccess(documentId, user.userId);

                console.log(`User ${user.username} authenticated for document ${documentId} (write: ${hasWriteAccess})`);

                return {
                    user: {
                        id: user.userId,
                        name: user.displayName || user.username,
                        email: user.email,
                        canWrite: hasWriteAccess,
                    },
                };
            } catch (err) {
                console.error('Authentication failed:', err.message);
                throw new Error('Invalid or expired token');
            }
        },

        async onLoadDocument({ document, documentName }) {
            const documentId = documentName;
            console.log(`Loading document: ${documentId}`);

            try {
                const exists = await documentRepository.exists(documentId);
                if (!exists) {
                    console.log(`Document ${documentId} not found, creating empty`);
                    return document;
                }

                const snapshotInfo = await documentRepository.getById(documentId);
                const snapshotTime = snapshotInfo?.last_snapshot_at || null;

                const state = await crdtService.loadDocumentState(documentId, snapshotTime);

                if (state && state.length > 0) {
                    Y.applyUpdate(document, state);
                    console.log(`Document ${documentId} loaded (${state.length} bytes)`);
                }

                return document;
            } catch (err) {
                console.error(`Failed to load document ${documentId}:`, err);
                return document;
            }
        },

        async onChange({ documentName, document, context }) {
            const documentId = documentName;

            if (!context.user?.canWrite) {
                console.log(`User ${context.user?.name} attempted to edit read-only document ${documentId}`);
                return;
            }

            try {
                const update = Y.encodeStateAsUpdate(document);

                await crdtService.saveUpdate(documentId, update);

                await documentRepository.touch(documentId);

                const updateCount = await crdtService.getUpdateCount(documentId);

                if (updateCount >= config.snapshot.threshold) {
                    pendingSnapshots.set(documentId, true);
                    console.log(`Snapshot triggered for ${documentId} (${updateCount} updates)`);
                }
            } catch (err) {
                console.error(`Failed to save update for ${documentId}:`, err);
            }
        },

        async onStoreDocument({ documentName, document, state, context }) {
            const documentId = documentName;

            try {
                const docState = state || Y.encodeStateAsUpdate(document);
                await updatesRepository.save(documentId, Buffer.from(docState));
                console.log(`Stored update for ${documentId}`);

                const linkedIds = extractDocumentLinks(document);
                const userId = context?.user?.id || null;
                if (userId) {
                    await connectionRepository.syncInlineLinks(documentId, linkedIds, userId)
                        .catch(err => console.error(`Failed to sync inline links for ${documentId}:`, err));
                }

                scheduleIndexing(documentId, document, null);
            } catch (err) {
                console.error(`Failed to store document ${documentId}:`, err);
            }
        },

        async onConnect({ documentName, context }) {
            const user = context.user;
            console.log(`User ${user?.name || 'unknown'} connected to ${documentName}`);
        },

        async onDisconnect({ documentName, context }) {
            const user = context.user;
            console.log(`User ${user?.name || 'unknown'} disconnected from ${documentName}`);
        },

        async onAwarenessUpdate({ documentName, awareness }) {
        },
    });

    return server;
}

export function getPendingSnapshots() {
    const documents = Array.from(pendingSnapshots.keys());
    pendingSnapshots.clear();
    return documents;
}

export default createHocuspocusServer;
