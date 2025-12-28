package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/config"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/handler"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/mailer"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/middleware"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/migration"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/repository"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/service"
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/jwt"
)

func main() {
	// Load configuration
	cfg := config.LoadConfig()

	// Set Gin mode
	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	ctx := context.Background()

	// Initialize PostgreSQL
	dbPool, err := initDatabase(ctx, cfg)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer dbPool.Close()

	// Run migrations
	log.Println("Running database migrations...")
	if err := migration.AutoMigrate(cfg.DBUrl); err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	log.Println("Migrations completed successfully")

	// Initialize Redis
	redisClient, err := initRedis(ctx, cfg)
	if err != nil {
		log.Fatalf("Failed to initialize Redis: %v", err)
	}
	defer redisClient.Close()

	// Initialize dependencies
	deps := initDependencies(cfg, dbPool, redisClient)

	// Setup router
	router := setupRouter(cfg, deps)

	// Create server
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		log.Printf("User service starting on port %s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Server stopped")
}

func initDatabase(ctx context.Context, cfg *config.Config) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.DBUrl)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database config: %w", err)
	}

	poolConfig.MaxConns = int32(cfg.DBMaxConns)
	poolConfig.MinConns = 2
	poolConfig.MaxConnLifetime = time.Hour
	poolConfig.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("Connected to PostgreSQL")
	return pool, nil
}

func initRedis(ctx context.Context, cfg *config.Config) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%s", cfg.RedisHost, cfg.RedisPort),
		DB:   cfg.RedisDB,
	})

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to ping Redis: %w", err)
	}

	log.Println("Connected to Redis")
	return client, nil
}

type Dependencies struct {
	AuthHandler    *handler.AuthHandler
	UserHandler    *handler.UserHandler
	AvatarHandler  *handler.AvatarHandler
	AuthMiddleware *middleware.AuthMiddleware
}

func initDependencies(cfg *config.Config, dbPool *pgxpool.Pool, redisClient *redis.Client) *Dependencies {
	// Repositories
	userRepo := repository.NewUserRepository(dbPool)
	sessionRepo := repository.NewSessionRepository(dbPool)
	emailRepo := repository.NewEmailVerificationRepository(dbPool)

	// Services
	tokenManager := jwt.NewTokenManager(jwt.TokenManagerConfig{
		SecretKey:       cfg.JWTSecret,
		AccessDuration:  cfg.JWTAccessDuration,
		RefreshDuration: cfg.JWTRefreshDuration,
	})

	minioService := service.NewMinioService(cfg)

	templateRender := mailer.NewTemplateRender("internal/mailer/templates")
	emailSender := &mailer.SMTPMailer{
		Host:    cfg.SMTPHost,
		Port:    cfg.SMTPPort,
		User:    cfg.SMTPUser,
		Pass:    cfg.SMTPPass,
		From:    cfg.SMTPFrom,
		BaseURL: cfg.BaseURL,
		Render:  templateRender,
	}

	authService := service.NewAuthService(
		userRepo,
		tokenManager,
		sessionRepo,
		emailRepo,
		emailSender,
		redisClient,
	)

	// Middleware
	authMiddleware := middleware.NewAuthMiddleware(tokenManager, redisClient)

	// Handlers
	return &Dependencies{
		AuthHandler:    handler.NewAuthHandler(authService),
		UserHandler:    handler.NewUserHandler(userRepo),
		AvatarHandler:  handler.NewAvatarHandler(minioService, userRepo),
		AuthMiddleware: authMiddleware,
	}
}

func setupRouter(cfg *config.Config, deps *Dependencies) *gin.Engine {
	router := gin.New()
	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "healthy",
			"service": "user-service",
		})
	})

	// Email verification (public)
	router.GET("/verify-email", deps.AuthHandler.VerifyEmail)

	// API v1
	v1 := router.Group("/api/v1")
	{
		// Auth routes (public)
		auth := v1.Group("/auth")
		{
			auth.POST("/register", deps.AuthHandler.Register)
			auth.POST("/login", deps.AuthHandler.Login)
			auth.POST("/logout", deps.AuthHandler.Logout)
			auth.POST("/refresh", deps.AuthHandler.RefreshToken)
		}

		// Protected routes
		protected := v1.Group("")
		protected.Use(deps.AuthMiddleware.RequireAuth())
		{
			// Auth (protected)
			authProtected := protected.Group("/auth")
			{
				authProtected.POST("/logout-all", deps.AuthHandler.LogoutAll)
				authProtected.GET("/sessions", deps.AuthHandler.GetActiveSessions)
				authProtected.POST("/resend-verification", deps.AuthHandler.ResendVerificationEmail)
			}

			// Users
			users := protected.Group("/users")
			{
				users.GET("/me", deps.UserHandler.GetMe)
				users.PUT("/me", deps.UserHandler.UpdateMe)
				users.DELETE("/me", deps.UserHandler.DeleteMe)
				users.GET("/:id", deps.UserHandler.GetUserByID)

				// Avatar
				users.POST("/upload-avatar", deps.AvatarHandler.UploadAvatar)
				users.GET("/avatar", deps.AvatarHandler.GetAvatar)
				users.DELETE("/avatar", deps.AvatarHandler.DeleteAvatar)
				users.GET("/:id/avatar", deps.AvatarHandler.GetUserAvatar)
			}
		}
	}

	return router
}
