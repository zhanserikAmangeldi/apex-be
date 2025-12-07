package models

import "time"

type EmailVerification struct {
	ID         int64
	UserID     int64
	Token      string
	ExpiresAt  time.Time
	CreatedAt  time.Time
	VerifiedAt *time.Time
}
