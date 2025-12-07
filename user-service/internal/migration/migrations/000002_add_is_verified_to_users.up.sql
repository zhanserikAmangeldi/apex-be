ALTER TABLE users
    ADD COLUMN is_verified BOOLEAN;
UPDATE users SET is_verified = FALSE;
ALTER TABLE users ALTER COLUMN is_verified SET DEFAULT FALSE;