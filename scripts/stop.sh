#!/bin/bash
set -e

echo "🛑 Stopping local development environment..."

# Stop Docker infrastructure
docker compose down

echo "✅ All services stopped"
echo ""
echo "Data persisted in Docker volumes:"
echo "  - postgres_data"
echo "  - redis_data"
echo ""
echo "To remove data: docker compose down -v"
