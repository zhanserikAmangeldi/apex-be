package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/dto"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/models"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/repository"
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/email"
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/jwt"
	"golang.org/x/crypto/bcrypt"
	"strings"
	"time"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAlreadyUserExists  = errors.New("user already exists")
	ErrResetCodeInvalid   = errors.New("invalid reset code")
	ErrResetCodeExpired   = errors.New("reset code expired")
)

type AuthService struct {
	userRepo         *repository.UserRepository
	resetCodeRepo    *repository.ResetCodeRepository
	tokenManager     *jwt.TokenManager
	emailService     *email.EmailService
}

func NewAuthService(
	userRepo *repository.UserRepository,
	resetCodeRepo *repository.ResetCodeRepository,
	tokenManager *jwt.TokenManager,
	emailService *email.EmailService,
) *AuthService {
	return &AuthService{
		userRepo:      userRepo,
		resetCodeRepo: resetCodeRepo,
		tokenManager:  tokenManager,
		emailService:  emailService,
	}
}

func (s *AuthService) Register(ctx context.Context, req *dto.RegisterUserRequest) (*dto.AuthResponse, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &models.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: string(hashedPassword),
	}

	if req.DisplayName != "" {
		user.DisplayName = &req.DisplayName
	}

	err = s.userRepo.Create(ctx, user)
	if err != nil {
		if errors.Is(err, repository.ErrUserAlreadyExists) {
			return nil, ErrAlreadyUserExists
		}
		return nil, err
	}

	accessToken, expiresAt, err := s.tokenManager.GenerateAccessToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, err
	}

	refreshToken, _, err := s.tokenManager.GenerateRefreshToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, err
	}

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(time.Until(expiresAt).Seconds()),
		User:         user,
	}, nil
}

func (s *AuthService) Login(ctx context.Context, req *dto.LoginRequest) (*dto.AuthResponse, error) {
	var user *models.User
	var err error

	if strings.Contains(req.Login, "@") {
		user, err = s.userRepo.GetByEmail(ctx, req.Login)
	} else {
		user, err = s.userRepo.GetByUsername(ctx, req.Login)
	}

	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password))
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	accessToken, expiresAt, err := s.tokenManager.GenerateAccessToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, err
	}

	refreshToken, _, err := s.tokenManager.GenerateRefreshToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, err
	}

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(time.Until(expiresAt).Seconds()),
		User:         user,
	}, nil
}

func (s *AuthService) RequestResetCode(ctx context.Context, req *dto.RequestResetCodeRequest) error {
	_, err := s.userRepo.GetByEmail(ctx, req.Email)
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			return ErrInvalidCredentials
		}
		return err
	}

	code, err := generateResetCode()
	if err != nil {
		return fmt.Errorf("failed to generate reset code: %w", err)
	}

	expiresAt := time.Now().Add(15 * time.Minute)
	err = s.resetCodeRepo.Create(ctx, req.Email, code, expiresAt)
	if err != nil {
		return fmt.Errorf("failed to save reset code: %w", err)
	}

	err = s.emailService.SendResetCode(req.Email, code)
	if err != nil {
		return fmt.Errorf("failed to send reset code email: %w", err)
	}

	return nil
}

func (s *AuthService) ResetPassword(ctx context.Context, req *dto.ResetPasswordRequest) error {
	err := s.resetCodeRepo.Verify(ctx, req.Email, req.Code)
	if err != nil {
		if errors.Is(err, repository.ErrResetCodeNotFound) {
			return ErrResetCodeInvalid
		}
		if errors.Is(err, repository.ErrResetCodeExpired) {
			return ErrResetCodeExpired
		}
		return err
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	err = s.userRepo.UpdatePassword(ctx, req.Email, string(hashedPassword))
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			return ErrInvalidCredentials
		}
		return err
	}

	err = s.resetCodeRepo.Delete(ctx, req.Email)
	if err != nil {
		return fmt.Errorf("failed to delete reset code: %w", err)
	}

	return nil
}

func generateResetCode() (string, error) {
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	code := int(b[0])<<16 | int(b[1])<<8 | int(b[2])
	if code < 0 {
		code = -code
	}
	return fmt.Sprintf("%06d", code%1000000), nil
}
