# Development Environment

> Purpose: where Optra runs locally and in production, and which doc owns the details.
> Load rule: read before manual QA, seeding, migration work, or anything that needs a running stack.
> Source of truth: `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `.claude/launch.json`, `.github/workflows/deploy.yml` and the root `package.json`. This file is a MAP; if it disagrees with them, they win and this file is fixed in the same change.

This page stays short on purpose. It routes to the doc that owns each topic:

- `DOCKER.md` — local stack, images, volumes, networks, rollback commands.
- `DEPLOYMENT.md` — VPS setup, domain, production `.env`, migrations, backups,
  troubleshooting.
- `docs/ENVIRONMENT_SETUP.md` — which env file feeds which process.
- `docs/ai/testing-strategy.md` — test prerequisites, suite inventory, the
  infra verification checklist, the seeder.

## Environments

There are two: your machine and the production VPS. No dev or stg environment
exists (`docs/PRODUCTION-READINESS.md` row F4). Every change reaches production
by merging a PR into `main` (`docs/ai/handoff.md` "Release flow").

## Local stack (Docker Compose)

Prerequisites: Docker, Bun 1.2.22 (`package.json` `packageManager`), Node 22
(`.nvmrc`; run `nvm use`, since Node 25 cannot load duckdb's native binding).

1. `cp .env.example .env` (it already matches the ports compose publishes).
2. `bun run docker:dev:up` (`docker compose up -d`). The api and web
   containers run migrations, then their dev servers with hot reload.
3. `bun run docker:dev:logs` to follow logs; `bun run docker:dev:down` to stop.

Services and host ports (`docker-compose.yml`, compose project name `optra`):

| Service | Container | Host port → container |
|---|---|---|
| Postgres 16 + pgvector (`pgvector/pgvector:pg16`) | `optra-db` | `54322` → 5432 |
| Redis | `optra-redis` | `6380` → 6379 |
| SeaweedFS S3 / filer / master | `optra-seaweedfs` | `8433` → 8333, `8988` → 8888, `9433` → 9333 |
| API (NestJS, dev target) | `optra-api` | `${OPTRA_API_PORT:-3301}` → 3001 |
| Web (Next.js, dev target) | `optra-web` | `${OPTRA_WEB_PORT:-3300}` → 3000 |
| Umami analytics (own `umami` database, created by `docker/init-db.sql`) | `optra-umami` | `${OPTRA_UMAMI_PORT:-3302}` → 3000 |

Container names are fixed, so only one stack can run per machine. Task
worktrees reuse the stack started from the primary checkout; they do not start
their own.

Inside containers the API reaches Redis on 6379; from the host it is 6380.
`REDIS_PORT=6380` in `.env.example` is the host value.

### Running the apps on the host instead

`.claude/launch.json` defines two Browser-pane dev servers that run on the host
against the compose backing services:

- `api`: `cd apps/api && bun run dev` on port 3001
- `web`: `cd apps/web && bun run dev` on port 3000

Start only `postgres redis seaweedfs` from compose when you use these, or the
containerised api/web will also be running on 3301/3300.

## Demo data

`bun run db:seed` loads a full demo tenant (documents, chunks with cached real
embeddings, tickets, chat history, insights, procurement and catalog data) plus
a login. The login's email and password constants are in
`scripts/seed/config.ts` (`DEMO_USER_EMAIL`, `DEMO_PASSWORD`).

- The seeder refuses non-local database hosts; `SEED_ALLOW_REMOTE=true`
  overrides that and must never be used against a shared database.
- `bun run db:seed --no-embeddings` skips OpenAI; `--wipe-only` removes the
  demo tenant.
- `bun run db:seed:test` runs the seeder's own tests.
- Production can seed once at boot when `SEED_DEMO_DATA=true`
  (`docker/seed-demo-if-enabled.sh`, `--once` mode).

Details: `docs/ai/testing-strategy.md` "Demo seeder (`scripts/seed/`)".

## Migrations

Drizzle migrations in `packages/db/drizzle/` are applied by
`bun run db:migrate` (in `packages/db`): by the dev api container on start, by
the CI job before the tests, and by the production API container on start. The
full rule (additive, backward compatible, owner approval for destructive
changes): `docs/ai/planning.md` "Migrations".

## Git hooks

`bun install` runs the root `prepare` script, which sets
`git config core.hooksPath scripts/git-hooks`. The setting lives in the shared
`.git` config, so it applies to every worktree. `scripts/git-hooks/pre-commit`
blocks commits on `main` and runs `bun run agents:lint` when persona files are
staged.

## Production (VPS)

- One VPS runs `docker-compose.prod.yml` (`optra-prod-*` containers) from
  `/home/deploy/apps/optra`.
- The `deploy` job in `.github/workflows/deploy.yml` runs on every push to
  `main` after `ci` passes. It SSHes in, fast-forwards `main`, runs
  `scripts/check-prod-env.sh` (a bad `.env` stops the deploy before anything
  changes), then `scripts/backup.sh --reason=deploy`, which dumps the `optra`
  and `umami` databases into `/home/deploy/apps/optra-backups`, proves each
  dump parses and restores into a throwaway database, and keeps the newest
  `BACKUP_KEEP=7` of each. It then rebuilds api and web, recreates the stack
  (`up -d --remove-orphans --force-recreate`), health-checks both apps and runs
  a production S3 put/get/delete round trip.
- The same VPS hosts a separate, unrelated app (`mnemra.tyvera.app`,
  `mnemra-prod-*`, `/home/deploy/apps/mnemra`). Never touch it from this repo
  (`docs/ai/risk-register.md`).
- A daily off-box backup runs from `.github/workflows/backup.yml` (cron
  `17 3 * * *`, `scripts/backup.sh --reason=scheduled`), which uploads both
  dumps to Backblaze B2 when the `BACKUP_S3_*` secrets are set. `deploy.yml`
  forwards no `BACKUP_S3_*` variables, so the deploy-time copy stays on the VPS
  disk unless the VPS shell sets them itself.
  Every run restore-verifies into a throwaway database. Restoring for real
  follows `docs/ops/restore.md` (`docs/ai/risk-register.md` "Backup / Restore").
