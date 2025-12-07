package handler

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/dto"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/service"
	"net/http"
)

type AuthHandler struct {
	authService *service.AuthService
}

func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req dto.RegisterUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{
			Error:   "validation_error",
			Message: err.Error(),
		})
		return
	}

	authResp, err := h.authService.Register(c.Request.Context(), &req)
	if err != nil {
		if errors.Is(err, service.ErrAlreadyUserExists) {
			c.JSON(http.StatusUnauthorized, dto.ErrorResponse{
				Error:   "user_exists",
				Message: "User with this email or username already exists",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{
			Error:   "internal_server",
			Message: "Failed to register user",
		})
		return
	}

	c.JSON(http.StatusCreated, authResp)
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req dto.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{
			Error:   "validation_error",
			Message: err.Error(),
		})
		return
	}

	authResp, err := h.authService.Login(c.Request.Context(), &req)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			c.JSON(http.StatusUnauthorized, dto.ErrorResponse{
				Error:   "invalid_credentials",
				Message: "Invalid email/username or password",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{
			Error:   "internal_error",
			Message: "Failed to login",
		})
		return
	}

	c.JSON(http.StatusOK, authResp)
}

func (h *AuthHandler) RequestResetCode(c *gin.Context) {
	var req dto.RequestResetCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{
			Error:   "validation_error",
			Message: err.Error(),
		})
		return
	}

	err := h.authService.RequestResetCode(c.Request.Context(), &req)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			c.JSON(http.StatusNotFound, dto.ErrorResponse{
				Error:   "user_not_found",
				Message: "User with this email not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{
			Error:   "internal_error",
			Message: "Failed to send reset code",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Reset code sent to your email",
	})
}

func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req dto.ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{
			Error:   "validation_error",
			Message: err.Error(),
		})
		return
	}

	err := h.authService.ResetPassword(c.Request.Context(), &req)
	if err != nil {
		if errors.Is(err, service.ErrInvalidCredentials) {
			c.JSON(http.StatusNotFound, dto.ErrorResponse{
				Error:   "user_not_found",
				Message: "User with this email not found",
			})
			return
		}
		if errors.Is(err, service.ErrResetCodeInvalid) {
			c.JSON(http.StatusBadRequest, dto.ErrorResponse{
				Error:   "invalid_code",
				Message: "Invalid reset code",
			})
			return
		}
		if errors.Is(err, service.ErrResetCodeExpired) {
			c.JSON(http.StatusBadRequest, dto.ErrorResponse{
				Error:   "expired_code",
				Message: "Reset code has expired",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{
			Error:   "internal_error",
			Message: "Failed to reset password",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Password reset successfully",
	})
}
