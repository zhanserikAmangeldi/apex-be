-- Add AI and integration fields to scraped_content
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scraped_content' AND column_name='ai_summary') THEN
        ALTER TABLE scraped_content ADD COLUMN ai_summary TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scraped_content' AND column_name='ai_key_points') THEN
        ALTER TABLE scraped_content ADD COLUMN ai_key_points JSONB;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scraped_content' AND column_name='ai_study_notes') THEN
        ALTER TABLE scraped_content ADD COLUMN ai_study_notes TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scraped_content' AND column_name='document_id') THEN
        ALTER TABLE scraped_content ADD COLUMN document_id UUID;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scraped_content' AND column_name='is_periodic') THEN
        ALTER TABLE scraped_content ADD COLUMN is_periodic BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scraped_content' AND column_name='scrape_interval_hours') THEN
        ALTER TABLE scraped_content ADD COLUMN scrape_interval_hours INTEGER;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scraped_content' AND column_name='last_scraped_at') THEN
        ALTER TABLE scraped_content ADD COLUMN last_scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scraped_content' AND column_name='next_scrape_at') THEN
        ALTER TABLE scraped_content ADD COLUMN next_scrape_at TIMESTAMP;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scraped_content_document_id ON scraped_content(document_id);
CREATE INDEX IF NOT EXISTS idx_scraped_content_next_scrape ON scraped_content(next_scrape_at) WHERE is_periodic = true;

-- Create content_embeddings table for vector search
CREATE TABLE IF NOT EXISTS content_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES scraped_content(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_embeddings_content_id ON content_embeddings(content_id);
CREATE INDEX IF NOT EXISTS idx_content_embeddings_user_id ON content_embeddings(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_embeddings_unique ON content_embeddings(content_id, chunk_index);
