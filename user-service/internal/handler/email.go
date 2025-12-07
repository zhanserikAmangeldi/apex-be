package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/service"
	"net/http"
)

type EmailVerificationHandler struct {
	authService *service.AuthService
}

func NewEmailVerificationHandler(authService *service.AuthService) *EmailVerificationHandler {
	return &EmailVerificationHandler{authService: authService}
}

func (h *EmailVerificationHandler) VerifyEmail(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no token provided"})
		return
	}

	err := h.authService.VerifyEmail(c.Request.Context(), token)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "email verified successfully"})
}
