-- Create user_site_sessions table
CREATE TABLE IF NOT EXISTS user_site_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    domain VARCHAR(255) NOT NULL,
    encrypted_cookies TEXT NOT NULL,
    encrypted_local_storage TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_site_sessions_user_id ON user_site_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_site_sessions_domain ON user_site_sessions(domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_site_sessions_user_domain ON user_site_sessions(user_id, domain);

-- Create scraped_content table
CREATE TABLE IF NOT EXISTS scraped_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    url TEXT NOT NULL,
    domain VARCHAR(255) NOT NULL,
    title TEXT,
    content TEXT,
    html TEXT,
    content_metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scraped_content_user_id ON scraped_content(user_id);
CREATE INDEX IF NOT EXISTS idx_scraped_content_domain ON scraped_content(domain);
CREATE INDEX IF NOT EXISTS idx_scraped_content_created_at ON scraped_content(created_at DESC);
