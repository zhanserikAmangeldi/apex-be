package handler

import (
	"net/http"
	"log"
	"github.com/gin-gonic/gin"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/dto"
)

// @Summary Github Login
// @Description Login with Github OAuth code
// @Tags auth
// @Accept json
// @Produce json
// @Param input body dto.GithubLoginRequest true "Github Login Request"
// @Success 200 {object} dto.AuthResponse
// @Failure 400 {object} dto.ErrorResponse
// @Failure 500 {object} dto.ErrorResponse
// @Router /auth/github [post]
func (h *AuthHandler) GithubLogin(c *gin.Context) {
	var req dto.GithubLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{
			Error:   "validation_error",
			Message: err.Error(),
		})
		return
	}

	userAgent, ip := getClientInfo(c)
	authResp, err := h.authService.GithubLogin(c.Request.Context(), req.Code, userAgent, ip)
	if err != nil {
		log.Printf("GithubLogin error: %v", err)
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{
			Error:   "internal_error",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, authResp)
}
