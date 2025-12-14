CREATE TABLE IF NOT EXISTS documents (
                                         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                         owner_id BIGINT,
                                         title TEXT NOT NULL DEFAULT 'Untitled Document',
                                         created_at TIMESTAMP DEFAULT NOW(),
                                         updated_at TIMESTAMP DEFAULT NOW(),
                                         last_snapshot_at TIMESTAMP,
                                         snapshot_size_bytes BIGINT DEFAULT 0,
                                         snapshot_storage TEXT DEFAULT 'pg', -- 'pg' or 'minio'
                                         is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS crdt_snapshots (
                                              document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
                                              snapshot BYTEA NOT NULL,
                                              created_at TIMESTAMP DEFAULT NOW(),
                                              updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crdt_updates (
                                            id BIGSERIAL PRIMARY KEY,
                                            document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                                            update_data BYTEA NOT NULL,
                                            created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attachments (
                                           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                           document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
                                           owner_id BIGINT,
                                           filename TEXT NOT NULL,
                                           mime_type TEXT,
                                           size_bytes BIGINT NOT NULL,
                                           minio_path TEXT NOT NULL,
                                           created_at TIMESTAMP DEFAULT NOW(),
                                           is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS document_permissions (
                                                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                                                    user_id BIGINT NOT NULL,
                                                    permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
                                                    created_at TIMESTAMP DEFAULT NOW(),
                                                    UNIQUE(document_id, user_id)
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

