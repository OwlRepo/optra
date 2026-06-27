#!/bin/bash
# Verify environment variable setup across local and production

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Verifying environment configuration..."
echo ""

# Check root .env files
echo "📁 Checking root environment files:"
if [ -f .env.local ]; then
    echo -e "${GREEN}✓${NC} .env.local exists"
else
    echo -e "${YELLOW}⚠${NC}  .env.local missing (needed for local dev)"
fi

if [ -f .env.production ]; then
    echo -e "${GREEN}✓${NC} .env.production exists"
else
    echo -e "${YELLOW}⚠${NC}  .env.production missing (needed for prod deployment)"
fi

if [ -f .env.example ]; then
    echo -e "${GREEN}✓${NC} .env.example exists"
else
    echo -e "${RED}✗${NC} .env.example missing"
fi

echo ""

# Check for rogue .env files in apps
echo "🚫 Checking for app-level .env files (should NOT exist):"
ROGUE_FILES=$(find apps packages -name ".env*" -type f 2>/dev/null || true)
if [ -z "$ROGUE_FILES" ]; then
    echo -e "${GREEN}✓${NC} No app-level .env files found (correct)"
else
    echo -e "${RED}✗${NC} Found app-level .env files (should be removed):"
    echo "$ROGUE_FILES"
fi

echo ""

# Check turbo.json configuration
echo "⚙️  Checking turbo.json:"
if grep -q "globalEnv" turbo.json; then
    echo -e "${GREEN}✓${NC} globalEnv configured"
    ENV_COUNT=$(grep -A20 "globalEnv" turbo.json | grep -c "\"" || true)
    echo "   → $ENV_COUNT environment variables declared"
else
    echo -e "${YELLOW}⚠${NC}  globalEnv not configured"
fi

echo ""

# Check docker-compose.prod.yml
echo "🐳 Checking docker-compose.prod.yml:"
if grep -q "env_file:" docker-compose.prod.yml; then
    echo -e "${GREEN}✓${NC} env_file directive present"
    COUNT=$(grep -c "env_file:" docker-compose.prod.yml || true)
    echo "   → $COUNT services configured to load .env.production"
else
    echo -e "${RED}✗${NC} env_file directive missing"
fi

echo ""

# Check required variables in .env.local
if [ -f .env.local ]; then
    echo "🔑 Checking required variables in .env.local:"
    REQUIRED_VARS=("DATABASE_URL" "REDIS_HOST" "REDIS_PORT" "OPENAI_API_KEY" "NEXT_PUBLIC_API_URL")
    
    for VAR in "${REQUIRED_VARS[@]}"; do
        if grep -q "^${VAR}=" .env.local; then
            VALUE=$(grep "^${VAR}=" .env.local | cut -d= -f2-)
            if [[ "$VALUE" == *"your-key-here"* ]] || [[ "$VALUE" == *"sk-..."* ]]; then
                echo -e "${YELLOW}⚠${NC}  $VAR: placeholder value (needs update)"
            else
                echo -e "${GREEN}✓${NC} $VAR: set"
            fi
        else
            echo -e "${RED}✗${NC} $VAR: missing"
        fi
    done
fi

echo ""

# Check Docker infrastructure
echo "🐳 Checking Docker infrastructure:"
if docker compose ps --quiet postgres >/dev/null 2>&1; then
    if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} PostgreSQL running and healthy"
    else
        echo -e "${YELLOW}⚠${NC}  PostgreSQL running but not ready"
    fi
else
    echo -e "${YELLOW}⚠${NC}  PostgreSQL not running (start with: docker compose up -d)"
fi

if docker compose ps --quiet redis >/dev/null 2>&1; then
    if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Redis running and healthy"
    else
        echo -e "${YELLOW}⚠${NC}  Redis running but not ready"
    fi
else
    echo -e "${YELLOW}⚠${NC}  Redis not running (start with: docker compose up -d)"
fi

echo ""
echo "✨ Verification complete!"
echo ""
echo "Next steps:"
echo "  • For local dev: docker compose up -d && bun run dev"
echo "  • For production: docker compose -f docker-compose.prod.yml up -d"
echo ""
