package main

import (
	"context"
	"fmt"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

var (
	authServiceURL   = getEnv("AUTH_SERVICE_URL", "http://localhost:8081")
	editorServiceURL = getEnv("EDITOR_SERVICE_URL", "http://localhost:3000")
	editorWSURL      = getEnv("EDITOR_WS_URL", "ws://localhost:1234")
)

var jwtSecret []byte

var limiter = rate.NewLimiter(rate.Limit(100), 200)

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

	allowedOrigins := strings.Split(getEnv("ALLOWED_ORIGINS", "*"), ",")
	r.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Authorization", "Content-Type"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	r.GET("/health", healthCheck)
	r.GET("/readiness", readinessCheck)

	api := r.Group("/api")
	{
		// Auth service - no auth required (login/register endpoints)
		auth := api.Group("/auth-service")
		{
			auth.Any("/*path", proxyRequest(authServiceURL, 5*time.Second))
		}

		// Editor service - requires auth
		editor := api.Group("/editor-service")
		editor.Use(authMiddleware())
		{
			editor.Any("/*path", proxyRequest(editorServiceURL, 15*time.Second))
		}
	}

	port := getEnv("PORT", "8000")
	log.Printf(" - API Gateway starting on port %s", port)
	log.Printf(" - Auth Service: %s", authServiceURL)
	log.Printf(" - Editor Service: %s", editorServiceURL)
	log.Printf(" - Editor WebSocket: %s", editorWSURL)

	if err := r.Run(":" + port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func rateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !limiter.Allow() {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
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
				"error":   "Authorization required",
				"message": "No authorization header provided",
			})
			c.Abort()
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "Invalid authorization format",
				"message": "Authorization header must start with 'Bearer '",
			})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return jwtSecret, nil
		})

		if err != nil {
			log.Printf("JWT parse error: %v", err)
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "Invalid token",
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		if !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "Token invalid",
				"message": "Token validation failed",
			})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Could not parse token claims",
			})
			c.Abort()
			return
		}

		var userID string
		if uid, ok := claims["user_id"]; ok {
			switch v := uid.(type) {
			case float64:
				userID = strconv.Itoa(int(v))
			case string:
				userID = v
			case int:
				userID = strconv.Itoa(v)
			default:
				log.Printf("Unexpected user_id type: %T", v)
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": "Invalid user_id format in token",
				})
				c.Abort()
				return
			}
		} else {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Token missing user_id claim",
			})
			c.Abort()
			return
		}

		c.Set("user_id", userID)

		if email, ok := claims["email"].(string); ok {
			c.Set("user_email", email)
		}
		if username, ok := claims["username"].(string); ok {
			c.Set("user_username", username)
		}

		c.Next()
	}
}

func proxyRequest(targetURL string, timeout time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		target, err := url.Parse(targetURL)
		if err != nil {
			log.Printf("Failed to parse target URL %s: %v", targetURL, err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Invalid service configuration",
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

				if userID, exists := c.Get("user_id"); exists {
					req.Header.Set("X-User-ID", userID.(string))
				}
				if email, exists := c.Get("user_email"); exists {
					req.Header.Set("X-User-Email", email.(string))
				}
				if username, exists := c.Get("user_username"); exists {
					req.Header.Set("X-User-Username", username.(string))
				}

				req.Header.Set("X-Forwarded-By", "API-Gateway")
				req.Header.Set("X-Forwarded-For", c.ClientIP())
				req.Header.Set("X-Real-IP", c.ClientIP())

				if gin.Mode() == gin.DebugMode {
					log.Printf("Proxying: %s %s → %s%s",
						req.Method, originalPath, target.Host, targetPath)
				}
			},
			ErrorHandler: func(rw http.ResponseWriter, req *http.Request, err error) {
				log.Printf("Proxy error for %s: %v", target.Host, err)

				c.JSON(http.StatusBadGateway, gin.H{
					"error":   "Service temporarily unavailable",
					"service": target.Host,
					"details": err.Error(),
				})
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
			return strings.TrimPrefix(path, prefix)
		}
	}

	return path
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"timestamp": time.Now().Unix(),
		"service":   "api-gateway",
	})
}

func readinessCheck(c *gin.Context) {
	services := map[string]string{
		"auth":   authServiceURL + "/health",
		"editor": editorServiceURL + "/health",
	}

	results := make(map[string]bool)
	allReady := true

	for name, url := range services {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
		resp, err := http.DefaultClient.Do(req)

		ready := err == nil && resp.StatusCode == http.StatusOK
		results[name] = ready

		if !ready {
			allReady = false
		}

		if resp != nil {
			resp.Body.Close()
		}
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
