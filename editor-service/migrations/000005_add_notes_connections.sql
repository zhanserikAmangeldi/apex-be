-- Notes connections table for explicit Zettelkasten links
CREATE TABLE IF NOT EXISTS notes_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_note_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    target_note_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    connection_type VARCHAR(50) NOT NULL DEFAULT 'related',
    description TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_note_id, target_note_id),
    CHECK (source_note_id != target_note_id)
);

CREATE INDEX idx_notes_connections_source ON notes_connections(source_note_id);
CREATE INDEX idx_notes_connections_target ON notes_connections(target_note_id);
CREATE INDEX idx_notes_connections_type ON notes_connections(connection_type);
CREATE INDEX idx_notes_connections_created_by ON notes_connections(created_by);

-- Trigger for updated_at
CREATE TRIGGER update_notes_connections_updated_at
    BEFORE UPDATE ON notes_connections
    FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
