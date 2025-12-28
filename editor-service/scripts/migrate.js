import fs from 'fs';
import path from 'path';
import pg from 'pg';
import {config} from "../src/config/index.js";

const { Pool } = pg;

async function runMigrations() {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        database: config.db.name,
        user: config.db.user,
        password: config.db.password,
    });

    try {
        console.log('Running migrations...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const appliedResult = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
        const appliedMigrations = new Set(appliedResult.rows.map(r => r.version));

        const migrationsDir = path.join(process.cwd(), 'migrations');
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        for (const file of files) {
            const version = file.replace('.sql', '');

            if (appliedMigrations.has(version)) {
                console.log(`Skipping ${file} (already applied)`);
                continue;
            }

            console.log(`Applying ${file}...`);

            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

            await pool.query('BEGIN');
            try {
                await pool.query(sql);
                await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
                await pool.query('COMMIT');
                console.log(`Applied ${file}`);
            } catch (err) {
                await pool.query('ROLLBACK');
                console.error(`Failed to apply ${file}:`, err.message);
                throw err;
            }
        }

        console.log('All migrations completed');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigrations();
