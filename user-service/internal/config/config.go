package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	// Server
	Port     string
	Env      string
	LogLevel string

	// Database
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
	DBUrl      string
	DBMaxConns int

	// Redis
	RedisHost string
	RedisPort string
	RedisDB   int

	// JWT
	JWTSecret          string
	JWTAccessDuration  time.Duration
	JWTRefreshDuration time.Duration

	// SMTP
	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	SMTPFrom string
	BaseURL  string

	// MinIO
	MinioHost   string
	MinioPort   string
	MinioUser   string
	MinioPass   string
	MinioUseSSL bool
}

func LoadConfig() *Config {
	cfg := &Config{
		// Server
		Port:     getEnv("HTTP_PORT", "8080"),
		Env:      getEnv("ENV", "development"),
		LogLevel: getEnv("LOG_LEVEL", "debug"),

		// Database
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBUser:     getEnv("DB_USER", "user-service"),
		DBPassword: getEnv("DB_PASSWORD", "user-service"),
		DBName:     getEnv("DB_NAME", "user-service"),
		DBMaxConns: getEnvInt("DB_MAX_CONNS", 20),

		// Redis
		RedisHost: getEnv("REDIS_HOST", "localhost"),
		RedisPort: getEnv("REDIS_PORT", "6379"),
		RedisDB:   getEnvInt("REDIS_DB", 0),

		// JWT
		JWTSecret:          getEnv("JWT_SECRET", "your-secret-key-change-in-production"),
		JWTAccessDuration:  getEnvDuration("JWT_ACCESS_DURATION", 15*time.Minute),
		JWTRefreshDuration: getEnvDuration("JWT_REFRESH_DURATION", 7*24*time.Hour),

		// SMTP
		SMTPHost: getEnv("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort: getEnvInt("SMTP_PORT", 587),
		SMTPUser: getEnv("SMTP_USER", ""),
		SMTPPass: getEnv("SMTP_PASSWORD", ""),
		SMTPFrom: getEnv("SMTP_FROM", "noreply@example.com"),
		BaseURL:  getEnv("BASE_URL", "http://localhost:8080"),

		// MinIO
		MinioHost:   getEnv("MINIO_HOST", "localhost"),
		MinioPort:   getEnv("MINIO_PORT", "9000"),
		MinioUser:   getEnv("MINIO_USER", "admin"),
		MinioPass:   getEnv("MINIO_PASSWORD", "admin123"),
		MinioUseSSL: getEnvBool("MINIO_USE_SSL", false),
	}

	cfg.DBUrl = cfg.buildDBUrl()

	return cfg
}

func (cfg *Config) buildDBUrl() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)
}

func (cfg *Config) IsDevelopment() bool {
	return cfg.Env == "development"
}

func (cfg *Config) IsProduction() bool {
	return cfg.Env == "production"
}

// Helper functions

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolVal, err := strconv.ParseBool(value); err == nil {
			return boolVal
		}
	}
	return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}
