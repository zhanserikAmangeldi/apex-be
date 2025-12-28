package models

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID           uuid.UUID  `json:"id"`
	Username     string     `json:"username"`
	Email        string     `json:"email"`
	PasswordHash string     `json:"-"`
	DisplayName  *string    `json:"display_name,omitempty"`
	AvatarURL    *string    `json:"avatar_url,omitempty"`
	Bio          *string    `json:"bio,omitempty"`
	Status       string     `json:"status"`
	IsVerified   bool       `json:"is_verified"`
	LastSeenAt   *time.Time `json:"last_seen_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type PublicUser struct {
	ID          uuid.UUID  `json:"id"`
	Username    string     `json:"username"`
	DisplayName *string    `json:"display_name,omitempty"`
	AvatarURL   *string    `json:"avatar_url,omitempty"`
	Bio         *string    `json:"bio,omitempty"`
	Status      string     `json:"status"`
	LastSeenAt  *time.Time `json:"last_seen_at,omitempty"`
}

func (u *User) ToPublic() *PublicUser {
	return &PublicUser{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
		Bio:         u.Bio,
		Status:      u.Status,
		LastSeenAt:  u.LastSeenAt,
	}
}
