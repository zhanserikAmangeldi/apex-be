package jwt

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("expired token")
)

type Claims struct {
	UserID   uuid.UUID `json:"user_id"`
	Username string    `json:"username"`
	Email    string    `json:"email"`
	jwt.RegisteredClaims
}

type TokenManager struct {
	secretKey       string
	accessDuration  time.Duration
	refreshDuration time.Duration
}

type TokenManagerConfig struct {
	SecretKey       string
	AccessDuration  time.Duration
	RefreshDuration time.Duration
}

func NewTokenManager(cfg TokenManagerConfig) *TokenManager {
	// Defaults
	if cfg.AccessDuration == 0 {
		cfg.AccessDuration = 15 * time.Minute
	}
	if cfg.RefreshDuration == 0 {
		cfg.RefreshDuration = 7 * 24 * time.Hour
	}

	return &TokenManager{
		secretKey:       cfg.SecretKey,
		accessDuration:  cfg.AccessDuration,
		refreshDuration: cfg.RefreshDuration,
	}
}

func (tm *TokenManager) GenerateAccessToken(userID uuid.UUID, username, email string) (string, time.Time, error) {
	expiresAt := time.Now().Add(tm.accessDuration)

	claims := Claims{
		UserID:   userID,
		Username: username,
		Email:    email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Subject:   userID.String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(tm.secretKey))
	if err != nil {
		return "", time.Time{}, err
	}

	return tokenString, expiresAt, nil
}

func (tm *TokenManager) GenerateRefreshToken(userID uuid.UUID, username, email string) (string, time.Time, error) {
	expiresAt := time.Now().Add(tm.refreshDuration)

	claims := Claims{
		UserID:   userID,
		Username: username,
		Email:    email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   userID.String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(tm.secretKey))
	if err != nil {
		return "", time.Time{}, err
	}

	return tokenString, expiresAt, nil
}

func (tm *TokenManager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(tm.secretKey), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// GenerateTokenPair - генерирует оба токена за один вызов
func (tm *TokenManager) GenerateTokenPair(userID uuid.UUID, username, email string) (accessToken, refreshToken string, accessExpiresAt, refreshExpiresAt time.Time, err error) {
	accessToken, accessExpiresAt, err = tm.GenerateAccessToken(userID, username, email)
	if err != nil {
		return
	}

	refreshToken, refreshExpiresAt, err = tm.GenerateRefreshToken(userID, username, email)
	return
}
