package dto

type GithubLoginRequest struct {
	Code string `json:"code" binding:"required"`
}
