package migration

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/lib/pq"
)

type Migrator struct {
	dbURL          string
	migrationsPath string
}

func NewMigrator(dbURL, migrationsPath string) *Migrator {
	return &Migrator{
		dbURL:          dbURL,
		migrationsPath: migrationsPath,
	}
}

func (m *Migrator) Up() error {
	migrator, err := m.createMigrator()
	if err != nil {
		return err
	}

	if err := migrator.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migration up failed: %w", err)
	}

	return nil
}

func (m *Migrator) Down() error {
	migrator, err := m.createMigrator()
	if err != nil {
		return err
	}

	if err := migrator.Down(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migration down failed: %w", err)
	}

	return nil
}

func (m *Migrator) Version() (uint, bool, error) {
	migrator, err := m.createMigrator()
	if err != nil {
		return 0, false, err
	}

	return migrator.Version()
}

func (m *Migrator) Steps(n int) error {
	migrator, err := m.createMigrator()
	if err != nil {
		return err
	}

	return migrator.Steps(n)
}

func (m *Migrator) createMigrator() (*migrate.Migrate, error) {
	db, err := sql.Open("postgres", m.dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return nil, fmt.Errorf("failed to create driver: %w", err)
	}

	migrator, err := migrate.NewWithDatabaseInstance(
		fmt.Sprintf("file://%s", m.migrationsPath),
		"postgres",
		driver,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create migrator: %w", err)
	}

	return migrator, nil
}

// AutoMigrate - запускает миграции автоматически
func AutoMigrate(dbURL string) error {
	m := NewMigrator(dbURL, "/app/internal/migration/migrations")
	return m.Up()
}
