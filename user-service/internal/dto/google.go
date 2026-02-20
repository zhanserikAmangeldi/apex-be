package dto

type GoogleLoginRequest struct {
	Code string `json:"code" binding:"required"`
}
