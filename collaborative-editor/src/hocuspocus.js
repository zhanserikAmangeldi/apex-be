import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import * as Y from 'yjs';
import authClient from './auth/authClient.js';
import { loadSnapshot } from './db/snapshots.js';
import { loadUpdatesSince, saveUpdate, getUpdateCount } from './db/updates.js';
import pool from './db/pool.js';
import lockService from './services/lock.js';
import redisClient from './services/redis.js';
import { wsConnectionsActive, crdtUpdatesTotal } from './services/metrics.js';
import { wsUpdateLimiter } from './services/rateLimiter.js';
import pino from 'pino';

const logger = pino({ name: 'hocuspocus' });
const SNAPSHOT_THRESHOLD = parseInt(process.env.SNAPSHOT_THRESHOLD_UPDATES || '200');

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

export function createHocuspocusServer() {
    const server = Server.configure({
        port: parseInt(process.env.HOCUSPOCUS_PORT || '1234'),
        timeout: 30000,
        debounce: 2000,
        maxDebounce: 10000,

        extensions: [
            new Database({
                fetch: async ({ documentName }) => {
                    logger.info({ documentName }, 'Fetching document');

                    try {
                        const snapshot = await loadSnapshot(documentName);

                        const snapshotInfo = await pool.query(
                            'SELECT last_snapshot_at FROM documents WHERE id = $1',
                            [documentName]
                        );

                        const snapshotTime = snapshotInfo.rows[0]?.last_snapshot_at;
                        const updates = await loadUpdatesSince(documentName, snapshotTime);

                        logger.info({ 
                            documentName, 
                            hasSnapshot: !!snapshot, 
                            updateCount: updates.length 
                        }, 'Document loaded');

                        return mergeUpdates(snapshot, updates);

                    } catch (err) {
                        logger.error({ documentName, err }, 'Error fetching document');
                        return null;
                    }
                },

                store: async ({ documentName, state, context }) => {
                    const user = context;
                    const rateLimitKey = `${user.userId}:${documentName}`;
                    
                    const rateLimitResult = await wsUpdateLimiter.consume(rateLimitKey);
                    
                    if (!rateLimitResult.success) {
                        logger.warn({ 
                            userId: user.userId, 
                            documentName,
                            blocked: rateLimitResult.blocked 
                        }, 'Rate limit exceeded for updates');
                        
                        return;
                    }

                    await lockService.withLock(`document:${documentName}`, async () => {
                        try {
                            await saveUpdate(documentName, Buffer.from(state));
                            
                            crdtUpdatesTotal.labels(documentName).inc();

                            await pool.query(
                                'UPDATE documents SET updated_at = NOW() WHERE id = $1',
                                [documentName]
                            );

                            const updateCount = await getUpdateCount(documentName);

                            if (updateCount >= SNAPSHOT_THRESHOLD) {
                                logger.info({ documentName, updateCount }, 'Adding to pending snapshots');
                                
                                await redisClient.sAdd('pending_snapshots', documentName);
                                await redisClient.expire('pending_snapshots', 3600); // 1 hour TTL
                            }

                        } catch (err) {
                            logger.error({ documentName, err }, 'Error storing update');
                            throw err;
                        }
                    }, 10000); // 10 second lock timeout
                },
            }),
        ],

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

        async onConnect({ documentName, context, connection }) {
            const user = context;
            
            logger.info({ 
                userId: user.userId, 
                username: user.username, 
                documentName,
                connectionId: connection.socketId 
            }, 'Client connected');

            await redisClient.sAdd(`active_connections:${documentName}`, user.userId.toString());
            await redisClient.expire(`active_connections:${documentName}`, 3600);
            
            const activeCount = await redisClient.sCard(`active_connections:${documentName}`);
            wsConnectionsActive.labels(documentName).set(activeCount);

            await pool.query(
                'UPDATE documents SET updated_at = NOW() WHERE id = $1',
                [documentName]
            );
        },

        async onDisconnect({ documentName, context }) {
            const user = context;
            
            logger.info({ 
                userId: user.userId, 
                username: user.username, 
                documentName 
            }, 'Client disconnected');

            await redisClient.sRem(`active_connections:${documentName}`, user.userId.toString());
            
            const activeCount = await redisClient.sCard(`active_connections:${documentName}`);
            wsConnectionsActive.labels(documentName).set(activeCount);

            if (activeCount === 0) {
                logger.info({ documentName }, 'Last user disconnected, adding to pending snapshots');
                await redisClient.sAdd('pending_snapshots', documentName);
            }
        },

        async onLoadDocument({ documentName }) {
            logger.info({ documentName }, 'Loading document');

            const result = await pool.query(
                'SELECT id FROM documents WHERE id = $1 AND is_deleted = false',
                [documentName]
            );

            if (result.rows.length === 0) {
                throw new Error('Document not found or deleted');
            }
        },

        async onDestroy() {
            logger.info('Hocuspocus server shutting down');
            
            const keys = await redisClient.keys('active_connections:*');
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
        },
    });

    return server;
}

export default createHocuspocusServer;