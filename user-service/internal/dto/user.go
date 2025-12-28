package dto

import (
	"github.com/google/uuid"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/models"
)

type RegisterRequest struct {
	Username    string `json:"username" binding:"required,min=3,max=50"`
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=8,max=32"`
	DisplayName string `json:"display_name,omitempty" binding:"max=100"`
}

type LoginRequest struct {
	Login    string `json:"login" binding:"required"` // email or username
	Password string `json:"password" binding:"required"`
}

type AuthResponse struct {
	AccessToken  string       `json:"access_token"`
	RefreshToken string       `json:"refresh_token"`
	ExpiresIn    int64        `json:"expires_in"`
	User         *models.User `json:"user"`
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type LogoutRequest struct {
	AccessToken  string `json:"access_token" binding:"required"`
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type UpdateUserRequest struct {
	DisplayName *string `json:"display_name,omitempty" binding:"omitempty,max=100"`
	Bio         *string `json:"bio,omitempty" binding:"omitempty,max=500"`
	Status      *string `json:"status,omitempty" binding:"omitempty,oneof=online offline away busy"`
}

type UserResponse struct {
	ID          uuid.UUID `json:"id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"display_name,omitempty"`
	AvatarURL   *string   `json:"avatar_url,omitempty"`
	Bio         *string   `json:"bio,omitempty"`
	Status      string    `json:"status"`
	IsVerified  bool      `json:"is_verified"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
	Code    string `json:"code,omitempty"`
}

func NewErrorResponse(err, message string) ErrorResponse {
	return ErrorResponse{
		Error:   err,
		Message: message,
	}
}

func NewErrorResponseWithCode(err, message, code string) ErrorResponse {
	return ErrorResponse{
		Error:   err,
		Message: message,
		Code:    code,
	}
}

type SuccessResponse struct {
	Message string `json:"message"`
}

type IDResponse struct {
	ID uuid.UUID `json:"id"`
}
