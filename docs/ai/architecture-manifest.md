# Architecture Manifest

Purpose:

Dense project map.

This file is map only.

It is not proof of behavior.

Verify all conclusions against real source code, tests, types, schemas, routes, controllers, services, stores, components, API contracts, database definitions.

If this map conflicts with source code, source code wins.

Mark stale or conflicting entries as `CONTEXT DRIFT`.

---

## Project Shape

TODO: Fill after repository analysis. Do not treat as verified.

## Frontend

### Framework

TODO: Fill after repository analysis. Do not treat as verified.

### Key Areas

TODO: Fill after repository analysis. Do not treat as verified.

### Routing

TODO: Fill after repository analysis. Do not treat as verified.

### State Management

TODO: Fill after repository analysis. Do not treat as verified.

### API Client

TODO: Fill after repository analysis. Do not treat as verified.

## Backend

### Framework

TODO: Fill after repository analysis. Do not treat as verified.

### Key Modules

TODO: Fill after repository analysis. Do not treat as verified.

### API Routes

TODO: Fill after repository analysis. Do not treat as verified.

### Services

TODO: Fill after repository analysis. Do not treat as verified.

CONTEXT DRIFT resolved 2026-06-30 for chat path:
- `apps/api/src/cache/cache.service.ts` adds answer caching in API layer, not `packages/ai`.
- Runtime order is exact Redis cache -> semantic pgvector cache (`chat_cache`) -> normal retrieval/LLM path.
- Workspace cache invalidation is version-based and is bumped from document delete + ingest completion.

### Middleware

TODO: Fill after repository analysis. Do not treat as verified.

## Database / Schema

### ORM / Query Builder

TODO: Fill after repository analysis. Do not treat as verified.

### Key Models

TODO: Fill after repository analysis. Do not treat as verified.

### Migrations

TODO: Fill after repository analysis. Do not treat as verified.

## API Contracts

### FE-BE Communication

CONTEXT DRIFT resolved 2026-06-30 for chat path:
- Legacy `apps/web/app/api/chat/route.ts` edge route that called OpenAI directly is removed.
- Browser chat now flows through `apps/web/app/workspaces/[id]/chat/page.tsx` → same-origin workspace chat proxies → `apps/api/src/chat/*` → `packages/ai/src/chains/index.ts`.
- Streaming protocol remains plain text for `useChat`, while citations/session id/cache status travel in response headers and full citations persist in `chat_messages.sources`.

CONTEXT DRIFT resolved 2026-07-01 for production-RAG controls:
- `apps/api/src/limits/*` adds Redis-backed per-user/per-workspace chat rate limits plus miss-path monthly workspace token budgets.
- Budget and rate counters fail open on Redis errors so counter outages do not block chat.
- `packages/ai/src/chains/index.ts` now gates a conditional LangGraph path behind `LANGGRAPH_ENABLED=false` by default.
- LangGraph miss path routes retrieval score → direct generate, rewrite loop, or fallback; optional self-grade/regenerate remains off by default.
- Offline quality measurement now lives in `scripts/eval/*` and is not imported into app runtime.

CONTEXT DRIFT resolved 2026-07-01 for workspace runtime packaging:
- `apps/api` runtime build no longer uses tsconfig `paths` aliases for `@repo/ai`, `@repo/db`, or `@repo/types`.
- SWC/nest runtime now resolves those imports as normal workspace packages through `node_modules`, landing on each package `dist/index.js`.
- `apps/api` Jest unit tests still map `@repo/*` to package `src`, while e2e maps to built `dist` packages to match real runtime boot.
- `packages/ai/src/loaders/pdf.ts` now uses the exported `pdf-parse` API (`PDFParse`) instead of the no-longer-exported `pdf-parse/lib/pdf-parse.js` internal path, so API bootstrap survives on current Node.

CONTEXT DRIFT resolved 2026-07-01 for queue reliability:
- `documents` and `scrape_runs` now persist queue linkage (`queue_job_id`, `enqueued_at`) so API rows can be reconciled against Bull after dev-watch restarts or lost jobs.
- `documents` also persist `processing_started_at` and `last_error`; ingest startup now fails stale `pending`/`processing` rows whose Bull jobs are missing after grace periods.
- scrape startup now fails stale `queued`/`running` rows with missing Bull jobs and reuses an existing in-flight run for duplicate `workspaceId + knowledgeBaseId + seedUrl` requests instead of creating a second crawl row.
- `POST /workspaces/:workspaceId/knowledge-bases/:kbId/scrape` keeps the same body shape but now returns `200` when reusing an in-flight run and `202` when queueing a new one.
- scrape runs now persist `last_progress_at`, default crawl scope to the seed subtree when `includePrefixes` is omitted, stream live `pagesFound/pagesSucceeded/pagesFailed` updates during crawl, and fail `running` rows after 5 minutes with no progress heartbeat.
- knowledge-base document queue UI now sorts in-flight rows first and shows truthful live counts (`pending`, `processing`, `done`, `failed`) instead of treating total documents as “in queue”.

### Request/Response Patterns

TODO: Fill after repository analysis. Do not treat as verified.

## Auth / Permissions

### Auth Strategy

TODO: Fill after repository analysis. Do not treat as verified.

### Permission Model

TODO: Fill after repository analysis. Do not treat as verified.

## Jobs / Automations

### Job Queue

TODO: Fill after repository analysis. Do not treat as verified.

### Background Jobs

TODO: Fill after repository analysis. Do not treat as verified.

## Storage

### Object Storage

SeaweedFS is the current object storage backend for local development and production planning.

- Local S3 endpoint: `http://localhost:8333`
- Local filer UI: `http://localhost:8888`
- Local master UI: `http://localhost:9333`
- Bucket name: `mnemra-documents`

SeaweedFS uses S3-compatible auth from env (`S3_*`) plus an identities JSON file mounted into the container.

### Storage Service

`apps/api/src/storage/storage.service.ts` owns object-storage access:
- `ensureBucket()` on module init
- `save(key, body, contentType?)`
- `getToTempFile(key)` for downstream loader/ingest steps
- `delete(key)`

Slice 3A adds only infra + storage abstraction + schema groundwork. Upload and ingest behavior arrive in Slice 3B.

## Verification Commands

### Type Check

TODO: Fill after repository analysis. Do not treat as verified.

### Lint

TODO: Fill after repository analysis. Do not treat as verified.

### Test

TODO: Fill after repository analysis. Do not treat as verified.

### Build

TODO: Fill after repository analysis. Do not treat as verified.
