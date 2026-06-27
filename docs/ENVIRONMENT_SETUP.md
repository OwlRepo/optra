# Environment Configuration

All applications in `apps/` share environment variables from a **single root `.env` file**.

## File Structure

```
/
├── .env.example           # Template with all variables
├── .env.local            # Local development (gitignored)
├── .env.production       # Production deployment (gitignored)
├── apps/
│   ├── api/              # ❌ NO .env files here
│   └── web/              # ❌ NO .env files here
└── packages/
    ├── ai/               # ❌ NO .env files here
    └── db/               # ❌ NO .env files here
```

## Environment Files

### `.env.local` (Local Development)

Used when running:
- `bun run dev` (Turbo + host apps)
- `bun docker:dev` (infrastructure only)

**Setup:**
```bash
cp .env.example .env.local
# Edit .env.local with your keys
```

**Variables:**
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:54321/support_brain
REDIS_HOST=localhost
REDIS_PORT=6379
OPENAI_API_KEY=sk-your-key-here
LANGSMITH_API_KEY=ls__your-key-here
LANGSMITH_PROJECT=support-second-brain
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### `.env.production` (Production Docker)

Used by `docker-compose.prod.yml` via `env_file:` directive.

**Setup:**
```bash
cp .env.example .env.production
# Edit .env.production with production values
```

**Variables:**
```bash
# Domain
DOMAIN=your-domain.com

# Database credentials
POSTGRES_USER=postgres
POSTGRES_PASSWORD=STRONG_RANDOM_PASSWORD
POSTGRES_DB=support_brain

# OpenAI
OPENAI_API_KEY=sk-prod-key

# LangSmith (optional)
LANGSMITH_API_KEY=ls__prod-key
LANGSMITH_PROJECT=support-second-brain-prod
```

## How It Works

### 1. Local Development (`bun run dev`)

```mermaid
graph LR
    A[.env.local] --> B[Turbo]
    B --> C[apps/api]
    B --> D[apps/web]
    B --> E[packages/*]
```

- **TurboRepo** loads `.env.local` at root
- `globalEnv` in `turbo.json` passes vars to all tasks
- **NestJS** (`@nestjs/config`) auto-loads from root
- **Next.js** auto-loads from root (`.env*` files)

### 2. Local Docker (`docker-compose.yml`)

```bash
docker compose up -d  # Infrastructure only
bun run dev           # Apps on host, use .env.local
```

- Postgres: `localhost:54321`
- Redis: `localhost:6379`
- Apps run on host with `.env.local`

### 3. Production Docker (`docker-compose.prod.yml`)

```yaml
services:
  api:
    env_file:
      - .env.production  # ← Loads all vars
    environment:
      DATABASE_URL: postgresql://...  # Override if needed
```

- All services load `.env.production`
- `environment:` section can override specific vars
- Variable interpolation: `${VAR_NAME}`

## TurboRepo Integration

**`turbo.json`** declares environment dependencies:

```json
{
  "globalEnv": [
    "DATABASE_URL",
    "REDIS_HOST",
    "OPENAI_API_KEY",
    ...
  ],
  "tasks": {
    "dev": {
      "env": ["DATABASE_URL", "REDIS_HOST", ...]
    },
    "build": {
      "env": ["DATABASE_URL", "OPENAI_API_KEY", ...]
    }
  }
}
```

**Why?**
- Invalidates cache when env vars change
- Ensures vars are available to all workspaces
- Documents which vars each task needs

## Verification

### Check Local Setup
```bash
# Infrastructure running?
docker ps | grep support-brain

# Vars loaded?
cd apps/api
bun run dev  # Should connect to localhost:54321

cd ../web
bun run dev  # Should see NEXT_PUBLIC_API_URL
```

### Check Production Setup
```bash
# Validate .env.production
cat .env.production

# Test variable substitution
docker compose -f docker-compose.prod.yml config | grep -A5 environment

# Deploy
docker compose -f docker-compose.prod.yml up -d
```

## Troubleshooting

### "DATABASE_URL is not defined"
- ✅ Check `.env.local` exists at root
- ✅ Check `DATABASE_URL` is in `turbo.json` globalEnv
- ✅ Restart dev server after adding var

### "Connection refused" to Postgres
- ✅ Check `docker compose ps` shows healthy
- ✅ Port is `54321` for local (not `5432`)
- ✅ Use `localhost` not `postgres` (host networking)

### Production env vars not loaded
- ✅ Check `env_file: .env.production` in docker-compose.prod.yml
- ✅ Check `.env.production` exists at root
- ✅ Run `docker compose -f docker-compose.prod.yml config` to verify

### Next.js build-time vars missing
- Public vars must be prefixed `NEXT_PUBLIC_*`
- Must be available at build time (in Dockerfile or compose)
- Check `turbo.json` build task includes the var

## Security

**Never commit:**
- `.env.local`
- `.env.production`
- Any file with real API keys

**Safe to commit:**
- `.env.example` (template only)
- `turbo.json` (var names only, no values)

**Deployment:**
```bash
# On server
cp .env.example .env.production
nano .env.production  # Fill in secrets
docker compose -f docker-compose.prod.yml up -d
```

## Adding New Variables

1. Add to `.env.example` (with placeholder)
2. Add to `.env.local` and `.env.production` (with real values)
3. Add to `turbo.json` → `globalEnv`
4. Add to task-specific `env` arrays if needed
5. Add to `docker-compose.prod.yml` `environment:` if needs interpolation
6. Update this doc

## Reference

- [TurboRepo Environment Variables](https://turbo.build/repo/docs/core-concepts/caching#environment-variables)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
- [NestJS Config Module](https://docs.nestjs.com/techniques/configuration)
- [Docker Compose env_file](https://docs.docker.com/compose/environment-variables/set-environment-variables/#use-the-env_file-attribute)
