package logger

import (
	"os"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var (
	Log   *zap.Logger
	Sugar *zap.SugaredLogger
)

type Config struct {
	Level       string // debug, info, warn, error
	Environment string // development, production
	ServiceName string
}

func Initialize(cfg Config) error {
	var config zap.Config

	if cfg.Environment == "production" {
		config = zap.NewProductionConfig()
		config.EncoderConfig.TimeKey = "timestamp"
		config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	} else {
		config = zap.NewDevelopmentConfig()
		config.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
		config.EncoderConfig.EncodeTime = zapcore.TimeEncoderOfLayout("15:04:05.000")
	}

	level, err := zapcore.ParseLevel(cfg.Level)
	if err != nil {
		level = zapcore.InfoLevel
	}
	config.Level = zap.NewAtomicLevelAt(level)

	logger, err := config.Build(
		zap.AddCallerSkip(1),
		zap.Fields(
			zap.String("service", cfg.ServiceName),
			zap.String("env", cfg.Environment),
		),
	)
	if err != nil {
		return err
	}

	Log = logger
	Sugar = logger.Sugar()

	return nil
}

func Sync() {
	if Log != nil {
		_ = Log.Sync()
	}
}

func WithRequestID(requestID string) *zap.Logger {
	return Log.With(zap.String("request_id", requestID))
}

func WithUserID(userID string) *zap.Logger {
	return Log.With(zap.String("user_id", userID))
}

func WithModule(module string) *zap.Logger {
	return Log.With(zap.String("module", module))
}

func Info(msg string, fields ...zap.Field) {
	Log.Info(msg, fields...)
}

func Debug(msg string, fields ...zap.Field) {
	Log.Debug(msg, fields...)
}

func Warn(msg string, fields ...zap.Field) {
	Log.Warn(msg, fields...)
}

func Error(msg string, fields ...zap.Field) {
	Log.Error(msg, fields...)
}

func Fatal(msg string, fields ...zap.Field) {
	Log.Fatal(msg, fields...)
}

func Audit(action string, userID string, details map[string]interface{}) {
	fields := []zap.Field{
		zap.String("type", "audit"),
		zap.String("action", action),
		zap.String("user_id", userID),
		zap.Time("timestamp", time.Now()),
	}

	for k, v := range details {
		fields = append(fields, zap.Any(k, v))
	}

	Log.Info("audit_event", fields...)
}

func Performance(operation string, duration time.Duration, details map[string]interface{}) {
	fields := []zap.Field{
		zap.String("type", "performance"),
		zap.String("operation", operation),
		zap.Duration("duration", duration),
		zap.Bool("slow", duration > time.Second),
	}

	for k, v := range details {
		fields = append(fields, zap.Any(k, v))
	}

	if duration > time.Second {
		Log.Warn("slow_operation", fields...)
	} else {
		Log.Debug("operation_complete", fields...)
	}
}

func HTTPRequest(method, path string, statusCode int, duration time.Duration, userID string) {
	level := zapcore.InfoLevel
	if statusCode >= 500 {
		level = zapcore.ErrorLevel
	} else if statusCode >= 400 {
		level = zapcore.WarnLevel
	}

	Log.Check(level, "http_request").Write(
		zap.String("type", "request"),
		zap.String("method", method),
		zap.String("path", path),
		zap.Int("status_code", statusCode),
		zap.Duration("duration", duration),
		zap.String("user_id", userID),
	)
}

func ErrorWithStack(msg string, err error, fields ...zap.Field) {
	fields = append(fields,
		zap.Error(err),
		zap.String("type", "error"),
	)
	Log.Error(msg, fields...)
}

func MustInit(cfg Config) {
	if err := Initialize(cfg); err != nil {
		panic("failed to initialize logger: " + err.Error())
	}
}

func Default() {
	env := os.Getenv("ENV")
	if env == "" {
		env = "development"
	}

	MustInit(Config{
		Level:       "debug",
		Environment: env,
		ServiceName: "user-service",
	})
}
