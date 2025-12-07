package middleware

import (
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/jwt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	authorizationHeader = "Authorization"
	userIDKey           = "user_id"
	usernameKey         = "username"
	emailKey            = "email"
)

func AuthMiddleware(tokenManager *jwt.TokenManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader(authorizationHeader)
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization header required"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization header format"})
			c.Abort()
			return
		}

		token := parts[1]

		claims, err := tokenManager.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			c.Abort()
			return
		}

		c.Set(userIDKey, claims.UserId)
		c.Set(usernameKey, claims.Username)
		c.Set(emailKey, claims.Email)

		c.Next()
	}
}

func GetUserID(c *gin.Context) int64 {
	userID, exists := c.Get(userIDKey)
	if !exists {
		return 0
	}
	return userID.(int64)
}

func GetUsername(c *gin.Context) string {
	username, exists := c.Get(usernameKey)
	if !exists {
		return ""
	}
	return username.(string)
}

func GetEmail(c *gin.Context) string {
	email, exists := c.Get(emailKey)
	if !exists {
		return ""
	}
	return email.(string)
}
