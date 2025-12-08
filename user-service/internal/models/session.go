package models

import "time"

type SessionInfo struct {
	ID        int64     `json:"id"`
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
