#!/bin/bash
set -e

# Production deployment script for Hetzner VPS

echo "🚀 Deploying to production..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env not found"
    echo "📝 Copy .env.example to .env and fill in values"
    exit 1
fi

# Load environment
set -a
source .env
set +a

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

echo "📦 Building production images..."
docker compose -f docker-compose.prod.yml build api web

echo "🛑 Stopping old containers..."
docker compose -f docker-compose.prod.yml down

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
