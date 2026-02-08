CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS vaults (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(10) DEFAULT '📁',
    color VARCHAR(7) DEFAULT '#6366f1',
    settings JSONB DEFAULT '{}',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL,
    vault_id UUID REFERENCES vaults(id) ON DELETE SET NULL,
    parent_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL DEFAULT 'Untitled Document',
    icon VARCHAR(10),
    is_folder BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    last_snapshot_at TIMESTAMP WITH TIME ZONE,
    snapshot_storage VARCHAR(10) CHECK (snapshot_storage IN ('pg', 'minio')),
    snapshot_size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_documents_owner_id ON documents(owner_id) WHERE is_deleted = false;
CREATE INDEX idx_documents_vault_id ON documents(vault_id) WHERE is_deleted = false;
CREATE INDEX idx_documents_parent_id ON documents(parent_id) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crdt_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    snapshot BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_crdt_snapshots_document_id ON crdt_snapshots(document_id);

CREATE TABLE IF NOT EXISTS crdt_updates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    update_data BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_crdt_updates_document_id ON crdt_updates(document_id);
CREATE INDEX idx_crdt_updates_created_at ON crdt_updates(created_at);
CREATE INDEX idx_crdt_updates_document_created ON crdt_updates(document_id, created_at);

CREATE TABLE IF NOT EXISTS vault_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    permission VARCHAR(20) NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vault_id, user_id)
);

CREATE INDEX idx_vault_permissions_vault_id ON vault_permissions(vault_id);
CREATE INDEX idx_vault_permissions_user_id ON vault_permissions(user_id);

CREATE TABLE IF NOT EXISTS document_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    permission VARCHAR(20) NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, user_id)
);

CREATE TABLE IF NOT EXISTS attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    filename VARCHAR(500) NOT NULL,
    minio_path VARCHAR(1000) NOT NULL,
    content_type VARCHAR(255),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    uploaded_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_vaults_updated_at
    BEFORE UPDATE ON vaults
    FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_crdt_snapshots_updated_at
    BEFORE UPDATE ON crdt_snapshots
    FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
