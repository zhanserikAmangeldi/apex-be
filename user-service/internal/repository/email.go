package repository

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/models"
	"time"
)

var (
	ErrInvalidOrExpiredToken = errors.New("invalid or expired verification token")
)

type EmailVerificationRepository struct {
	db *pgxpool.Pool
}

func NewEmailVerificationRepository(db *pgxpool.Pool) *EmailVerificationRepository {
	return &EmailVerificationRepository{
		db: db,
	}
}

func (r *EmailVerificationRepository) Create(ctx context.Context, ev *models.EmailVerification) error {
	query := `
		INSERT INTO email_verifications (user_id, token, expires_at)
		VALUES ($1, $2, $3)
		RETURNING id, created_at
	`
	return r.db.QueryRow(ctx, query, ev.UserID, ev.Token, ev.ExpiresAt).
		Scan(&ev.ID, &ev.CreatedAt)
}

func (r *EmailVerificationRepository) GetByToken(ctx context.Context, token string) (*models.EmailVerification, error) {
	query := `
		SELECT id, user_id, token, expires_at, created_at, verified_at
		FROM email_verifications
		WHERE token = $1
	`
	ev := &models.EmailVerification{}
	err := r.db.QueryRow(ctx, query, token).
		Scan(&ev.ID, &ev.UserID, &ev.Token, &ev.ExpiresAt, &ev.CreatedAt, &ev.VerifiedAt)
	if err != nil {
		return nil, ErrInvalidOrExpiredToken
	}
	if time.Now().After(ev.ExpiresAt) {
		return nil, ErrInvalidOrExpiredToken
	}
	return ev, nil
}

func (r *EmailVerificationRepository) MarkVerified(ctx context.Context, id int64) error {
	query := `
		UPDATE email_verifications
		SET verified_at = NOW()
		WHERE id = $1
	`
	_, err := r.db.Exec(ctx, query, id)
	return err
}
