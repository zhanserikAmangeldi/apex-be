#!/bin/sh
set -e

echo "Running database migrations..."
node scripts/migrate.js

echo "Starting editor service..."
exec node src/index.js
