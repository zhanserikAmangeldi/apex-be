package handler

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/dto"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/middleware"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/repository"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/service"
)

const (
	MaxAvatarSize     = 5 << 20 // 5 MB
	AvatarContentType = "image/"
)

var allowedAvatarExtensions = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".gif":  true,
	".webp": true,
}

type AvatarHandler struct {
	minioService *service.MinioService
	userRepo     *repository.UserRepository
}

func NewAvatarHandler(minioService *service.MinioService, userRepo *repository.UserRepository) *AvatarHandler {
	return &AvatarHandler{
		minioService: minioService,
		userRepo:     userRepo,
	}
}

// UploadAvatar godoc
// @Summary Upload user avatar
// @Tags users
// @Security BearerAuth
// @Accept multipart/form-data
// @Produce json
// @Param avatar formance file true "Avatar image"
// @Success 200 {object} map[string]string
// @Failure 400 {object} dto.ErrorResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/users/upload-avatar [post]
func (h *AvatarHandler) UploadAvatar(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	fileHeader, err := c.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", "Avatar file is required"))
		return
	}

	if fileHeader.Size > MaxAvatarSize {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", "Avatar file is too large (max 5MB)"))
		return
	}

	contentType := fileHeader.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, AvatarContentType) {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", "Invalid file type. Only images are allowed"))
		return
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if !allowedAvatarExtensions[ext] {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", "Invalid file extension"))
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to open file"))
		return
	}
	defer file.Close()

	objectName := fmt.Sprintf("%s/avatar%s", userID.String(), ext)

	h.deleteOldAvatars(c, userID)

	if err := h.minioService.UploadFile(
		c.Request.Context(),
		service.AvatarsBucket,
		objectName,
		file,
		fileHeader.Size,
		contentType,
	); err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to upload avatar"))
		return
	}

	if err := h.userRepo.UpdateAvatar(c.Request.Context(), userID, objectName); err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to update user avatar"))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Avatar uploaded successfully",
		"path":    objectName,
	})
}

// GetAvatar godoc
// @Summary Get current user's avatar
// @Tags users
// @Security BearerAuth
// @Produce image/*
// @Success 200 {file} binary
// @Failure 401 {object} dto.ErrorResponse
// @Failure 404 {object} dto.ErrorResponse
// @Router /api/v1/users/avatar [get]
func (h *AvatarHandler) GetAvatar(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	avatarPath, err := h.userRepo.GetAvatarURL(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to get avatar path"))
		return
	}

	if avatarPath == "" {
		c.JSON(http.StatusNotFound, dto.NewErrorResponse("not_found", "Avatar not found"))
		return
	}

	h.serveAvatar(c, avatarPath)
}

// GetUserAvatar godoc
// @Summary Get user's avatar by ID
// @Tags users
// @Param id path string true "User ID" format(uuid)
// @Produce image/*
// @Success 200 {file} binary
// @Failure 404 {object} dto.ErrorResponse
// @Router /api/v1/users/{id}/avatar [get]
func (h *AvatarHandler) GetUserAvatar(c *gin.Context) {
	idParam := c.Param("id")
	userID, err := uuid.Parse(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.NewErrorResponse("validation_error", "Invalid user ID"))
		return
	}

	avatarPath, err := h.userRepo.GetAvatarURL(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, dto.NewErrorResponse("not_found", "User not found"))
		return
	}

	if avatarPath == "" {
		c.JSON(http.StatusNotFound, dto.NewErrorResponse("not_found", "Avatar not found"))
		return
	}

	h.serveAvatar(c, avatarPath)
}

// DeleteAvatar godoc
// @Summary Delete current user's avatar
// @Tags users
// @Security BearerAuth
// @Success 200 {object} dto.SuccessResponse
// @Failure 401 {object} dto.ErrorResponse
// @Router /api/v1/users/avatar [delete]
func (h *AvatarHandler) DeleteAvatar(c *gin.Context) {
	userID, ok := middleware.GetUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.NewErrorResponse("unauthorized", ""))
		return
	}

	avatarPath, err := h.userRepo.GetAvatarURL(c.Request.Context(), userID)
	if err != nil || avatarPath == "" {
		c.JSON(http.StatusNotFound, dto.NewErrorResponse("not_found", "Avatar not found"))
		return
	}

	if err := h.minioService.DeleteFile(c.Request.Context(), service.AvatarsBucket, avatarPath); err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", "Failed to delete avatar"))
		return
	}

	if err := h.userRepo.UpdateAvatar(c.Request.Context(), userID, ""); err != nil {
		c.JSON(http.StatusInternalServerError, dto.NewErrorResponse("internal_error", ""))
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Message: "Avatar deleted successfully"})
}

func (h *AvatarHandler) serveAvatar(c *gin.Context, avatarPath string) {
	object, err := h.minioService.GetFile(c.Request.Context(), service.AvatarsBucket, avatarPath)
	if err != nil {
		c.JSON(http.StatusNotFound, dto.NewErrorResponse("not_found", "Avatar not found"))
		return
	}
	defer object.Close()

	info, err := object.Stat()
	if err != nil {
		c.JSON(http.StatusNotFound, dto.NewErrorResponse("not_found", "Avatar not found"))
		return
	}

	c.DataFromReader(
		http.StatusOK,
		info.Size,
		info.ContentType,
		object,
		map[string]string{
			"Content-Disposition": "inline",
			"Cache-Control":       "public, max-age=86400",
		},
	)
}

func (h *AvatarHandler) deleteOldAvatars(c *gin.Context, userID uuid.UUID) {
	for ext := range allowedAvatarExtensions {
		objectName := fmt.Sprintf("%s/avatar%s", userID.String(), ext)
		_ = h.minioService.DeleteFile(c.Request.Context(), service.AvatarsBucket, objectName)
	}
}
