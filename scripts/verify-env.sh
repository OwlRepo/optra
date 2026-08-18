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
if [ -f .env ]; then
    echo -e "${GREEN}✓${NC} .env exists (dev + prod runtime, gitignored)"
else
    echo -e "${YELLOW}⚠${NC}  .env missing (copy from .env.example)"
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
    echo "   → $COUNT services configured to load .env"
else
    echo -e "${RED}✗${NC} env_file directive missing"
fi

echo ""

# Check required variables in .env
if [ -f .env ]; then
    echo "🔑 Checking required variables in .env:"
    REQUIRED_VARS=("DATABASE_URL" "REDIS_HOST" "REDIS_PORT" "OPENAI_API_KEY" "NEXT_PUBLIC_API_URL")

    for VAR in "${REQUIRED_VARS[@]}"; do
        if grep -q "^${VAR}=" .env; then
            VALUE=$(grep "^${VAR}=" .env | cut -d= -f2-)
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

# Check DuckDB native binding
#
# duckdb@1.4.4 ships a prebuilt native addon per Node ABI, not per Node
# version range. Land on an ABI it does not publish and node-pre-gyp silently
# falls back to compiling from source, fails, and leaves lib/binding/ empty —
# which surfaces much later as four API test suites dying at module
# resolution with an opaque "Cannot find module .../duckdb.node". This section
# turns that into a one-line diagnosis. Known-good ABIs verified against
# npm.duckdb.org on 2026-08-18; see the comment block in apps/api/Dockerfile.
echo "🦆 Checking DuckDB native binding:"
DUCKDB_BINDING="node_modules/duckdb/lib/binding/duckdb.node"
DUCKDB_KNOWN_ABIS="115 127 137"   # Node 20, 22, 24
DUCKDB_FIX="nvm use && rm -rf node_modules/duckdb && bun install --frozen-lockfile"

if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} node not found on PATH — cannot determine the ABI DuckDB needs"
    echo "   → install Node 22 (see .nvmrc), then: $DUCKDB_FIX"
else
    NODE_VER="$(node -v 2>/dev/null || echo unknown)"
    NODE_ABI="$(node -p process.versions.modules 2>/dev/null || echo unknown)"

    # .nvmrc parity — a mismatch here is the usual reason the binding is wrong.
    if [ -f .nvmrc ]; then
        NVMRC_VER="$(tr -d ' \t\r\nv' < .nvmrc)"
        NODE_MAJOR="$(echo "$NODE_VER" | sed -E 's/^v?([0-9]+).*/\1/')"
        NVMRC_MAJOR="$(echo "$NVMRC_VER" | sed -E 's/^([0-9]+).*/\1/')"
        if [ "$NODE_MAJOR" = "$NVMRC_MAJOR" ]; then
            echo -e "${GREEN}✓${NC} Node $NODE_VER matches .nvmrc ($NVMRC_VER), ABI $NODE_ABI"
        else
            echo -e "${YELLOW}⚠${NC}  Node $NODE_VER does not match .nvmrc ($NVMRC_VER) — run: nvm use"
        fi
    else
        echo -e "${YELLOW}⚠${NC}  .nvmrc missing — nothing pins the Node version for this repo"
    fi

    # ABI vs. binding, judged together — they mean different things.
    #
    # The addon is N-API (verified: 71 napi_* symbols), so once the .node file
    # is on disk it loads under ANY Node version. What the ABI actually gates
    # is node-pre-gyp's DOWNLOAD url, which is keyed on node_abi regardless.
    # So an unpublished ABI is an install-time blocker, not a runtime one, and
    # the two failure modes need different advice.
    if echo " $DUCKDB_KNOWN_ABIS " | grep -q " $NODE_ABI "; then
        ABI_PUBLISHED=1
    else
        ABI_PUBLISHED=0
    fi

    if [ -f "$DUCKDB_BINDING" ] && node -e "require('duckdb')" >/dev/null 2>&1; then
        if [ "$ABI_PUBLISHED" -eq 1 ]; then
            echo -e "${GREEN}✓${NC} DuckDB binding present and loadable; ABI $NODE_ABI is publishable"
        else
            echo -e "${YELLOW}⚠${NC}  DuckDB binding loads (N-API is runtime-portable), but Node $NODE_VER (ABI $NODE_ABI) has no published prebuilt"
            echo "   → it works now, but a fresh clone or reinstall on this Node would leave lib/binding/ empty"
            echo "   → switch first: nvm use"
        fi
    elif [ -f "$DUCKDB_BINDING" ]; then
        echo -e "${RED}✗${NC} DuckDB binding present at $DUCKDB_BINDING but fails to load"
        echo "   → fix: $DUCKDB_FIX"
    else
        echo -e "${RED}✗${NC} DuckDB binding missing ($DUCKDB_BINDING)"
        echo "   → 4 API test suites will fail at module resolution until this exists"
        if [ "$ABI_PUBLISHED" -eq 1 ]; then
            echo "   → fix: $DUCKDB_FIX"
        else
            echo "   → Node $NODE_VER (ABI $NODE_ABI) cannot fetch it at all. DuckDB publishes ABI $DUCKDB_KNOWN_ABIS (Node 20, 22, 24); Node 23 and 25 are gaps."
            echo "   → fix: $DUCKDB_FIX"
        fi
    fi
fi

echo ""
echo "✨ Verification complete!"
echo ""
echo "Next steps:"
echo "  • For local dev: docker compose up -d"
echo "  • For production: docker compose -f docker-compose.prod.yml up -d"
echo ""
