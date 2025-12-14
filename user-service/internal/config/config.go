package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port         string
	DBHost       string
	DBPort       string
	DBUser       string
	DBPassword   string
	DBName       string
	DBUrl        string
	RedisHost    string
	RedisPort    string
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMPTPass     string
	SMTPFrom     string
	MinioHost    string
	MinioApiPort string
	MinioUser    string
	MinioPass    string
	JWTSecret    string
}

func LoadConfig() *Config {
	cfg := &Config{
		Port:         getEnv("HTTP_PORT", "8080"),
		DBHost:       getEnv("DB_HOST", "localhost"),
		DBPort:       getEnv("DB_PORT", "5432"),
		DBUser:       getEnv("DB_USER", "user-service"),
		DBPassword:   getEnv("DB_PASSWORD", "user-service"),
		DBName:       getEnv("DB_NAME", "user-service"),
		RedisHost:    getEnv("REDIS_HOST", "localhost"),
		RedisPort:    getEnv("REDIS_PORT", "6379"),
		SMTPHost:     getEnv("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort:     getEnvInt("SMTP_PORT", 587),
		SMTPUser:     getEnv("SMTP_USER", "user-service@gmail.com"),
		SMPTPass:     getEnv("SMTP_PASSWORD", "smtp-service"),
		SMTPFrom:     getEnv("SMTP_FROM", "<nonreplay>@example.com"),
		MinioHost:    getEnv("MINIO_HOST", "localhost"),
		MinioApiPort: getEnv("MINIO_PORT", "9000"),
		MinioUser:    getEnv("MINIO_USER", "admin"),
		MinioPass:    getEnv("MINIO_PASSWORD", "admin123"),
		JWTSecret:    getEnv("JWT_SECRET", "user-service-secret-word"),
	}

	cfg.DBUrl = cfg.getDBUrl()

	return cfg
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		valueInt, err := strconv.Atoi(value)
		if err != nil {
			return defaultValue
		}
		return valueInt
	}
	return defaultValue
}

func (cfg *Config) getDBUrl() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)
}
