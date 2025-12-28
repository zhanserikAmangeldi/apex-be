package middleware

import (
	"bytes"
	"io"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/logger"
)

const (
	RequestIDHeader = "X-Request-ID"
	RequestIDKey    = "request_id"
)

// RequestLogger is a middleware that logs HTTP requests
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		// Generate or get request ID
		requestID := c.GetHeader(RequestIDHeader)
		if requestID == "" {
			requestID = uuid.New().String()
		}
		c.Set(RequestIDKey, requestID)
		c.Header(RequestIDHeader, requestID)

		// Get request body for logging (if not too large)
		if c.Request.Body != nil && c.Request.ContentLength < 10240 { // 10KB limit
			bodyBytes, _ := io.ReadAll(c.Request.Body)
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}

		// Create request-scoped logger
		reqLogger := logger.Log.With(
			zap.String("request_id", requestID),
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.String("client_ip", c.ClientIP()),
			zap.String("user_agent", c.Request.UserAgent()),
		)

		// Log request start
		reqLogger.Debug("request_started",
			zap.String("query", c.Request.URL.RawQuery),
		)

		// Process request
		c.Next()

		// Calculate duration
		duration := time.Since(start)

		// Get user ID if available
		userID := ""
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(string); ok {
				userID = id
			} else if id, ok := uid.(uuid.UUID); ok {
				userID = id.String()
			}
		}

		// Determine log level based on status code
		statusCode := c.Writer.Status()

		fields := []zap.Field{
			zap.Int("status_code", statusCode),
			zap.Duration("duration", duration),
			zap.Int("response_size", c.Writer.Size()),
			zap.String("user_id", userID),
		}

		// Add errors if any
		if len(c.Errors) > 0 {
			fields = append(fields, zap.Strings("errors", c.Errors.Errors()))
		}

		// Log based on status code
		switch {
		case statusCode >= 500:
			reqLogger.Error("request_completed", fields...)
		case statusCode >= 400:
			reqLogger.Warn("request_completed", fields...)
		case duration > time.Second:
			reqLogger.Warn("slow_request", fields...)
		default:
			reqLogger.Info("request_completed", fields...)
		}
	}
}

// GetRequestID retrieves request ID from context
func GetRequestID(c *gin.Context) string {
	if requestID, exists := c.Get(RequestIDKey); exists {
		return requestID.(string)
	}
	return ""
}

// GetLogger returns a logger with request context
func GetLogger(c *gin.Context) *zap.Logger {
	requestID := GetRequestID(c)
	userID := ""

	if uid, exists := c.Get("user_id"); exists {
		if id, ok := uid.(string); ok {
			userID = id
		} else if id, ok := uid.(uuid.UUID); ok {
			userID = id.String()
		}
	}

	return logger.Log.With(
		zap.String("request_id", requestID),
		zap.String("user_id", userID),
	)
}

// Recovery middleware with logging
func RecoveryWithLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				requestID := GetRequestID(c)

				logger.Log.Error("panic_recovered",
					zap.String("request_id", requestID),
					zap.String("method", c.Request.Method),
					zap.String("path", c.Request.URL.Path),
					zap.Any("error", err),
				)

				c.AbortWithStatusJSON(500, gin.H{
					"error":      "internal_server_error",
					"message":    "An unexpected error occurred",
					"request_id": requestID,
				})
			}
		}()

		c.Next()
	}
}
