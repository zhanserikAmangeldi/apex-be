CREATE INDEX IF NOT EXISTS idx_document_permissions_document_id ON document_permissions(document_id);
CREATE INDEX IF NOT EXISTS idx_document_permissions_user_id ON document_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_document_permissions_document_user ON document_permissions(document_id, user_id);

CREATE INDEX IF NOT EXISTS idx_attachments_document_id ON attachments(document_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at DESC);
