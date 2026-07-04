#!/bin/bash
set -eu

# Production deployment script for Hetzner VPS

echo "🚀 Deploying to production..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env not found"
    echo "📝 Copy .env.example to .env and fill in values"
    exit 1
fi

read_env() {
    awk -F= -v key="$1" '$1 == key { sub(/\r$/, "", $0); print substr($0, length(key) + 2); exit }' .env
}

DOMAIN="$(read_env DOMAIN)"
POSTGRES_PASSWORD="$(read_env POSTGRES_PASSWORD)"
OPENAI_API_KEY="$(read_env OPENAI_API_KEY)"

# Validate required vars
if [ -z "$DOMAIN" ]; then
    echo "❌ DOMAIN not set in .env"
    exit 1
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "❌ POSTGRES_PASSWORD not set in .env"
    exit 1
fi

if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ OPENAI_API_KEY not set in .env"
    exit 1
fi

if [ ! -f docker/seaweedfs/s3.prod.json ]; then
    echo "❌ docker/seaweedfs/s3.prod.json not found"
    echo "📝 Copy docker/seaweedfs/s3.prod.json.example and fill in production S3 credentials"
    exit 1
fi

echo "📦 Building production images..."
docker compose -f docker-compose.prod.yml build api web

echo "🚀 Starting production services..."
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "✅ Deployment complete!"
echo ""
echo "🌐 Your app is now running at: https://${DOMAIN}"
echo ""
echo "📊 Check logs:"
echo "  docker compose -f docker-compose.prod.yml logs -f"
echo ""
echo "🔍 Check status:"
echo "  docker compose -f docker-compose.prod.yml ps"
