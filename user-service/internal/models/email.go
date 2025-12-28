package models

import (
	"github.com/google/uuid"
	"time"
)

type EmailVerification struct {
	ID         uuid.UUID  `json:"id"`
	UserID     uuid.UUID  `json:"user_id"`
	Token      string     `json:"token"`
	ExpiresAt  time.Time  `json:"expires_at"`
	CreatedAt  time.Time  `json:"created_at"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
}
