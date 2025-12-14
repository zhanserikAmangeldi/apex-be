import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import * as Y from 'yjs';
import authClient from './auth/authClient.js';
import { loadSnapshot } from './db/snapshots.js';
import { loadUpdatesSince, saveUpdate, getUpdateCount } from './db/updates.js';
import pool from './db/pool.js';

const SNAPSHOT_THRESHOLD = parseInt(process.env.SNAPSHOT_THRESHOLD_UPDATES || '200');

/**
 * Merge snapshot and updates
 */
function mergeUpdates(snapshot, updates) {
    const ydoc = new Y.Doc();

    if (snapshot) {
        Y.applyUpdate(ydoc, snapshot);
    }

    for (const update of updates) {
        Y.applyUpdate(ydoc, update);
    }

    return Y.encodeStateAsUpdate(ydoc);
}

/**
 * Check document access
 */
async function checkDocumentAccess(documentId, userId) {
    const result = await pool.query(
        `SELECT 1 FROM documents 
         WHERE id = $1 AND is_deleted = false
           AND (owner_id = $2 OR EXISTS (
             SELECT 1 FROM document_permissions 
             WHERE document_id = $1 AND user_id = $2
           ))`,
        [documentId, userId]
    );

    return result.rows.length > 0;
}

/**
 * Create Hocuspocus server
 */
export function createHocuspocusServer() {
    const server = Server.configure({
        port: parseInt(process.env.HOCUSPOCUS_PORT || '1234'),
        timeout: 30000,
        debounce: 2000,
        maxDebounce: 10000,

        extensions: [
            new Database({
                fetch: async ({ documentName }) => {
                    console.log(`📥 Fetching document: ${documentName}`);

                    try {
                        const snapshot = await loadSnapshot(documentName);

                        const snapshotInfo = await pool.query(
                            'SELECT last_snapshot_at FROM documents WHERE id = $1',
                            [documentName]
                        );

                        const snapshotTime = snapshotInfo.rows[0]?.last_snapshot_at;
                        const updates = await loadUpdatesSince(documentName, snapshotTime);

                        console.log(`📦 Loaded: snapshot=${!!snapshot}, updates=${updates.length}`);

                        return mergeUpdates(snapshot, updates);

                    } catch (err) {
                        console.error(`❌ Error fetching document ${documentName}:`, err);
                        return null;
                    }
                },

                store: async ({ documentName, state }) => {
                    console.log(`💾 Storing update for: ${documentName}`);

                    try {
                        await saveUpdate(documentName, Buffer.from(state));

                        const updateCount = await getUpdateCount(documentName);

                        if (updateCount >= SNAPSHOT_THRESHOLD) {
                            console.log(`📸 Triggering snapshot for ${documentName} (${updateCount} updates)`);

                            setImmediate(async () => {
                                try {
                                    const { createSnapshotForDocument } = await import('./workers/snapshot.js');
                                    await createSnapshotForDocument(documentName);
                                } catch (err) {
                                    console.error(`❌ Snapshot creation failed:`, err);
                                }
                            });
                        }

                    } catch (err) {
                        console.error(`❌ Error storing update:`, err);
                        throw err;
                    }
                },
            }),
        ],

        /**
         * Authentication через auth service
         */
        async onAuthenticate({ token, documentName }) {
            if (!token) {
                throw new Error('No token provided');
            }

            try {
                const user = await authClient.validateToken(token);

                const hasAccess = await checkDocumentAccess(documentName, user.userId);

                if (!hasAccess) {
                    throw new Error('Access denied to document');
                }

                console.log(`✓ User ${user.userId} (${user.username}) authenticated for document ${documentName}`);

                return user;

            } catch (err) {
                console.error('Authentication failed:', err.message);
                throw new Error(`Authentication failed: ${err.message}`);
            }
        },

        async onConnect({ documentName, context }) {
            console.log(`🔌 Client connected: ${context.username} → ${documentName}`);

            await pool.query(
                'UPDATE documents SET updated_at = NOW() WHERE id = $1',
                [documentName]
            );
        },

        async onDisconnect({ documentName, context }) {
            console.log(`🔌 Client disconnected: ${context.username} ← ${documentName}`);
        },

        async onLoadDocument({ documentName }) {
            console.log(`📄 Loading document: ${documentName}`);

            const result = await pool.query(
                'SELECT id FROM documents WHERE id = $1 AND is_deleted = false',
                [documentName]
            );

            if (result.rows.length === 0) {
                throw new Error('Document not found or deleted');
            }
        },

        async onDestroy() {
            console.log('🛑 Hocuspocus server shutting down');
        },
    });

    return server;
}

export default createHocuspocusServer;