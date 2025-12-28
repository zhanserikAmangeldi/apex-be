package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/config"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/handler"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/mailer"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/middleware"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/migration"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/repository"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/service"
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/jwt"
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/logger"
)

func main() {
	cfg := config.LoadConfig()

	logger.MustInit(logger.Config{
		Level:       cfg.LogLevel,
		Environment: cfg.Env,
		ServiceName: "user-service",
	})
	defer logger.Sync()

	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	ctx := context.Background()

	dbPool, err := initDatabase(ctx, cfg)
	if err != nil {
		logger.Fatal("Failed to initialize database", zap.Error(err))
	}
	defer dbPool.Close()

	logger.Info("Running database migrations...")
	if err := migration.AutoMigrate(cfg.DBUrl); err != nil {
		logger.Fatal("Migration failed", zap.Error(err))
	}
	logger.Info("Migrations completed successfully")

	redisClient, err := initRedis(ctx, cfg)
	if err != nil {
		logger.Fatal("Failed to initialize Redis", zap.Error(err))
	}
	defer redisClient.Close()

	deps := initDependencies(cfg, dbPool, redisClient)

	router := setupRouter(cfg, deps)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("User service starting", zap.String("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("Failed to start server", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("Server forced to shutdown", zap.Error(err))
	}

	logger.Info("Server stopped")
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

	logger.Info("Connected to PostgreSQL")
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

	logger.Info("Connected to Redis")
	return client, nil
}

type Dependencies struct {
	AuthHandler    *handler.AuthHandler
	UserHandler    *handler.UserHandler
	AvatarHandler  *handler.AvatarHandler
	AuthMiddleware *middleware.AuthMiddleware
}

func initDependencies(cfg *config.Config, dbPool *pgxpool.Pool, redisClient *redis.Client) *Dependencies {
	userRepo := repository.NewUserRepository(dbPool)
	sessionRepo := repository.NewSessionRepository(dbPool)
	emailRepo := repository.NewEmailVerificationRepository(dbPool)

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

	authMiddleware := middleware.NewAuthMiddleware(tokenManager, redisClient)

	return &Dependencies{
		AuthHandler:    handler.NewAuthHandler(authService),
		UserHandler:    handler.NewUserHandler(userRepo),
		AvatarHandler:  handler.NewAvatarHandler(minioService, userRepo),
		AuthMiddleware: authMiddleware,
	}
}

func setupRouter(cfg *config.Config, deps *Dependencies) *gin.Engine {
	router := gin.New()

	router.Use(middleware.RequestLogger())
	router.Use(middleware.RecoveryWithLogger())

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"service":   "user-service",
			"timestamp": time.Now().Unix(),
		})
	})

	router.GET("/verify-email", deps.AuthHandler.VerifyEmail)

	v1 := router.Group("/api/v1")
	{
		auth := v1.Group("/auth")
		{
			auth.POST("/register", deps.AuthHandler.Register)
			auth.POST("/login", deps.AuthHandler.Login)
			auth.POST("/logout", deps.AuthHandler.Logout)
			auth.POST("/refresh", deps.AuthHandler.RefreshToken)
		}

		protected := v1.Group("")
		protected.Use(deps.AuthMiddleware.RequireAuth())
		{
			authProtected := protected.Group("/auth")
			{
				authProtected.POST("/logout-all", deps.AuthHandler.LogoutAll)
				authProtected.GET("/sessions", deps.AuthHandler.GetActiveSessions)
				authProtected.POST("/resend-verification", deps.AuthHandler.ResendVerificationEmail)
			}

			users := protected.Group("/users")
			{
				users.GET("/me", deps.UserHandler.GetMe)
				users.PUT("/me", deps.UserHandler.UpdateMe)
				users.DELETE("/me", deps.UserHandler.DeleteMe)
				users.GET("/:id", deps.UserHandler.GetUserByID)

				users.POST("/upload-avatar", deps.AvatarHandler.UploadAvatar)
				users.GET("/avatar", deps.AvatarHandler.GetAvatar)
				users.DELETE("/avatar", deps.AvatarHandler.DeleteAvatar)
				users.GET("/:id/avatar", deps.AvatarHandler.GetUserAvatar)
			}
		}
	}

	return router
}
