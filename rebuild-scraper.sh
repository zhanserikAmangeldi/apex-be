#!/bin/bash

echo "🔧 Rebuilding Content Scraper Service..."
echo ""

# Stop services
echo "1. Stopping services..."
docker-compose stop content-scraper-service celery-worker celery-beat

# Remove containers
echo "2. Removing old containers..."
docker-compose rm -f content-scraper-service celery-worker celery-beat

# Remove old images
echo "3. Removing old images..."
docker images | grep content-scraper | awk '{print $3}' | xargs docker rmi -f 2>/dev/null || true

# Rebuild
echo "4. Rebuilding image (this may take a few minutes)..."
docker-compose build --no-cache content-scraper-service

# Start services
echo "5. Starting services..."
docker-compose up -d content-scraper-service celery-worker celery-beat

# Wait for startup
echo "6. Waiting for service to start..."
sleep 5

# Check health
echo "7. Checking health..."
curl -s http://localhost:8003/health || echo "Service not responding yet"

echo ""
echo "✅ Done! Check logs with:"
echo "   docker-compose logs -f content-scraper-service"
