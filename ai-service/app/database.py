import asyncpg
import logging
from app.config import settings

logger = logging.getLogger("ai-service")

pool: asyncpg.Pool | None = None


async def init_db():
    """Create connection pool and initialize pgvector + tables."""
    global pool
    pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=2,
        max_size=settings.db_max_connections,
    )

    async with pool.acquire() as conn:
        # Enable pgvector extension
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")

        # Create embeddings table
        await conn.execute(f"""
            CREATE TABLE IF NOT EXISTS document_embeddings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID UNIQUE NOT NULL,
                user_id UUID NOT NULL,
                title VARCHAR(500) DEFAULT '',
                content_hash VARCHAR(64) NOT NULL,
                embedding vector({settings.embedding_dimension}),
                model_name VARCHAR(100) NOT NULL DEFAULT '{settings.embedding_model}',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # HNSW index for fast cosine similarity search
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
            ON document_embeddings
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_embeddings_user_id
            ON document_embeddings(user_id);
        """)

    logger.info("Database initialized with pgvector")


async def close_db():
    global pool
    if pool:
        await pool.close()
        pool = None


def get_pool() -> asyncpg.Pool:
    if pool is None:
        raise RuntimeError("Database pool not initialized")
    return pool
