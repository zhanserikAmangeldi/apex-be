package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/jwt"
)

const (
	AuthorizationHeader = "Authorization"
	BearerSchema        = "Bearer"

	// Context keys
	UserIDKey   = "user_id"
	UsernameKey = "username"
	EmailKey    = "email"
)

type AuthMiddleware struct {
	tokenManager *jwt.TokenManager
	redisClient  *redis.Client
}

func NewAuthMiddleware(tokenManager *jwt.TokenManager, redisClient *redis.Client) *AuthMiddleware {
	return &AuthMiddleware{
		tokenManager: tokenManager,
		redisClient:  redisClient,
	}
}

func (m *AuthMiddleware) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := extractBearerToken(c)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		// Check if token is blacklisted
		ctx := c.Request.Context()
		key := "revoked:" + token
		exists, err := m.redisClient.Exists(ctx, key).Result()
		if err == nil && exists > 0 {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "token has been revoked",
				"code":    "TOKEN_REVOKED",
			})
			c.Abort()
			return
		}

		// Validate token
		claims, err := m.tokenManager.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "invalid or expired token",
				"code":    "INVALID_TOKEN",
			})
			c.Abort()
			return
		}

		// Set user info in context
		c.Set(UserIDKey, claims.UserID)
		c.Set(UsernameKey, claims.Username)
		c.Set(EmailKey, claims.Email)

		c.Next()
	}
}

// OptionalAuth - не прерывает запрос, если токен невалидный
func (m *AuthMiddleware) OptionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := extractBearerToken(c)
		if err != nil {
			c.Next()
			return
		}

		// Check if token is blacklisted
		ctx := c.Request.Context()
		key := "revoked:" + token
		exists, _ := m.redisClient.Exists(ctx, key).Result()
		if exists > 0 {
			c.Next()
			return
		}

		claims, err := m.tokenManager.ValidateToken(token)
		if err != nil {
			c.Next()
			return
		}

		c.Set(UserIDKey, claims.UserID)
		c.Set(UsernameKey, claims.Username)
		c.Set(EmailKey, claims.Email)

		c.Next()
	}
}

func extractBearerToken(c *gin.Context) (string, error) {
	authHeader := c.GetHeader(AuthorizationHeader)
	if authHeader == "" {
		return "", ErrMissingAuthHeader
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != BearerSchema {
		return "", ErrInvalidAuthHeader
	}

	return parts[1], nil
}

// Helper functions to extract user info from context

func GetUserID(c *gin.Context) (uuid.UUID, bool) {
	val, exists := c.Get(UserIDKey)
	if !exists {
		return uuid.Nil, false
	}
	userID, ok := val.(uuid.UUID)
	return userID, ok
}

func GetUsername(c *gin.Context) string {
	val, exists := c.Get(UsernameKey)
	if !exists {
		return ""
	}
	return val.(string)
}

func GetEmail(c *gin.Context) string {
	val, exists := c.Get(EmailKey)
	if !exists {
		return ""
	}
	return val.(string)
}

// MustGetUserID - возвращает UserID или паникует
func MustGetUserID(c *gin.Context) uuid.UUID {
	userID, ok := GetUserID(c)
	if !ok {
		panic("user_id not found in context - ensure auth middleware is applied")
	}
	return userID
}

// Errors
var (
	ErrMissingAuthHeader = &AuthError{Message: "authorization header is required"}
	ErrInvalidAuthHeader = &AuthError{Message: "invalid authorization header format"}
)

type AuthError struct {
	Message string
}

func (e *AuthError) Error() string {
	return e.Message
}
