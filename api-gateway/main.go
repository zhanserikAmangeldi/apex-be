package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"
)

var (
	authServiceURL   = getEnv("AUTH_SERVICE_URL", "http://localhost:8081")
	editorServiceURL = getEnv("EDITOR_SERVICE_URL", "http://localhost:3000")
	editorWSURL      = getEnv("EDITOR_WS_URL", "ws://localhost:1234")
)

var jwtSecret []byte

// Per-IP rate limiting
type IPRateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
	rate     rate.Limit
	burst    int
}

func NewIPRateLimiter(r rate.Limit, b int) *IPRateLimiter {
	return &IPRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rate:     r,
		burst:    b,
	}
}

func (i *IPRateLimiter) GetLimiter(ip string) *rate.Limiter {
	i.mu.Lock()
	defer i.mu.Unlock()

	limiter, exists := i.limiters[ip]
	if !exists {
		limiter = rate.NewLimiter(i.rate, i.burst)
		i.limiters[ip] = limiter
	}

	return limiter
}

// Cleanup old limiters periodically
func (i *IPRateLimiter) Cleanup() {
	i.mu.Lock()
	defer i.mu.Unlock()
	// Simple cleanup - in production use LRU cache
	if len(i.limiters) > 10000 {
		i.limiters = make(map[string]*rate.Limiter)
	}
}

var ipLimiter = NewIPRateLimiter(rate.Limit(50), 100) // 50 req/s per IP, burst 100

// WebSocket upgrader
var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// In production, validate origin against ALLOWED_ORIGINS
		allowedOrigins := strings.Split(getEnv("ALLOWED_ORIGINS", "*"), ",")
		origin := r.Header.Get("Origin")

		if allowedOrigins[0] == "*" {
			return true
		}

		for _, allowed := range allowedOrigins {
			if strings.TrimSpace(allowed) == origin {
				return true
			}
		}
		return false
	},
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func init() {
	secret := getEnv("JWT_SECRET", "")
	if secret == "" {
		log.Fatal("JWT_SECRET environment variable is required")
	}
	jwtSecret = []byte(secret)
}

func main() {
	if getEnv("GIN_MODE", "debug") == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()

	// Middlewares
	r.Use(gin.Logger())
	r.Use(gin.Recovery())
	r.Use(rateLimitMiddleware())

	// CORS - single point of configuration
	allowedOrigins := strings.Split(getEnv("ALLOWED_ORIGINS", "*"), ",")
	r.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Authorization", "Content-Type", "X-Request-ID"},
		ExposeHeaders:    []string{"Content-Length", "X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Health endpoints
	r.GET("/health", healthCheck)
	r.GET("/readiness", readinessCheck)

	// WebSocket endpoint for Hocuspocus (collaborative editing)
	r.GET("/ws/document/:documentId", handleWebSocket)

	api := r.Group("/api")
	{
		// Auth service - public endpoints (login/register)
		auth := api.Group("/auth-service")
		{
			auth.Any("/*path", proxyRequest(authServiceURL, 5*time.Second))
		}

		// Editor service - requires authentication
		editor := api.Group("/editor-service")
		editor.Use(authMiddleware())
		{
			editor.Any("/*path", proxyRequest(editorServiceURL, 15*time.Second))
		}
	}

	// Cleanup rate limiters periodically
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			ipLimiter.Cleanup()
		}
	}()

	port := getEnv("PORT", "8000")
	log.Printf("🚀 API Gateway starting on port %s", port)
	log.Printf("   Auth Service: %s", authServiceURL)
	log.Printf("   Editor Service: %s", editorServiceURL)
	log.Printf("   Editor WebSocket: %s", editorWSURL)

	if err := r.Run(":" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func rateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		limiter := ipLimiter.GetLimiter(ip)

		if !limiter.Allow() {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":   "rate_limit_exceeded",
				"message": "Too many requests, please slow down",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")

		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "authorization_required",
				"message": "No authorization header provided",
			})
			c.Abort()
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_authorization_format",
				"message": "Authorization header must start with 'Bearer '",
			})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		claims, err := validateToken(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "invalid_token",
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		// Set user info in context
		c.Set("user_id", claims.UserID)
		c.Set("user_email", claims.Email)
		c.Set("user_username", claims.Username)

		c.Next()
	}
}

type TokenClaims struct {
	UserID   string
	Email    string
	Username string
}

func validateToken(tokenString string) (*TokenClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("token parse error: %v", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("token is invalid")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("could not parse token claims")
	}

	result := &TokenClaims{}

	// Handle user_id (can be string UUID or numeric)
	if uid, ok := claims["user_id"]; ok {
		switch v := uid.(type) {
		case float64:
			result.UserID = strconv.Itoa(int(v))
		case string:
			result.UserID = v
		case int:
			result.UserID = strconv.Itoa(v)
		default:
			return nil, fmt.Errorf("invalid user_id format in token")
		}
	} else {
		return nil, fmt.Errorf("token missing user_id claim")
	}

	if email, ok := claims["email"].(string); ok {
		result.Email = email
	}
	if username, ok := claims["username"].(string); ok {
		result.Username = username
	}

	return result, nil
}

// handleWebSocket proxies WebSocket connections to Hocuspocus server
func handleWebSocket(c *gin.Context) {
	documentId := c.Param("documentId")
	if documentId == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "document_id required"})
		return
	}

	// Get token from query parameter (WebSocket can't use headers easily)
	token := c.Query("token")
	if token == "" {
		// Also check Authorization header
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "authorization_required",
			"message": "Token required via 'token' query parameter or Authorization header",
		})
		return
	}

	// Validate token
	claims, err := validateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "invalid_token",
			"message": err.Error(),
		})
		return
	}

	// Parse backend WebSocket URL
	backendURL, err := url.Parse(editorWSURL)
	if err != nil {
		log.Printf("Failed to parse WebSocket URL: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid backend configuration"})
		return
	}

	// Upgrade client connection
	clientConn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer clientConn.Close()

	// Connect to backend Hocuspocus server
	// Hocuspocus expects the document name in the URL path
	backendWSURL := fmt.Sprintf("%s://%s/%s", backendURL.Scheme, backendURL.Host, documentId)

	// Create headers for backend connection
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+token)
	headers.Set("X-User-ID", claims.UserID)
	headers.Set("X-User-Email", claims.Email)
	headers.Set("X-User-Username", claims.Username)
	headers.Set("X-Forwarded-For", c.ClientIP())

	backendConn, _, err := websocket.DefaultDialer.Dial(backendWSURL, headers)
	if err != nil {
		log.Printf("Failed to connect to backend WebSocket: %v", err)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "Backend connection failed"))
		return
	}
	defer backendConn.Close()

	log.Printf("WebSocket proxy established: user=%s, document=%s", claims.UserID, documentId)

	// Bidirectional proxy
	errChan := make(chan error, 2)

	// Client -> Backend
	go func() {
		for {
			messageType, message, err := clientConn.ReadMessage()
			if err != nil {
				errChan <- err
				return
			}
			if err := backendConn.WriteMessage(messageType, message); err != nil {
				errChan <- err
				return
			}
		}
	}()

	// Backend -> Client
	go func() {
		for {
			messageType, message, err := backendConn.ReadMessage()
			if err != nil {
				errChan <- err
				return
			}
			if err := clientConn.WriteMessage(messageType, message); err != nil {
				errChan <- err
				return
			}
		}
	}()

	// Wait for either direction to fail
	<-errChan
	log.Printf("WebSocket proxy closed: user=%s, document=%s", claims.UserID, documentId)
}

func proxyRequest(targetURL string, timeout time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		target, err := url.Parse(targetURL)
		if err != nil {
			log.Printf("Failed to parse target URL %s: %v", targetURL, err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "invalid_service_configuration",
			})
			return
		}

		proxy := &httputil.ReverseProxy{
			Director: func(req *http.Request) {
				req.URL.Scheme = target.Scheme
				req.URL.Host = target.Host
				req.Host = target.Host

				originalPath := c.Request.URL.Path
				targetPath := stripServicePrefix(originalPath)

				if c.Request.URL.RawQuery != "" {
					targetPath += "?" + c.Request.URL.RawQuery
				}

				req.URL.Path = targetPath

				// Forward user info from JWT
				if userID, exists := c.Get("user_id"); exists {
					req.Header.Set("X-User-ID", userID.(string))
				}
				if email, exists := c.Get("user_email"); exists {
					req.Header.Set("X-User-Email", email.(string))
				}
				if username, exists := c.Get("user_username"); exists {
					req.Header.Set("X-User-Username", username.(string))
				}

				// Standard proxy headers
				req.Header.Set("X-Forwarded-By", "API-Gateway")
				req.Header.Set("X-Forwarded-For", c.ClientIP())
				req.Header.Set("X-Real-IP", c.ClientIP())

				// Request tracking
				requestID := generateRequestID(c)
				req.Header.Set("X-Request-ID", requestID)

				if gin.Mode() == gin.DebugMode {
					log.Printf("Proxying: %s %s → %s%s [%s]",
						req.Method, originalPath, target.Host, targetPath, requestID)
				}
			},
			ModifyResponse: func(resp *http.Response) error {
				// Add gateway headers to response
				resp.Header.Set("X-Served-By", "API-Gateway")
				return nil
			},
			ErrorHandler: func(rw http.ResponseWriter, req *http.Request, err error) {
				log.Printf("Proxy error for %s: %v", target.Host, err)

				// Don't write if headers already sent
				if rw.Header().Get("Content-Type") == "" {
					rw.Header().Set("Content-Type", "application/json")
					rw.WriteHeader(http.StatusBadGateway)
					io.WriteString(rw, fmt.Sprintf(`{"error":"service_unavailable","message":"Service temporarily unavailable","service":"%s"}`, target.Host))
				}
			},
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
		defer cancel()

		c.Request = c.Request.WithContext(ctx)
		proxy.ServeHTTP(c.Writer, c.Request)
	}
}

func stripServicePrefix(path string) string {
	prefixes := []string{
		"/api/auth-service",
		"/api/editor-service",
	}

	for _, prefix := range prefixes {
		if strings.HasPrefix(path, prefix) {
			stripped := strings.TrimPrefix(path, prefix)
			if stripped == "" {
				return "/"
			}
			return stripped
		}
	}

	return path
}

func generateRequestID(c *gin.Context) string {
	data := fmt.Sprintf("%s-%s-%d", c.ClientIP(), c.Request.URL.Path, time.Now().UnixNano())
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:8])
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"timestamp": time.Now().Unix(),
		"service":   "api-gateway",
		"version":   "1.0.0",
	})
}

func readinessCheck(c *gin.Context) {
	services := map[string]string{
		"auth":   authServiceURL + "/health",
		"editor": editorServiceURL + "/health",
	}

	results := make(map[string]interface{})
	allReady := true

	client := &http.Client{Timeout: 2 * time.Second}

	for name, healthURL := range services {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)

		req, _ := http.NewRequestWithContext(ctx, "GET", healthURL, nil)
		resp, err := client.Do(req)

		serviceStatus := map[string]interface{}{
			"healthy": false,
		}

		if err == nil && resp.StatusCode == http.StatusOK {
			serviceStatus["healthy"] = true
			serviceStatus["response_time_ms"] = time.Since(time.Now()).Milliseconds()
		} else {
			allReady = false
			if err != nil {
				serviceStatus["error"] = err.Error()
			} else {
				serviceStatus["status_code"] = resp.StatusCode
			}
		}

		results[name] = serviceStatus

		if resp != nil {
			resp.Body.Close()
		}
		cancel()
	}

	status := http.StatusOK
	if !allReady {
		status = http.StatusServiceUnavailable
	}

	c.JSON(status, gin.H{
		"ready":     allReady,
		"services":  results,
		"timestamp": time.Now().Unix(),
	})
}
