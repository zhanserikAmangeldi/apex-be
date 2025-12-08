package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/redis/go-redis/v9"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/dto"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/models"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/repository"
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/jwt"
	"golang.org/x/crypto/bcrypt"
	"log"
	"strings"
	"time"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAlreadyUserExists  = errors.New("user already exists")
)

type EmailSender interface {
	SendVerificationEmail(to, username, token string) error
}

type AuthService struct {
	userRepo     *repository.UserRepository
	tokenManager *jwt.TokenManager
	emailRepo    *repository.EmailVerificationRepository
	emailSender  EmailSender
	redisClient  *redis.Client
}

func NewAuthService(
	userRepo *repository.UserRepository,
	tokenManager *jwt.TokenManager,
	emailRepo *repository.EmailVerificationRepository,
	emailSender EmailSender,
	redisClient *redis.Client,
) *AuthService {
	return &AuthService{
		userRepo:     userRepo,
		tokenManager: tokenManager,
		emailRepo:    emailRepo,
		emailSender:  emailSender,
		redisClient:  redisClient,
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

	token, err := s.generateVerificationToken()
	if err != nil {
		return nil, err
	}

	ev := &models.EmailVerification{
		UserID:    user.ID,
		Token:     token,
		ExpiresAt: time.Now().Add(time.Hour * 24),
	}

	if err = s.emailRepo.Create(ctx, ev); err != nil {
		return nil, err
	}

	log.Println("helloworld")

	err = s.emailSender.SendVerificationEmail(user.Email, user.Username, token)
	if err != nil {
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

func (s *AuthService) Logout(ctx context.Context, refreshToken, accessToken string) error {
	claims, err := s.tokenManager.ValidateToken(accessToken)
	if err == nil {
		ttl := time.Until(claims.ExpiresAt.Time)
		if ttl > 0 {
			key := fmt.Sprintf("revoked:%s", accessToken)
			_ = s.redisClient.Set(ctx, key, "revoked", ttl).Err()
			log.Printf("tokens blacklisted for userID=%s (accessToken=%s..., refreshToken=%s...)",
				claims.UserId, accessToken[:10], refreshToken[:10])
		}
	} else {
		return err
	}

	return nil
}

func (s *AuthService) generateVerificationToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *AuthService) VerifyEmail(ctx context.Context, token string) error {
	ev, err := s.emailRepo.GetByToken(ctx, token)
	if err != nil {
		return err
	}

	if err := s.userRepo.MarkVerified(ctx, ev.UserID); err != nil {
		return err
	}

	return s.emailRepo.MarkVerified(ctx, ev.ID)
}
