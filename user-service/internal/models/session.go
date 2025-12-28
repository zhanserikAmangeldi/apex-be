package models

import (
	"time"

	"github.com/google/uuid"
)

type Session struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"user_id"`
	RefreshToken string     `json:"-"`
	AccessToken  string     `json:"-"`
	UserAgent    *string    `json:"user_agent,omitempty"`
	IPAddress    *string    `json:"ip_address,omitempty"`
	ExpiresAt    time.Time  `json:"expires_at"`
	CreatedAt    time.Time  `json:"created_at"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
}

type SessionInfo struct {
	ID        uuid.UUID `json:"id"`
	UserAgent *string   `json:"user_agent,omitempty"`
	IPAddress *string   `json:"ip_address,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	IsCurrent bool      `json:"is_current"`
}

type SessionListResponse struct {
	Sessions []*SessionInfo `json:"sessions"`
	Total    int            `json:"total"`
}
