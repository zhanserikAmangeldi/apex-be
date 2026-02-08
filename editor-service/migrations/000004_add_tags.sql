-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) DEFAULT '#3B82F6',
    vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, vault_id)
);

-- Create document_tags junction table
CREATE TABLE IF NOT EXISTS document_tags (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, tag_id)
);

-- Create indexes for better query performance
CREATE INDEX idx_tags_vault_id ON tags(vault_id);
CREATE INDEX idx_document_tags_document_id ON document_tags(document_id);
CREATE INDEX idx_document_tags_tag_id ON document_tags(tag_id);
