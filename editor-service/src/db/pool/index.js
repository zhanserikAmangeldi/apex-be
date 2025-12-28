import pg from 'pg';
import { config } from '../../config/index.js';

const { Pool } = pg;

export const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
    max: config.db.maxConnections,
    idleTimeoutMillis: config.db.idleTimeout,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database pool error:', err);
    process.exit(-1);
});

pool.on('connect', () => {
    console.log('📦 New database connection established');
});

/**
 * Test database connection
 */
export async function testConnection() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
        return true;
    } catch (err) {
        console.error('❌ Database connection error:', err);
        return false;
    }
}

/**
 * Execute query with error handling
 */
export async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        if (duration > 1000) {
            console.warn(`⚠️ Slow query (${duration}ms):`, text.substring(0, 100));
        }
        
        return result;
    } catch (err) {
        console.error('❌ Query error:', err.message);
        throw err;
    }
}

/**
 * Get client for transactions
 */
export async function getClient() {
    const client = await pool.connect();
    return client;
}

/**
 * Execute transaction
 */
export async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export default pool;
