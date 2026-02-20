package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/models"
)

var (
	ErrSessionNotFound = errors.New("session not found")
	ErrSessionExpired  = errors.New("session expired")
	ErrSessionRevoked  = errors.New("session revoked")
)

type SessionRepository struct {
	db *pgxpool.Pool
}

func NewSessionRepository(db *pgxpool.Pool) *SessionRepository {
	return &SessionRepository{db: db}
}

func (r *SessionRepository) Create(ctx context.Context, session *models.Session) error {
	query := `
		INSERT INTO sessions (user_id, refresh_token, access_token, user_agent, ip_address, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at
	`

	err := r.db.QueryRow(ctx, query,
		session.UserID,
		session.RefreshToken,
		session.AccessToken,
		session.UserAgent,
		session.IPAddress,
		session.ExpiresAt,
	).Scan(&session.ID, &session.CreatedAt)

	return err
}

func (r *SessionRepository) GetByRefreshToken(ctx context.Context, refreshToken string) (*models.Session, error) {
	query := `
		SELECT id, user_id, refresh_token, access_token, user_agent, ip_address::text, 
		       expires_at, created_at, revoked_at
		FROM sessions
		WHERE refresh_token = $1
	`

	session := &models.Session{}
	err := r.db.QueryRow(ctx, query, refreshToken).Scan(
		&session.ID,
		&session.UserID,
		&session.RefreshToken,
		&session.AccessToken,
		&session.UserAgent,
		&session.IPAddress,
		&session.ExpiresAt,
		&session.CreatedAt,
		&session.RevokedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}

	if session.RevokedAt != nil {
		return nil, ErrSessionRevoked
	}

	if time.Now().After(session.ExpiresAt) {
		return nil, ErrSessionExpired
	}

	return session, nil
}

func (r *SessionRepository) GetAllByUserID(ctx context.Context, userID uuid.UUID) ([]*models.Session, error) {
	query := `
		SELECT id, user_id, refresh_token, access_token, user_agent, ip_address::text,
		       expires_at, created_at, revoked_at
		FROM sessions
		WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
		ORDER BY created_at DESC
	`

	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*models.Session
	for rows.Next() {
		session := &models.Session{}
		err := rows.Scan(
			&session.ID,
			&session.UserID,
			&session.RefreshToken,
			&session.AccessToken,
			&session.UserAgent,
			&session.IPAddress,
			&session.ExpiresAt,
			&session.CreatedAt,
			&session.RevokedAt,
		)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}

	return sessions, nil
}

func (r *SessionRepository) Revoke(ctx context.Context, refreshToken string) error {
	query := `
		UPDATE sessions
		SET revoked_at = CURRENT_TIMESTAMP
		WHERE refresh_token = $1 AND revoked_at IS NULL
	`

	result, err := r.db.Exec(ctx, query, refreshToken)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrSessionNotFound
	}

	return nil
}

func (r *SessionRepository) RevokeByID(ctx context.Context, sessionID uuid.UUID) error {
	query := `
		UPDATE sessions
		SET revoked_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND revoked_at IS NULL
	`

	result, err := r.db.Exec(ctx, query, sessionID)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrSessionNotFound
	}

	return nil
}

func (r *SessionRepository) RevokeAllByUserID(ctx context.Context, userID uuid.UUID) error {
	query := `
		UPDATE sessions
		SET revoked_at = CURRENT_TIMESTAMP
		WHERE user_id = $1 AND revoked_at IS NULL
	`

	_, err := r.db.Exec(ctx, query, userID)
	return err
}

func (r *SessionRepository) UpdateAccessToken(ctx context.Context, refreshToken, newAccessToken string) error {
	query := `
		UPDATE sessions
		SET access_token = $2
		WHERE refresh_token = $1 AND revoked_at IS NULL
	`

	result, err := r.db.Exec(ctx, query, refreshToken, newAccessToken)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrSessionNotFound
	}

	return nil
}

func (r *SessionRepository) DeleteExpired(ctx context.Context) (int64, error) {
	query := `
		DELETE FROM sessions
		WHERE expires_at < NOW() - INTERVAL '30 days'
	`

	result, err := r.db.Exec(ctx, query)
	if err != nil {
		return 0, err
	}

	return result.RowsAffected(), nil
}

func (r *SessionRepository) CountByUserID(ctx context.Context, userID uuid.UUID) (int, error) {
	query := `
		SELECT COUNT(*) 
		FROM sessions 
		WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
	`

	var count int
	err := r.db.QueryRow(ctx, query, userID).Scan(&count)
	return count, err
}
