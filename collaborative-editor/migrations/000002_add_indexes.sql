
CREATE INDEX IF NOT EXISTS idx_crdt_updates_document_created 
ON crdt_updates(document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crdt_updates_document_count 
ON crdt_updates(document_id);

CREATE INDEX IF NOT EXISTS idx_document_permissions_user 
ON document_permissions(user_id, document_id);

CREATE INDEX IF NOT EXISTS idx_vault_permissions_user 
ON vault_permissions(user_id, vault_id);

CREATE INDEX IF NOT EXISTS idx_documents_owner 
ON documents(owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_vault 
ON documents(vault_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_attachments_document 
ON attachments(document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_parent 
ON documents(parent_id);

CREATE INDEX IF NOT EXISTS idx_documents_folders 
ON documents(vault_id, parent_id, is_folder);

CREATE OR REPLACE FUNCTION update_document_permissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_document_permissions_updated_at ON document_permissions;
CREATE TRIGGER update_document_permissions_updated_at
    BEFORE UPDATE ON document_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_document_permissions_updated_at();

ALTER TABLE document_permissions 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

ALTER TABLE vault_permissions 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

DROP TRIGGER IF EXISTS update_vault_permissions_updated_at ON vault_permissions;
CREATE TRIGGER update_vault_permissions_updated_at
    BEFORE UPDATE ON vault_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_document_permissions_updated_at();
