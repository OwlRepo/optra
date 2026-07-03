# Environment Configuration

All applications in `apps/` share environment variables from a **single root `.env` file**.

## File Structure

```
/
├── .env.example           # Template with all variables (committed)
├── .env                    # Real secrets — dev AND prod (gitignored)
├── apps/
│   ├── api/              # ❌ NO .env files here
│   └── web/              # ❌ NO .env files here
└── packages/
    ├── ai/               # ❌ NO .env files here
    └── db/               # ❌ NO .env files here
```

## Environment Files

### `.env` (Local Development)

Used by `docker compose up` (`bun run docker:dev:up`) — every service, including `api` and `web`, loads this via `env_file:`.

**Setup:**
```bash
cp .env.example .env
# Edit .env with your keys
```

**Variables:**
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:54321/mnemra
REDIS_HOST=localhost
REDIS_PORT=6379
OPENAI_API_KEY=sk-your-key-here
LANGSMITH_API_KEY=ls__your-key-here
LANGSMITH_PROJECT=mnemra
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Note: inside the `api`/`web` containers, `docker-compose.yml`'s `environment:` block overrides `DATABASE_URL`/`REDIS_HOST`/etc. to point at the `postgres`/`redis`/`seaweedfs` service names rather than `localhost` — the `.env` file's `localhost`-based values are for anything you run directly on the host (e.g. `psql` against the exposed `54321` port).

### `.env` (Production Docker)

`docker-compose.prod.yml` loads the same `.env` file via `env_file:`, and Compose also auto-reads it for `${VAR}` interpolation in the compose file. On the VPS, create `.env` from the committed `.env.example` template and fill in production values.

**Setup:**
```bash
cp .env.example .env
# Edit .env with production values
```

**Variables:**
```bash
# Domain
DOMAIN=your-domain.com

# Database credentials
POSTGRES_USER=postgres
POSTGRES_PASSWORD=STRONG_RANDOM_PASSWORD
POSTGRES_DB=mnemra

# OpenAI
OPENAI_API_KEY=sk-prod-key

# LangSmith (optional)
LANGSMITH_API_KEY=ls__prod-key
LANGSMITH_PROJECT=mnemra-prod
```

## How It Works

### 1. Local Development (`docker compose up`)

```mermaid
graph LR
    A[.env] --> B[docker compose]
    B --> C[api container]
    B --> D[web container]
    C --> E[packages/* built in-image]
    D --> E
```

- `docker-compose.yml`'s `env_file: .env` injects the file's vars into the `api`/`web` containers as real environment variables
- Container-specific `environment:` overrides (`DATABASE_URL`, `REDIS_HOST`, `S3_ENDPOINT`, `API_URL`) point at Docker service names instead of `localhost`
- **NestJS** (`@nestjs/config`) reads `process.env` as normal — no dotenv file loading needed inside the container, Compose already injected everything
- **Next.js** likewise reads injected `process.env` vars at runtime; `NEXT_PUBLIC_*` vars are baked in at container build/dev-start time

### 2. Production Docker (`docker-compose.prod.yml`)

```yaml
services:
  api:
    env_file:
      - .env  # ← Loads all real secrets
    environment:
      DATABASE_URL: postgresql://...  # Override if needed
```

- All services load `.env`
- `environment:` section can override specific vars
- Variable interpolation: `${VAR_NAME}` (Compose auto-reads `.env` in the project dir for this)

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
# Full stack running?
docker compose ps | grep mnemra

# Vars loaded?
docker compose exec api printenv DATABASE_URL
docker compose exec web printenv NEXT_PUBLIC_API_URL
```

### Check Production Setup
```bash
# Validate .env
cat .env

# Test variable substitution
docker compose -f docker-compose.prod.yml config | grep -A5 environment

# Deploy
docker compose -f docker-compose.prod.yml up -d
```

## Troubleshooting

### "DATABASE_URL is not defined"
- ✅ Check `.env` exists at root
- ✅ Check `DATABASE_URL` is in `turbo.json` globalEnv
- ✅ `docker compose up --build` after adding a var (env changes need a rebuild, not just a restart, if they affect a build-time value like `NEXT_PUBLIC_*`)

### "Connection refused" to Postgres
- ✅ Check `docker compose ps` shows `mnemra-db` healthy
- ✅ From the host, port is `54321` (not `5432`); from inside a container, use service name `postgres:5432`

### Production env vars not loaded
- ✅ Check `env_file: .env` in docker-compose.prod.yml
- ✅ Check `.env` exists at root on the VPS
- ✅ Run `docker compose -f docker-compose.prod.yml config` to verify

### Next.js build-time vars missing
- Public vars must be prefixed `NEXT_PUBLIC_*`
- Must be available at build time (in Dockerfile or compose)
- Check `turbo.json` build task includes the var

## Security

**Never commit:**
- `.env`
- Any file with real API keys

**Safe to commit:**
- `.env.example` (template only)
- `turbo.json` (var names only, no values)

**Deployment:**
```bash
# On server
cp .env.example .env
nano .env  # Fill in secrets
docker compose -f docker-compose.prod.yml up -d
```

## Adding New Variables

1. Add to `.env.example` (with placeholder)
2. Add to `.env` (with real values)
3. Add to `turbo.json` → `globalEnv`
4. Add to task-specific `env` arrays if needed
5. Add to `docker-compose.prod.yml` `environment:` if needs interpolation
6. Update this doc

## Reference

- [TurboRepo Environment Variables](https://turbo.build/repo/docs/core-concepts/caching#environment-variables)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
- [NestJS Config Module](https://docs.nestjs.com/techniques/configuration)
- [Docker Compose env_file](https://docs.docker.com/compose/environment-variables/set-environment-variables/#use-the-env_file-attribute)
