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

func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		requestID := c.GetHeader(RequestIDHeader)
		if requestID == "" {
			requestID = uuid.New().String()
		}
		c.Set(RequestIDKey, requestID)
		c.Header(RequestIDHeader, requestID)

		if c.Request.Body != nil && c.Request.ContentLength < 10240 {
			bodyBytes, _ := io.ReadAll(c.Request.Body)
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}

		reqLogger := logger.Log.With(
			zap.String("request_id", requestID),
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.String("client_ip", c.ClientIP()),
			zap.String("user_agent", c.Request.UserAgent()),
		)

		reqLogger.Debug("request_started",
			zap.String("query", c.Request.URL.RawQuery),
		)

		c.Next()

		duration := time.Since(start)

		userID := ""
		if uid, exists := c.Get("user_id"); exists {
			if id, ok := uid.(string); ok {
				userID = id
			} else if id, ok := uid.(uuid.UUID); ok {
				userID = id.String()
			}
		}

		statusCode := c.Writer.Status()

		fields := []zap.Field{
			zap.Int("status_code", statusCode),
			zap.Duration("duration", duration),
			zap.Int("response_size", c.Writer.Size()),
			zap.String("user_id", userID),
		}

		if len(c.Errors) > 0 {
			fields = append(fields, zap.Strings("errors", c.Errors.Errors()))
		}

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

func GetRequestID(c *gin.Context) string {
	if requestID, exists := c.Get(RequestIDKey); exists {
		return requestID.(string)
	}
	return ""
}

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
