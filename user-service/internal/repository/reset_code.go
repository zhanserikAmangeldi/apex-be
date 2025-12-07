package repository

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

var ErrResetCodeNotFound = errors.New("reset code not found")
var ErrResetCodeExpired = errors.New("reset code expired")

type ResetCodeRepository struct {
	db *pgxpool.Pool
}

func NewResetCodeRepository(db *pgxpool.Pool) *ResetCodeRepository {
	return &ResetCodeRepository{db: db}
}

func (r *ResetCodeRepository) Create(ctx context.Context, email, code string, expiresAt time.Time) error {
	query := `
		INSERT INTO reset_codes (email, code, expires_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (email) 
		DO UPDATE SET code = $2, expires_at = $3, created_at = CURRENT_TIMESTAMP
	`

	_, err := r.db.Exec(ctx, query, email, code, expiresAt)
	return err
}

func (r *ResetCodeRepository) Verify(ctx context.Context, email, code string) error {
	query := `
		SELECT expires_at
		FROM reset_codes
		WHERE email = $1 AND code = $2
	`

	var expiresAt time.Time
	err := r.db.QueryRow(ctx, query, email, code).Scan(&expiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrResetCodeNotFound
		}
		return err
	}

	if time.Now().After(expiresAt) {
		return ErrResetCodeExpired
	}

	return nil
}

func (r *ResetCodeRepository) Delete(ctx context.Context, email string) error {
	query := `DELETE FROM reset_codes WHERE email = $1`
	_, err := r.db.Exec(ctx, query, email)
	return err
}

