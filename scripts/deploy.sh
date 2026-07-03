#!/bin/bash
set -e

# Production deployment script for Hetzner VPS

echo "🚀 Deploying to production..."

# Check if .env.prod exists
if [ ! -f .env.prod ]; then
    echo "❌ .env.prod not found"
    echo "📝 Copy .env.production to .env.prod and fill in values"
    exit 1
fi

# Load environment
set -a
source .env.prod
set +a

# Validate required vars
if [ -z "$DOMAIN" ]; then
    echo "❌ DOMAIN not set in .env.prod"
    exit 1
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "❌ POSTGRES_PASSWORD not set in .env.prod"
    exit 1
fi

if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ OPENAI_API_KEY not set in .env.prod"
    exit 1
fi

echo "📦 Building production images..."
docker compose -f docker-compose.prod.yml build --no-cache

echo "🛑 Stopping old containers..."
docker compose -f docker-compose.prod.yml down

echo "🗄️  Running database migrations..."
docker compose -f docker-compose.prod.yml up -d postgres redis
sleep 5

# Run migrations (temporary container)
docker compose -f docker-compose.prod.yml run --rm \
    -e DATABASE_URL="postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-mnemra}" \
    api sh -c "cd packages/db && bun run db:push"

echo "🚀 Starting production services..."
docker compose -f docker-compose.prod.yml up -d

echo "✅ Deployment complete!"
echo ""
echo "🌐 Your app is now running at: https://${DOMAIN}"
echo ""
echo "📊 Check logs:"
echo "  docker compose -f docker-compose.prod.yml logs -f"
echo ""
echo "🔍 Check status:"
echo "  docker compose -f docker-compose.prod.yml ps"
