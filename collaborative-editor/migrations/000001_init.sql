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

CREATE TABLE IF NOT EXISTS vaults (
                                      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                      owner_id BIGINT NOT NULL,
                                      name TEXT NOT NULL,
                                      description TEXT,
                                      icon TEXT DEFAULT '📁',
                                      color TEXT DEFAULT '#6366f1',
                                      created_at TIMESTAMP DEFAULT NOW(),
                                      updated_at TIMESTAMP DEFAULT NOW(),
                                      is_deleted BOOLEAN DEFAULT FALSE,
                                      settings JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS vault_permissions (
                                                 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                 vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
                                                 user_id BIGINT NOT NULL,
                                                 permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
                                                 created_at TIMESTAMP DEFAULT NOW(),
                                                 UNIQUE(vault_id, user_id)
);

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS vault_id UUID REFERENCES vaults(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS is_folder BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS path TEXT,
    ADD COLUMN IF NOT EXISTS icon TEXT;

DROP TRIGGER IF EXISTS update_vaults_updated_at ON vaults;
CREATE TRIGGER update_vaults_updated_at
    BEFORE UPDATE ON vaults
    FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION get_document_path(doc_id UUID)
    RETURNS TEXT AS $$
DECLARE
    result TEXT := '';
    current_id UUID := doc_id;
    current_title TEXT;
    current_parent UUID;
BEGIN
    LOOP
        SELECT title, parent_id INTO current_title, current_parent
        FROM documents
        WHERE id = current_id;

        IF current_title IS NULL THEN
            EXIT;
        END IF;

        IF result = '' THEN
            result := current_title;
        ELSE
            result := current_title || '/' || result;
        END IF;

        IF current_parent IS NULL THEN
            EXIT;
        END IF;

        current_id := current_parent;
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

