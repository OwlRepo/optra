# Project Memory

Store:

- architecture
- business rules
- constraints
- important decisions
- lessons learned

Source of truth is the repository. This file is a map, not proof.

## Project

- Repo and product: **Optra** (confirmed 2026-08-17). `README.md` and some
  older docs still say "Mnemra"; that name is superseded. Renaming existing
  copy is separate product work, not part of this package.
- Product: multi-tenant RAG knowledge-management SaaS — connected docs
  (uploads, web scrapes, tickets) answered with citations, plus AI ticket
  extraction and procurement comparison.
- Production system: live VPS deploy, real tenant data.

## Architecture

- Turborepo + Bun `1.2.22` workspaces (`apps/*`, `packages/*`).
- `apps/web` — Next.js 14 App Router, React 18, Tailwind v4, shadcn/ui.
- `apps/api` — NestJS 10 REST API. Modules: `auth`, `workspaces`,
  `knowledge-bases`, `documents`, `ingest`, `chat`, `search`, `refine`,
  `tickets`, `scrape`, `catalog`, `datasets`, `insights`, `procurement`,
  `structured-query`, `limits`, `storage`, `events`, `notifications`,
  `cache`, `health`, `common`.
- `packages/db` — Drizzle ORM on PostgreSQL 16 + pgvector.
- `packages/ai` — LangChain/LangGraph RAG pipeline on OpenAI
  (embeddings `text-embedding-3-small`, 1536 dims).
- `packages/types` — shared contracts. `packages/ui` — design system.
- Async work: Bull queues on Redis (ingest, scrape, ticket extraction).
- Storage: S3-compatible (SeaweedFS local, S3 production).
- Deploy: GitHub Actions `.github/workflows/deploy.yml` → VPS over SSH.

## Business rules and constraints

- Workspace isolation is the trust boundary: every query on tenant tables
  filters by `workspaceId`; handlers validate caller membership.
- Answers must be cited; uncited or unsourced output is a defect.
- LLM cost controls are product features: per-user and per-workspace chat
  rate limits and the monthly workspace token budget must never be bypassed.
- Embedding dimension `1536` is schema-bound; changing the embedding model
  is a migration + reindex event, not a config tweak.
- Job status integrity: `queueJobId`, `status`, `lastError`, and timing
  fields stay accurate on any Bull processor change.
- UI changes consume design tokens from `packages/ui/src/globals.css`
  per `DESIGN.md`.

## Important decisions

- Existing project instructions in `CLAUDE.md` and `docs/ai/*` predate this
  package and remain authoritative. See `runtime/claude.md` for precedence.
- Codex is retired in this repository. See `runtime/codex.md`.

## Lessons learned

Recorded in `learnings.md` (repo root) and
`.ai-engineering/memory/lessons-learned.md`.
