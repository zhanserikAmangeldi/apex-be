#!/usr/bin/env python3
"""Run database migrations for content-scraper-service"""
import asyncio
import asyncpg
import os
import sys
from pathlib import Path

async def run_migrations():
    """Execute SQL migration files in order"""
    database_url = os.getenv("DATABASE_URL", "")
    
    if not database_url:
        print("ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)
    
    # Convert asyncpg URL format
    db_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    
    try:
        conn = await asyncpg.connect(db_url)
        print("✓ Connected to database")
        
        # Get migration files
        migrations_dir = Path(__file__).parent / "migrations"
        migration_files = sorted(migrations_dir.glob("*.sql"))
        
        if not migration_files:
            print("No migration files found")
            await conn.close()
            return
        
        for migration_file in migration_files:
            print(f"Running migration: {migration_file.name}")
            sql = migration_file.read_text()
            await conn.execute(sql)
            print(f"✓ Completed: {migration_file.name}")
        
        await conn.close()
        print("✓ All migrations completed successfully")
        
    except Exception as e:
        print(f"ERROR: Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(run_migrations())
