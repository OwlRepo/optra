# Mnemra

SaaS platform for knowledge management and retrieval with RAG.

## Structure

```
apps/
  web/          Next.js 14 frontend
  api/          NestJS backend
packages/
  ai/           RAG logic (LangChain)
  db/           Drizzle ORM + schema
  ui/           shadcn/ui components
  types/        Shared TypeScript types
```

## Quick Start

### Local Development
```bash
cp .env.example .env    # Configure environment
bun run docker:dev:up   # Start the full stack (postgres/redis/seaweedfs/api/web)
```
Everything runs in Docker with bind-mounted source — edit any file in `apps/` or `packages/` and it hot-reloads, no rebuild needed. Migrations run automatically on container start.

```bash
bun run docker:dev:logs # Tail logs
bun run docker:dev:down # Stop the stack
```

**Verify environment setup:**
```bash
bash scripts/verify-env.sh
```

> **📚 Environment Details:** See [docs/ENVIRONMENT_SETUP.md](./docs/ENVIRONMENT_SETUP.md) for complete guide on how all apps share a single root `.env` file across local, local docker, and production docker.

### Production Deployment
See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete guide.

```bash
# Configure production environment
cp .env.example .env
nano .env  # Fill in production secrets

# Verify setup
bash scripts/verify-env.sh

# Deploy to Hetzner VPS
./scripts/deploy-remote.sh user@your-server-ip
```

Automatic deploy on push to `main` is also available via `.github/workflows/deploy.yml` — see [DEPLOYMENT.md](./DEPLOYMENT.md) for required GitHub Secrets.

## Stack

- Turborepo + Bun workspaces
- Next.js 14, NestJS, LangChain
- Drizzle ORM, PostgreSQL, pgvector
- Tailwind v4, shadcn/ui
- Vercel AI SDK, OpenAI
