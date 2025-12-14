import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
    console.log('Running database migrations...\n');

    try {
        const migrationsDir = path.join(__dirname, '../../migrations');
        const files = await fs.readdir(migrationsDir);
        const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

        for (const file of sqlFiles) {
            console.log(`Running migration: ${file}`);
            const filePath = path.join(migrationsDir, file);
            const sql = await fs.readFile(filePath, 'utf8');

            await pool.query(sql);
            console.log(`Completed: ${file}\n`);
        }

        console.log('All migrations completed successfully!');
        await pool.end();
        process.exit(0);

    } catch (err) {
        console.error('Migration failed:', err);
        await pool.end();
        process.exit(1);
    }
}

runMigrations();