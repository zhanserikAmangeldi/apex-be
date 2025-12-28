import { Hocuspocus } from '@hocuspocus/server';
import { Logger } from '@hocuspocus/extension-logger';
import * as Y from 'yjs';
import { config } from '../config/index.js';
import { authService } from './auth.service.js';
import { crdtService } from './crdt.service.js';
import { documentRepository, updatesRepository } from '../db/repositories/index.js';

// Track documents that need snapshots
const pendingSnapshots = new Map();

/**
 * Create and configure Hocuspocus server
 */
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

        /**
         * Authentication hook
         */
        async onAuthenticate({ token, documentName }) {
            if (!token) {
                throw new Error('Authentication required');
            }

            try {
                const user = await authService.validateToken(token);

                // Check document access
                const documentId = documentName;
                const hasAccess = await documentRepository.checkAccess(documentId, user.userId);

                if (!hasAccess) {
                    throw new Error('Access denied to this document');
                }

                console.log(`✅ User ${user.username} authenticated for document ${documentId}`);

                return {
                    user: {
                        id: user.userId,
                        name: user.displayName || user.username,
                        email: user.email,
                    },
                };
            } catch (err) {
                console.error('❌ Authentication failed:', err.message);
                throw new Error('Invalid or expired token');
            }
        },

        /**
         * Load document state
         */
        async onLoadDocument({ document, documentName }) {
            const documentId = documentName;
            console.log(`📄 Loading document: ${documentId}`);

            try {
                // Check if document exists
                const exists = await documentRepository.exists(documentId);
                if (!exists) {
                    console.log(`⚠️ Document ${documentId} not found, creating empty`);
                    return document;
                }

                // Get snapshot timestamp for incremental loading
                const snapshotInfo = await documentRepository.getById(documentId);
                const snapshotTime = snapshotInfo?.last_snapshot_at || null;

                // Load full state
                const state = await crdtService.loadDocumentState(documentId, snapshotTime);

                if (state && state.length > 0) {
                    Y.applyUpdate(document, state);
                    console.log(`✅ Document ${documentId} loaded (${state.length} bytes)`);
                }

                return document;
            } catch (err) {
                console.error(`❌ Failed to load document ${documentId}:`, err);
                return document;
            }
        },

        /**
         * Handle document changes
         */
        async onChange({ documentName, document, context }) {
            const documentId = documentName;

            try {
                // Get the latest update
                const update = Y.encodeStateAsUpdate(document);

                // Save update
                await crdtService.saveUpdate(documentId, update);

                // Update document timestamp
                await documentRepository.touch(documentId);

                // Check if snapshot is needed
                const updateCount = await crdtService.getUpdateCount(documentId);

                if (updateCount >= config.snapshot.threshold) {
                    pendingSnapshots.set(documentId, true);
                    console.log(`📸 Snapshot triggered for ${documentId} (${updateCount} updates)`);
                }
            } catch (err) {
                console.error(`❌ Failed to save update for ${documentId}:`, err);
            }
        },

        /**
         * Handle store document (debounced)
         */
        async onStoreDocument({ documentName, document, state }) {
            const documentId = documentName;

            try {
                // Save the current state as an update
                await updatesRepository.save(documentId, Buffer.from(state));
                console.log(`💾 Stored update for ${documentId}`);
            } catch (err) {
                console.error(`❌ Failed to store document ${documentId}:`, err);
            }
        },

        /**
         * Client connected
         */
        async onConnect({ documentName, context }) {
            const user = context.user;
            console.log(`👤 User ${user?.name || 'unknown'} connected to ${documentName}`);
        },

        /**
         * Client disconnected
         */
        async onDisconnect({ documentName, context }) {
            const user = context.user;
            console.log(`👤 User ${user?.name || 'unknown'} disconnected from ${documentName}`);
        },

        /**
         * Handle awareness update (cursor positions, etc.)
         */
        async onAwarenessUpdate({ documentName, awareness }) {
            // Can be used for presence features
        },
    });

    return server;
}

/**
 * Get pending snapshots and clear the queue
 */
export function getPendingSnapshots() {
    const documents = Array.from(pendingSnapshots.keys());
    pendingSnapshots.clear();
    return documents;
}

export default createHocuspocusServer;
