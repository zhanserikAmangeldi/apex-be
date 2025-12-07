package config

import (
	"fmt"
	"os"
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
	JWTSecret    string
	SMTPHost     string
	SMTPPort     string
	SMTPUsername string
	SMTPPassword string
	FromEmail    string
}

func LoadConfig() *Config {
	cfg := &Config{
		Port:         getEnv("HTTP_PORT", "8080"),
		DBHost:       getEnv("USER_DB_HOST", "localhost"),
		DBPort:       getEnv("USER_DB_PORT", "5432"),
		DBUser:       getEnv("USER_DB_USER", "user-service"),
		DBPassword:   getEnv("USER_DB_PASSWORD", "user-service"),
		DBName:       getEnv("USER_DB_NAME", "user-service"),
		JWTSecret:    getEnv("JWT_SECRET", "user-service-secret-word"),
		SMTPHost:     getEnv("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort:     getEnv("SMTP_PORT", "587"),
		SMTPUsername: getEnv("SMTP_USERNAME", ""),
		SMTPPassword: getEnv("SMTP_PASSWORD", ""),
		FromEmail:    getEnv("FROM_EMAIL", ""),
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

func (cfg *Config) getDBUrl() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)
}
