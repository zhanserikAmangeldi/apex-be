-- Add is_inline flag to distinguish connections created via inline [[links]]
-- from manually created Zettelkasten connections
ALTER TABLE notes_connections ADD COLUMN IF NOT EXISTS is_inline BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_notes_connections_inline ON notes_connections(source_note_id) WHERE is_inline = true;
