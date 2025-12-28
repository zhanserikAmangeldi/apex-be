package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/dto"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/models"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/repository"
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/jwt"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserAlreadyExists  = errors.New("user already exists")
	ErrInvalidToken       = errors.New("invalid token")
	ErrTokenExpired       = errors.New("token expired")
	ErrSessionRevoked     = errors.New("session revoked")
)

type EmailSender interface {
	SendVerificationEmail(to, username, token string) error
}

type AuthService struct {
	userRepo     *repository.UserRepository
	tokenManager *jwt.TokenManager
	sessionRepo  *repository.SessionRepository
	emailRepo    *repository.EmailVerificationRepository
	emailSender  EmailSender
	redisClient  *redis.Client
}

func NewAuthService(
	userRepo *repository.UserRepository,
	tokenManager *jwt.TokenManager,
	sessionRepo *repository.SessionRepository,
	emailRepo *repository.EmailVerificationRepository,
	emailSender EmailSender,
	redisClient *redis.Client,
) *AuthService {
	return &AuthService{
		userRepo:     userRepo,
		tokenManager: tokenManager,
		sessionRepo:  sessionRepo,
		emailRepo:    emailRepo,
		emailSender:  emailSender,
		redisClient:  redisClient,
	}
}

func (s *AuthService) Register(ctx context.Context, req *dto.RegisterRequest, userAgent, ipAddress *string) (*dto.AuthResponse, error) {
	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Create user
	user := &models.User{
		Username:     req.Username,
		Email:        strings.ToLower(req.Email),
		PasswordHash: string(hashedPassword),
	}

	if req.DisplayName != "" {
		user.DisplayName = &req.DisplayName
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		if errors.Is(err, repository.ErrUserAlreadyExists) {
			return nil, ErrUserAlreadyExists
		}
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Create email verification token
	verificationToken, err := s.generateVerificationToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate verification token: %w", err)
	}

	ev := &models.EmailVerification{
		UserID:    user.ID,
		Token:     verificationToken,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}

	if err := s.emailRepo.Create(ctx, ev); err != nil {
		return nil, fmt.Errorf("failed to save verification token: %w", err)
	}

	// Send verification email (async, don't block registration)
	go func() {
		if err := s.emailSender.SendVerificationEmail(user.Email, user.Username, verificationToken); err != nil {
			log.Printf("Failed to send verification email to %s: %v", user.Email, err)
		}
	}()

	// Generate tokens
	return s.createSession(ctx, user, userAgent, ipAddress)
}

func (s *AuthService) Login(ctx context.Context, req *dto.LoginRequest, userAgent, ipAddress *string) (*dto.AuthResponse, error) {
	var user *models.User
	var err error

	// Determine if login is email or username
	login := strings.TrimSpace(req.Login)
	if strings.Contains(login, "@") {
		user, err = s.userRepo.GetByEmail(ctx, strings.ToLower(login))
	} else {
		user, err = s.userRepo.GetByUsername(ctx, login)
	}

	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	// Update last seen
	_ = s.userRepo.UpdateLastSeen(ctx, user.ID)

	return s.createSession(ctx, user, userAgent, ipAddress)
}

func (s *AuthService) Logout(ctx context.Context, refreshToken, accessToken string) error {
	// Blacklist access token in Redis
	claims, err := s.tokenManager.ValidateToken(accessToken)
	if err == nil {
		ttl := time.Until(claims.ExpiresAt.Time)
		if ttl > 0 {
			key := fmt.Sprintf("revoked:%s", accessToken)
			if err := s.redisClient.Set(ctx, key, "1", ttl).Err(); err != nil {
				log.Printf("Failed to blacklist access token: %v", err)
			}
		}
	}

	// Revoke session
	return s.sessionRepo.Revoke(ctx, refreshToken)
}

func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string, userAgent, ipAddress *string) (*dto.AuthResponse, error) {
	// Validate session exists and is active
	session, err := s.sessionRepo.GetByRefreshToken(ctx, refreshToken)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrSessionNotFound):
			return nil, ErrInvalidToken
		case errors.Is(err, repository.ErrSessionExpired):
			return nil, ErrTokenExpired
		case errors.Is(err, repository.ErrSessionRevoked):
			return nil, ErrSessionRevoked
		default:
			return nil, err
		}
	}

	// Validate refresh token
	claims, err := s.tokenManager.ValidateToken(refreshToken)
	if err != nil {
		return nil, ErrInvalidToken
	}

	// Get user
	user, err := s.userRepo.GetByID(ctx, claims.UserID)
	if err != nil {
		return nil, err
	}

	// Revoke old session
	if err := s.sessionRepo.Revoke(ctx, refreshToken); err != nil {
		log.Printf("Failed to revoke old session: %v", err)
	}

	// Blacklist old access token
	oldAccessClaims, err := s.tokenManager.ValidateToken(session.AccessToken)
	if err == nil {
		ttl := time.Until(oldAccessClaims.ExpiresAt.Time)
		if ttl > 0 {
			key := fmt.Sprintf("revoked:%s", session.AccessToken)
			_ = s.redisClient.Set(ctx, key, "1", ttl).Err()
		}
	}

	// Create new session
	return s.createSession(ctx, user, userAgent, ipAddress)
}

func (s *AuthService) LogoutAll(ctx context.Context, userID uuid.UUID) error {
	// Get all active sessions
	sessions, err := s.sessionRepo.GetAllByUserID(ctx, userID)
	if err != nil {
		return err
	}

	// Blacklist all access tokens
	for _, sess := range sessions {
		claims, err := s.tokenManager.ValidateToken(sess.AccessToken)
		if err == nil {
			ttl := time.Until(claims.ExpiresAt.Time)
			if ttl > 0 {
				key := fmt.Sprintf("revoked:%s", sess.AccessToken)
				_ = s.redisClient.Set(ctx, key, "1", ttl).Err()
			}
		}
	}

	return s.sessionRepo.RevokeAllByUserID(ctx, userID)
}

func (s *AuthService) GetActiveSessions(ctx context.Context, userID uuid.UUID, currentRefreshToken string) (*models.SessionListResponse, error) {
	sessions, err := s.sessionRepo.GetAllByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	sessionInfos := make([]*models.SessionInfo, 0, len(sessions))
	for _, sess := range sessions {
		sessionInfos = append(sessionInfos, &models.SessionInfo{
			ID:        sess.ID,
			UserAgent: sess.UserAgent,
			IPAddress: sess.IPAddress,
			CreatedAt: sess.CreatedAt,
			ExpiresAt: sess.ExpiresAt,
			IsCurrent: sess.RefreshToken == currentRefreshToken,
		})
	}

	return &models.SessionListResponse{
		Sessions: sessionInfos,
		Total:    len(sessionInfos),
	}, nil
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

func (s *AuthService) ResendVerificationEmail(ctx context.Context, userID uuid.UUID) error {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return err
	}

	if user.IsVerified {
		return errors.New("email already verified")
	}

	// Delete old verification tokens
	_ = s.emailRepo.DeleteByUserID(ctx, userID)

	// Create new token
	token, err := s.generateVerificationToken()
	if err != nil {
		return err
	}

	ev := &models.EmailVerification{
		UserID:    userID,
		Token:     token,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}

	if err := s.emailRepo.Create(ctx, ev); err != nil {
		return err
	}

	return s.emailSender.SendVerificationEmail(user.Email, user.Username, token)
}

// Private helpers

func (s *AuthService) createSession(ctx context.Context, user *models.User, userAgent, ipAddress *string) (*dto.AuthResponse, error) {
	accessToken, accessExpiresAt, err := s.tokenManager.GenerateAccessToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, fmt.Errorf("failed to generate access token: %w", err)
	}

	refreshToken, refreshExpiresAt, err := s.tokenManager.GenerateRefreshToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, fmt.Errorf("failed to generate refresh token: %w", err)
	}

	session := &models.Session{
		UserID:       user.ID,
		RefreshToken: refreshToken,
		AccessToken:  accessToken,
		UserAgent:    userAgent,
		IPAddress:    ipAddress,
		ExpiresAt:    refreshExpiresAt,
	}

	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(time.Until(accessExpiresAt).Seconds()),
		User:         user,
	}, nil
}

func (s *AuthService) generateVerificationToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
