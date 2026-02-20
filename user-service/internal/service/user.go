package service

import (
	"context"
	"encoding/json"
	"net/http"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"golang.org/x/oauth2/github"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/config"
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
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

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

	go func() {
		if err := s.emailSender.SendVerificationEmail(user.Email, user.Username, verificationToken); err != nil {
			log.Printf("Failed to send verification email to %s: %v", user.Email, err)
		}
	}()

	return s.createSession(ctx, user, userAgent, ipAddress)
}

func (s *AuthService) Login(ctx context.Context, req *dto.LoginRequest, userAgent, ipAddress *string) (*dto.AuthResponse, error) {
	var user *models.User
	var err error

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

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	_ = s.userRepo.UpdateLastSeen(ctx, user.ID)

	return s.createSession(ctx, user, userAgent, ipAddress)
}

func (s *AuthService) GoogleLogin(ctx context.Context, code string, userAgent, ipAddress *string) (*dto.AuthResponse, error) {
	// 1. Exchange code for token
	token, err := s.exchangeGoogleCode(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("failed to exchange token: %w", err)
	}

	// 2. Get user info from Google
	googleUser, err := s.getGoogleUserInfo(ctx, token.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("failed to get user info: %w", err)
	}

	// 3. Find or create user
	user, err := s.userRepo.GetByEmail(ctx, googleUser.Email)
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			// Create new user
			// We generate a random password since they are logging in via Google
			randomPassword, _ := s.generateVerificationToken() // Re-using random string generator
			hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(randomPassword), bcrypt.DefaultCost)
			
			newUser := &models.User{
				Username:     strings.Split(googleUser.Email, "@")[0], // Basic username attempt
				Email:        googleUser.Email,
				PasswordHash: string(hashedPassword),
			}
			
			// If username exists, append random suffix
			if _, err := s.userRepo.GetByUsername(ctx, newUser.Username); err == nil {
				newUser.Username = fmt.Sprintf("%s_%s", newUser.Username, randomPassword[:4])
			}

			if err := s.userRepo.Create(ctx, newUser); err != nil {
				return nil, fmt.Errorf("failed to create user: %w", err)
			}
			if err := s.userRepo.MarkVerified(ctx, newUser.ID); err != nil {
				return nil, fmt.Errorf("failed to verify user: %w", err)
			}
			user = newUser
		} else {
			return nil, err
		}
	}

	// 4. Generate Tokens
	accessToken, expiresAt, err := s.tokenManager.GenerateAccessToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, err
	}

	refreshToken, refreshExpiresAt, err := s.tokenManager.GenerateRefreshToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, err
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
		return nil, err
	}

	_ = s.userRepo.UpdateLastSeen(ctx, user.ID)

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(time.Until(expiresAt).Seconds()),
		User:         user,
	}, nil
}

func (s *AuthService) GithubLogin(ctx context.Context, code string, userAgent, ipAddress *string) (*dto.AuthResponse, error) {
	// 1. Exchange code for token
	token, err := s.exchangeGithubCode(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("failed to exchange token: %w", err)
	}

	// 2. Get user info from GitHub
	githubUser, err := s.getGithubUserInfo(ctx, token.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("failed to get user info: %w", err)
	}

	if githubUser.Email == "" {
		return nil, errors.New("email is required but not provided by GitHub")
	}

	// 3. Find or create user
	user, err := s.userRepo.GetByEmail(ctx, githubUser.Email)
	if err != nil {
		if errors.Is(err, repository.ErrUserNotFound) {
			// Create new user
			randomPassword, _ := s.generateVerificationToken()
			hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(randomPassword), bcrypt.DefaultCost)

			newUser := &models.User{
				Username:     githubUser.Login,
				Email:        githubUser.Email,
				PasswordHash: string(hashedPassword),
			}
			
			if githubUser.Name != "" {
				newUser.DisplayName = &githubUser.Name
			}

			// If username exists, append random suffix
			if _, err := s.userRepo.GetByUsername(ctx, newUser.Username); err == nil {
				newUser.Username = fmt.Sprintf("%s_%s", newUser.Username, randomPassword[:4])
			}

			if err := s.userRepo.Create(ctx, newUser); err != nil {
				return nil, fmt.Errorf("failed to create user: %w", err)
			}
			if err := s.userRepo.MarkVerified(ctx, newUser.ID); err != nil {
				return nil, fmt.Errorf("failed to verify user: %w", err)
			}
			user = newUser
		} else {
			return nil, err
		}
	}

	// 4. Generate Tokens
	accessToken, expiresAt, err := s.tokenManager.GenerateAccessToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, err
	}

	refreshToken, refreshExpiresAt, err := s.tokenManager.GenerateRefreshToken(user.ID, user.Username, user.Email)
	if err != nil {
		return nil, err
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
		return nil, err
	}

	_ = s.userRepo.UpdateLastSeen(ctx, user.ID)

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int64(time.Until(expiresAt).Seconds()),
		User:         user,
	}, nil
}

type GithubUserInfo struct {
	Login string `json:"login"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type GithubEmail struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

func (s *AuthService) exchangeGithubCode(ctx context.Context, code string) (*oauth2.Token, error) {
	cfg := config.LoadConfig()
	conf := &oauth2.Config{
		ClientID:     cfg.GithubOAuthClientID,
		ClientSecret: cfg.GithubOAuthClientSecret,
		RedirectURL:  "", // GitHub doesn't strictly need RedirectURL on exchange if it was correct in frontend, but omitting is safer if not configured
		Endpoint:     github.Endpoint,
	}
	return conf.Exchange(ctx, code)
}

func (s *AuthService) getGithubUserInfo(ctx context.Context, accessToken string) (*GithubUserInfo, error) {
	// Get basic info
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to get user info: status code %d", resp.StatusCode)
	}

	var userInfo GithubUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, err
	}

	// If email is empty, fetch emails
	if userInfo.Email == "" {
		req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/user/emails", nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err // tolerate error? better to fail if we need email
		}
		defer resp.Body.Close()
		
		if resp.StatusCode == http.StatusOK {
			var emails []GithubEmail
			if err := json.NewDecoder(resp.Body).Decode(&emails); err == nil {
				for _, e := range emails {
					if e.Primary && e.Verified {
						userInfo.Email = e.Email
						break
					}
				}
				// If no primary verified found, take any verified
				if userInfo.Email == "" {
					for _, e := range emails {
						if e.Verified {
							userInfo.Email = e.Email
							break
						}
					}
				}
			}
		}
	}

	return &userInfo, nil
}

type GoogleUserInfo struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Picture       string `json:"picture"`
}

func (s *AuthService) exchangeGoogleCode(ctx context.Context, code string) (*oauth2.Token, error) {
	cfg := config.LoadConfig()
	conf := &oauth2.Config{
		ClientID:     cfg.GoogleOAuthClientID,
		ClientSecret: cfg.GoogleOAuthClientSecret,
		RedirectURL:  cfg.GoogleOAuthRedirectURI,
		Scopes: []string{
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile",
		},
		Endpoint: google.Endpoint,
	}
	return conf.Exchange(ctx, code)
}

func (s *AuthService) getGoogleUserInfo(ctx context.Context, accessToken string) (*GoogleUserInfo, error) {
	resp, err := http.Get("https://www.googleapis.com/oauth2/v2/userinfo?access_token=" + accessToken)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to get user info: status code %d", resp.StatusCode)
	}

	var userInfo GoogleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, err
	}
	return &userInfo, nil
}

func (s *AuthService) Logout(ctx context.Context, refreshToken, accessToken string) error {
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

	return s.sessionRepo.Revoke(ctx, refreshToken)
}

func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string, userAgent, ipAddress *string) (*dto.AuthResponse, error) {
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

	claims, err := s.tokenManager.ValidateToken(refreshToken)
	if err != nil {
		return nil, ErrInvalidToken
	}

	user, err := s.userRepo.GetByID(ctx, claims.UserID)
	if err != nil {
		return nil, err
	}

	if err := s.sessionRepo.Revoke(ctx, refreshToken); err != nil {
		log.Printf("Failed to revoke old session: %v", err)
	}

	oldAccessClaims, err := s.tokenManager.ValidateToken(session.AccessToken)
	if err == nil {
		ttl := time.Until(oldAccessClaims.ExpiresAt.Time)
		if ttl > 0 {
			key := fmt.Sprintf("revoked:%s", session.AccessToken)
			_ = s.redisClient.Set(ctx, key, "1", ttl).Err()
		}
	}

	return s.createSession(ctx, user, userAgent, ipAddress)
}

func (s *AuthService) LogoutAll(ctx context.Context, userID uuid.UUID) error {
	sessions, err := s.sessionRepo.GetAllByUserID(ctx, userID)
	if err != nil {
		return err
	}

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

	_ = s.emailRepo.DeleteByUserID(ctx, userID)

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
