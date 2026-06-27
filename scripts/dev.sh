#!/bin/bash
set -e

echo "🚀 Starting local development environment..."

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "⚠️  .env.local not found, copying from .env.example..."
    cp .env.example .env.local
    echo "📝 Please edit .env.local with your API keys"
fi

# Start infrastructure
echo "🐳 Starting Docker infrastructure (Postgres + Redis)..."
docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    sleep 1
done
echo "✅ PostgreSQL ready"

until docker compose exec -T redis redis-cli ping > /dev/null 2>&1; do
    sleep 1
done
echo "✅ Redis ready"

# Run database migrations
echo "🗄️  Running database migrations..."
cd packages/db
bun run db:generate
bun run db:push
cd ../..

# Start development servers
echo "🔥 Starting development servers..."
echo ""
echo "📱 Web:  http://localhost:3000"
echo "🔌 API:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Build API once
cd apps/api && bun run build && cd ../..

# Start Turbo dev
bun run dev
