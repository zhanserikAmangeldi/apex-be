package main

import (
	"context"
	"errors"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/handler"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/middleware"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/repository"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/service"
	"github.com/zhanserikAmangeldi/apex-be/user-service/pkg/jwt"
	"log"
	"net/http"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/config"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/migration"
)

func main() {
	cfg := config.LoadConfig()
	ctx := context.Background()

	dbPool, err := pgxpool.New(ctx, cfg.DBUrl)
	if err != nil {
		log.Fatalf("unable to connect to database: %v", err)
	}
	defer dbPool.Close()

	if err := dbPool.Ping(ctx); err != nil {
		log.Fatalf("unable to ping database: %v", err)
	}
	log.Println("connected to PostgreSQL")

	log.Println("running migrations")
	if err := migration.AutoMigrate(cfg.DBUrl); err != nil {
		log.Fatalf("migration failed: %v", err)
	}
	log.Println("migrations applied successfully")

	userRepo := repository.NewUserRepository(dbPool)
	tokenManager := jwt.NewTokenManager(cfg.JWTSecret)
	authService := service.NewAuthService(userRepo, tokenManager)
	authHandler := handler.NewAuthHandler(authService)
	userHandler := handler.NewUserHandler(userRepo)

	router := gin.Default()

	// CORS configuration
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":   "healthy",
			"service":  "user-service",
			"database": "connected",
		})
	})

	v1 := router.Group("/api/v1")
	{
		auth := v1.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
		}
	}

	protected := v1.Group("")
	protected.Use(middleware.AuthMiddleware(tokenManager))
	{

		users := protected.Group("/users")
		{
			users.GET("/me", userHandler.GetMe)
			users.PUT("/me", userHandler.UpdateMe)
			users.GET("/:id", userHandler.GetUserByID)
		}
	}

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	log.Printf("user service starting on port %s", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("failed to start server: %v", err)
	}
}
