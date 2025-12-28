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
	ErrVerificationNotFound = errors.New("verification not found")
	ErrVerificationExpired  = errors.New("verification token expired")
	ErrAlreadyVerified      = errors.New("email already verified")
)

type EmailVerificationRepository struct {
	db *pgxpool.Pool
}

func NewEmailVerificationRepository(db *pgxpool.Pool) *EmailVerificationRepository {
	return &EmailVerificationRepository{db: db}
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
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVerificationNotFound
		}
		return nil, err
	}

	if ev.VerifiedAt != nil {
		return nil, ErrAlreadyVerified
	}

	if time.Now().After(ev.ExpiresAt) {
		return nil, ErrVerificationExpired
	}

	return ev, nil
}

func (r *EmailVerificationRepository) GetByUserID(ctx context.Context, userID uuid.UUID) (*models.EmailVerification, error) {
	query := `
		SELECT id, user_id, token, expires_at, created_at, verified_at
		FROM email_verifications
		WHERE user_id = $1 AND verified_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
	`

	ev := &models.EmailVerification{}
	err := r.db.QueryRow(ctx, query, userID).
		Scan(&ev.ID, &ev.UserID, &ev.Token, &ev.ExpiresAt, &ev.CreatedAt, &ev.VerifiedAt)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVerificationNotFound
		}
		return nil, err
	}

	return ev, nil
}

func (r *EmailVerificationRepository) MarkVerified(ctx context.Context, id uuid.UUID) error {
	query := `
		UPDATE email_verifications
		SET verified_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`

	result, err := r.db.Exec(ctx, query, id)
	if err != nil {
		return err
	}

	if result.RowsAffected() == 0 {
		return ErrVerificationNotFound
	}

	return nil
}

func (r *EmailVerificationRepository) DeleteByUserID(ctx context.Context, userID uuid.UUID) error {
	query := `DELETE FROM email_verifications WHERE user_id = $1`
	_, err := r.db.Exec(ctx, query, userID)
	return err
}

func (r *EmailVerificationRepository) DeleteExpired(ctx context.Context) (int64, error) {
	query := `
		DELETE FROM email_verifications
		WHERE expires_at < NOW() AND verified_at IS NULL
	`

	result, err := r.db.Exec(ctx, query)
	if err != nil {
		return 0, err
	}

	return result.RowsAffected(), nil
}
