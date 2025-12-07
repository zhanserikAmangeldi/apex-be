package main

import (
	"context"
	"log"

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

}
