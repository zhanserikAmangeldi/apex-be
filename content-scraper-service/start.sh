#!/bin/bash
set -e

echo "Running database migrations..."
python run_migrations.py

echo "Starting content-scraper-service..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
