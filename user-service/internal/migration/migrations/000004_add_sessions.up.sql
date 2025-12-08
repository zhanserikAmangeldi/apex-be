CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token VARCHAR(500) UNIQUE NOT NULL,
    access_token VARCHAR(500) NOT NULL,
    user_agent VARCHAR(500),
    ip_address INET,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT sessions_tokens_not_empty CHECK (
        char_length(refresh_token) > 0 AND
        char_length(access_token) > 0
    )
);