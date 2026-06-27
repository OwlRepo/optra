# Support Second Brain

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
./scripts/dev.sh
```
This starts Docker infrastructure + dev servers with hot reload.

**Or manually:**
```bash
docker compose up -d              # Start Postgres + Redis
cp .env.example .env.local        # Configure environment
bun install                       # Install dependencies
cd packages/db && bun run db:push # Run migrations
bun run dev                       # Start all apps
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
cp .env.example .env.production
nano .env.production  # Fill in production secrets

# Verify setup
bash scripts/verify-env.sh

# Deploy to Hetzner VPS
./scripts/deploy-remote.sh user@your-server-ip
```

## Stack

- Turborepo + Bun workspaces
- Next.js 14, NestJS, LangChain
- Drizzle ORM, PostgreSQL, pgvector
- Tailwind v4, shadcn/ui
- Vercel AI SDK, OpenAI
