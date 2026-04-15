import asyncpg
import logging
from app.config import settings

logger = logging.getLogger("ai-service")

pool: asyncpg.Pool | None = None


async def init_db():
    global pool
    pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=2,
        max_size=settings.db_max_connections,
    )

    async with pool.acquire() as conn:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")

        await conn.execute(f"""
            CREATE TABLE IF NOT EXISTS document_embeddings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                document_id UUID UNIQUE NOT NULL,
                user_id UUID NOT NULL,
                vault_id UUID NOT NULL,
                title VARCHAR(500) DEFAULT '',
                content_hash VARCHAR(64) NOT NULL,
                embedding vector({settings.embedding_dimension}),
                model_name VARCHAR(100) NOT NULL DEFAULT '{settings.embedding_model}',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        """)

        await conn.execute("""
            ALTER TABLE document_embeddings
            ADD COLUMN IF NOT EXISTS vault_id UUID;
        """)

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

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_embeddings_vault_id
            ON document_embeddings(vault_id);
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                document_id UUID NOT NULL,
                title VARCHAR(500) DEFAULT 'New Chat',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
            ON chat_sessions(user_id);
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_document_id
            ON chat_sessions(document_id);
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
                content TEXT NOT NULL,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
            ON chat_messages(session_id);
        """)

        # --- Flashcards ---
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS flashcards (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                document_id UUID NOT NULL,
                vault_id UUID NOT NULL,
                front TEXT NOT NULL,
                back TEXT NOT NULL,
                ease_factor REAL NOT NULL DEFAULT 2.5,
                interval_days INTEGER NOT NULL DEFAULT 1,
                reps INTEGER NOT NULL DEFAULT 0,
                next_review TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_flashcards_user_vault
            ON flashcards(user_id, vault_id);
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_flashcards_next_review
            ON flashcards(user_id, next_review);
        """)

        # --- Quiz results ---
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS quiz_results (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                vault_id UUID NOT NULL,
                document_id UUID NOT NULL,
                question TEXT NOT NULL,
                correct BOOLEAN NOT NULL,
                xp INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_quiz_results_user_vault
            ON quiz_results(user_id, vault_id);
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_quiz_results_created
            ON quiz_results(user_id, created_at);
        """)

        # --- Spaced reading schedule ---
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS reading_schedule (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                document_id UUID NOT NULL,
                vault_id UUID NOT NULL,
                ease_factor REAL NOT NULL DEFAULT 2.5,
                interval_days INTEGER NOT NULL DEFAULT 1,
                reps INTEGER NOT NULL DEFAULT 0,
                next_review TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_read_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, document_id)
            );
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_reading_schedule_user_vault
            ON reading_schedule(user_id, vault_id);
        """)

        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_reading_schedule_next
            ON reading_schedule(user_id, next_review);
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
