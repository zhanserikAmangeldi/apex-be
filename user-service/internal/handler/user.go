package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/dto"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/middleware"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/repository"
)

type UserHandler struct {
	userRepo *repository.UserRepository
}

func NewUserHandler(userRepo *repository.UserRepository) *UserHandler {
	return &UserHandler{userRepo: userRepo}
}

// GetMe godoc
// @Summary Get current user profile
// @Tags users
// @Security BearerAuth
// @Success 200 {object} models.User
// @Failure 401 {object} dto.ErrorResponse
// @Failure 404 {object} dto.ErrorResponse
// @Router /api/v1/users/me [get]
func (h *UserHandler) GetMe(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	user, err := h.userRepo.GetByID(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, dto.NewErrorResponse("user_not_found", "User not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", ""))
		return
	}

	c.JSON(http.StatusOK, user)
}

// UpdateMe godoc
// @Summary Update current user profile
// @Tags users
// @Security BearerAuth
// @Accept json
// @Produce json
// @Param request body dto.UpdateUserRequest true "Update data"
// @Success 200 {object} models.User
// @Failure 400 {object} dto.ErrorResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/users/me [put]
func (h *UserHandler) UpdateMe(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	var req dto.UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", err.Error()))
		return
	}

	user, err := h.userRepo.GetByID(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, dto.NewErrorResponse("user_not_found", ""))
			return
		}
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", ""))
		return
	}

	// Apply updates
	if req.DisplayName != nil {
		user.DisplayName = req.DisplayName
	}
	if req.Bio != nil {
		user.Bio = req.Bio
	}
	if req.Status != nil {
		user.Status = *req.Status
	}

	if err := h.userRepo.Update(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", ""))
		return
	}

	c.JSON(http.StatusOK, user)
}

// GetUserByID godoc
// @Summary Get user by ID
// @Tags users
// @Security BearerAuth
// @Param id path string true "User ID" format(uuid)
// @Success 200 {object} models.PublicUser
// @Failure 400 {object} dto.ErrorResponse
// @Failure 404 {object} dto.ErrorResponse
// @Router /api/v1/users/{id} [get]
func (h *UserHandler) GetUserByID(c *gin.Context) {
	idParam := c.Param("id")
	userID, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", "Invalid user ID format"))
		return
	}

	user, err := h.userRepo.GetByID(c.Request.Context(), userID)
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, dto.NewErrorResponse("user_not_found", "User not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", ""))
		return
	}

	// Return public user info only
	c.JSON(http.StatusOK, user.ToPublic())
}

// DeleteMe godoc
// @Summary Delete current user account
// @Tags users
// @Security BearerAuth
// @Success 200 {object} dto.SuccessResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/users/me [delete]
func (h *UserHandler) DeleteMe(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	if err := h.userRepo.Delete(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to delete account"))
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Message: "Account deleted successfully"})
}
