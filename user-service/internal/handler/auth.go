package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/dto"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/middleware"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/service"
)

type AuthHandler struct {
	authService *service.AuthService
}

func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

// Register godoc
// @Summary Register a new user
// @Tags auth
// @Accept json
// @Produce json
// @Param request body dto.RegisterRequest true "Registration data"
// @Success 201 {object} dto.AuthResponse
// @Failure 400 {object} dto.ErrorResponse
// @Failure 409 {object} dto.ErrorResponse
// @Router /api/v1/auth/register [post]
func (h *AuthHandler) Register(c *gin.Context) {
	var req dto.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", err.Error()))
		return
	}

	userAgent, ipAddress := getClientInfo(c)
	authResp, err := h.authService.Register(c.Request.Context(), &req, userAgent, ipAddress)
	if err != nil {
		if errors.Is(err, service.ErrUserAlreadyExists) {
			c.JSON(http.StatusConflict, dto.NewErrorResponseWithCode(
				"user_exists",
				"User with this email or username already exists",
				"USER_EXISTS",
			))
			return
		}
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to register user"))
		return
	}

	c.JSON(http.StatusCreated, authResp)
}

// Login godoc
// @Summary Login user
// @Tags auth
// @Accept json
// @Produce json
// @Param request body dto.LoginRequest true "Login credentials"
// @Success 200 {object} dto.AuthResponse
// @Failure 400 {object} dto.ErrorResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/auth/login [post]
func (h *AuthHandler) Login(c *gin.Context) {
	var req dto.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", err.Error()))
		return
	}

	userAgent, ipAddress := getClientInfo(c)
	authResp, err := h.authService.Login(c.Request.Context(), &req, userAgent, ipAddress)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			c.JSON(http.StatusUnauthorized, dto.NewErrorResponse(
				"invalid_credentials",
				"Invalid email/username or password",
			))
			return
		}
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to login"))
		return
	}

	c.JSON(http.StatusOK, authResp)
}

// Logout godoc
// @Summary Logout user
// @Tags auth
// @Accept json
// @Produce json
// @Param request body dto.LogoutRequest true "Tokens to revoke"
// @Success 200 {object} dto.SuccessResponse
// @Failure 400 {object} dto.ErrorResponse
// @Router /api/v1/auth/logout [post]
func (h *AuthHandler) Logout(c *gin.Context) {
	var req dto.LogoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", err.Error()))
		return
	}

	if err := h.authService.Logout(c.Request.Context(), req.RefreshToken, req.AccessToken); err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to logout"))
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Message: "Logged out successfully"})
}

// RefreshToken godoc
// @Summary Refresh access token
// @Tags auth
// @Accept json
// @Produce json
// @Param request body dto.RefreshTokenRequest true "Refresh token"
// @Success 200 {object} dto.AuthResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/auth/refresh [post]
func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req dto.RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", err.Error()))
		return
	}

	userAgent, ipAddress := getClientInfo(c)
	authResp, err := h.authService.RefreshToken(c.Request.Context(), req.RefreshToken, userAgent, ipAddress)
	if err != nil {
		status := http.StatusUnauthorized
		code := "INVALID_TOKEN"

		if errors.Is(err, service.ErrTokenExpired) {
			code = "TOKEN_EXPIRED"
		} else if errors.Is(err, service.ErrSessionRevoked) {
			code = "SESSION_REVOKED"
		}

		c.JSON(status, dto.NewErrorResponseWithCode("invalid_token", err.Error(), code))
		return
	}

	c.JSON(http.StatusOK, authResp)
}

// LogoutAll godoc
// @Summary Logout from all devices
// @Tags auth
// @Security BearerAuth
// @Success 200 {object} dto.SuccessResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/auth/logout-all [post]
func (h *AuthHandler) LogoutAll(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	if err := h.authService.LogoutAll(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to logout from all devices"))
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Message: "Logged out from all devices successfully"})
}

// GetActiveSessions godoc
// @Summary Get all active sessions
// @Tags auth
// @Security BearerAuth
// @Param current_token query string false "Current refresh token to mark current session"
// @Success 200 {object} models.SessionListResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/auth/sessions [get]
func (h *AuthHandler) GetActiveSessions(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	currentRefreshToken := c.Query("current_token")

	sessions, err := h.authService.GetActiveSessions(c.Request.Context(), userID, currentRefreshToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to get sessions"))
		return
	}

	c.JSON(http.StatusOK, sessions)
}

// VerifyEmail godoc
// @Summary Verify email address
// @Tags auth
// @Param token query string true "Verification token"
// @Success 200 {object} dto.SuccessResponse
// @Failure 400 {object} dto.ErrorResponse
// @Router /verify-email [get]
func (h *AuthHandler) VerifyEmail(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", "Token is required"))
		return
	}

	if err := h.authService.VerifyEmail(c.Request.Context(), token); err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("verification_failed", err.Error()))
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Message: "Email verified successfully"})
}

// ResendVerificationEmail godoc
// @Summary Resend verification email
// @Tags auth
// @Security BearerAuth
// @Success 200 {object} dto.SuccessResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/auth/resend-verification [post]
func (h *AuthHandler) ResendVerificationEmail(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	if err := h.authService.ResendVerificationEmail(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("resend_failed", err.Error()))
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Message: "Verification email sent"})
}

func getClientInfo(c *gin.Context) (*string, *string) {
	userAgent := c.Request.UserAgent()
	ip := c.ClientIP()

	var userAgentPtr, ipPtr *string
	if userAgent != "" {
		userAgentPtr = &userAgent
	}
	if ip != "" {
		ipPtr = &ip
	}

	return userAgentPtr, ipPtr
}
