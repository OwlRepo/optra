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

Turborepo + Bun 1.2.x workspaces monorepo. `apps/web` (Next.js) and `apps/api` (NestJS) are the two deployable apps; `packages/db`, `packages/ai`, `packages/ui`, `packages/types` are internal workspace packages consumed via `@repo/*` imports. `apps/api`'s Docker/Turbo build graph is exactly `@repo/api` + `@repo/ai` + `@repo/db`; `apps/web`'s is exactly `@repo/web` + `@repo/ui` — verify with `bunx turbo run build --filter=<app>... --dry=json` before trusting either graph after a dependency change (see `docs/ai/testing-strategy.md`).

## Frontend

### Framework

Next.js 14.2.x App Router, React 18, Tailwind v4, TypeScript. `@repo/ui` (`packages/ui`) is the shared shadcn-derived component library — Button/Input/Card/Badge/Avatar/Modal/Table/Pagination/AppShell/MobileNavDrawer/etc; design tokens live in `packages/ui/src/globals.css` per `DESIGN.md`.

### Key Areas

- `apps/web/app/page.tsx` — public marketing landing page (Tiny risk, no data fetching).
- `apps/web/app/(auth)/{login,register,verify-otp}/page.tsx` — auth flow pages.
- `apps/web/app/workspaces/page.tsx` — workspace list/create picker.
- `apps/web/app/workspaces/[id]/*` — 9 workspace-scoped pages sharing the `AppShell` sidebar/mobile-nav model: Overview (`page.tsx`), Knowledge Bases (`knowledge-bases/page.tsx` + `[kbId]/page.tsx` for documents/crawl), Members (`members/page.tsx`), Chat (`chat/page.tsx`, the one page using `mobileFullBleed`), Tickets (`tickets/page.tsx`), Datasets (`datasets/page.tsx`, V2), Insights (`insights/page.tsx`, V2 — 3 tabs: freshness flags, FAQ drafts, coverage dashboard), Settings (`settings/page.tsx` — workspace rename, change password, digest settings, card-per-section layout as of 2026-07-08).
- `apps/web/app/invite/[token]/page.tsx` — invite acceptance.
- `apps/web/app/api/**` — same-origin BFF proxy routes, one per backend endpoint family (see API Client below).
- Full per-file detail: `docs/ai/file-index/repository-map.md`; per-domain ownership: `docs/ai/module-ownership-map.md`.

### Routing

Next.js file-based App Router. `apps/web/middleware.ts` gate-checks the `mnemra_rt` refresh-token cookie and redirects unauthenticated visitors away from `/chat`/`/workspaces`; it also transparently refreshes an expired `mnemra_at` access-token cookie on page navigation. Legacy `/chat` (`apps/web/app/chat/page.tsx`) auto-forwards to `/workspaces/:id/chat` for the user's first workspace. `/dashboard` is retired (folded into workspace Overview, 2026-07-01).

### State Management

No global state library (no Redux/Zustand/Context-based store) — each page owns local component state and fetches its own data through the thin per-domain client libs in `apps/web/src/lib/api/*.ts`. Chat streaming state is owned by the Vercel AI SDK's `useChat` hook, pointed at the same-origin `/api/workspaces/[id]/chat` proxy.

### API Client

`apps/web/src/lib/api/client.ts` exports `apiFetch`/`uploadFile` — shared fetch helpers used by every domain's client lib (`auth.ts`, `workspaces.ts`, `documents.ts`, `chat.ts`, `tickets.ts`, `scrape.ts`, `refine.ts`, `insights.ts`, `digest-settings.ts`, etc). As of 2026-07-08, both helpers retry once through `POST /api/auth/refresh` on a 401 (excluding the unauthenticated auth endpoints and the refresh endpoint itself), sharing one in-flight refresh promise across concurrent 401s, so a client-side fetch from an already-open page survives a mid-session access-token expiry instead of forcing a silent logout. Same-origin proxy routes under `apps/web/app/api/**` convert the `mnemra_at` httpOnly cookie into a backend `Authorization: Bearer` header via `apps/web/src/lib/http/auth-proxy.ts` (`proxyJson`/`proxyRaw`) — the proxy never owns auth/RBAC decisions, only credential translation; `apps/api` guards remain the actual enforcement point.

## Backend

### Framework

NestJS 10, Bull 4 job queues on Redis, Passport JWT + email OTP (Resend). Runtime resolves `@repo/ai`/`@repo/db` as normal built workspace packages (each package's `dist/index.js`), not tsconfig `paths` source aliases — see the CONTEXT DRIFT note below for why that matters.

### Key Modules

`auth`, `workspaces`, `knowledge-bases`, `documents`, `ingest`, `chat`, `cache`, `limits`, `refine`, `scrape`, `tickets`, `search`, `events`, `storage`, `health` (Priority 1-3 product surface), plus the V2 batch: `datasets`, `structured-query` (DuckDB text-to-SQL engine), `insights` (freshness detector, auto-FAQ, coverage dashboard, weekly digest — all built on a shared Bull-repeatable-job scheduler substrate first introduced in this batch). Full per-file detail in `docs/ai/file-index/repository-map.md`.

### API Routes

Tenant-scoped resources are nested under `/workspaces/:workspaceId/*` and guarded `JwtAuthGuard` → `WorkspaceMemberGuard` → `RolesGuard` (order matters — membership is resolved before role checks). `/auth/*` is the public+bearer-authenticated exception. Full request/response contract table, including the offset-pagination convention (`{items, page, pageSize, total, totalPages}`) that admin list endpoints are migrating to: `docs/ai/contracts/api-contracts.md`.

### Services

Cross-cutting services worth knowing before touching adjacent code: `CacheService` (`apps/api/src/cache`, exact Redis + semantic pgvector chat-answer cache, workspace+version scoped), `RateLimitService`/`UsageService` (`apps/api/src/limits`, per-user/per-workspace chat rate limits + monthly token budget, both fail-open on Redis errors), `StorageService` (`apps/api/src/storage`, S3-compatible object storage over SeaweedFS locally), `DuckDbQueryService` (`apps/api/src/structured-query`, the untrusted-SQL execution boundary for the V2 datasets/ticket-trends/cross-file-comparison features — see `docs/ai/risk-register.md` "Structured SQL Execution" before touching it), `BackgroundRunsService` (`apps/api/src/insights`, the V2 scheduler substrate's status/lastError anchor for jobs with no natural entity row).

CONTEXT DRIFT resolved 2026-06-30 for chat path:
- `apps/api/src/cache/cache.service.ts` adds answer caching in API layer, not `packages/ai`.
- Runtime order is exact Redis cache -> semantic pgvector cache (`chat_cache`) -> normal retrieval/LLM path.
- Workspace cache invalidation is version-based and is bumped from document delete + ingest completion.

### Middleware

TODO: Fill after repository analysis. Do not treat as verified.

## Database / Schema

### ORM / Query Builder

Drizzle ORM on PostgreSQL 16 + the `pgvector` extension (0.8.3 installed, hnsw index support). `packages/db/src/db/index.ts` exports the client + the raw `pg.Pool` (exported specifically so tests can close the connection cleanly).

### Key Models

Core product tables: `users`, `otps`, `refresh_tokens`, `workspaces`, `workspace_members`, `invitations`, `knowledge_bases`, `documents`, `chunks` (shared vector store for both document- and ticket-backed embeddings, exactly-one-parent CHECK constraint), `chat_sessions`, `chat_messages`, `chat_cache`, `saved_refined_messages`, `scrape_runs`, `tickets`, `workspace_events`. V2 batch tables (all 2026-07-08): `chat_query_metrics`, `datasets`, `background_runs`, `document_review_flags`, `faq_drafts`, `workspace_digest_settings`. Every tenant table carries `workspace_id` and every query hand-carries a `WHERE workspace_id = ...` guard — there is no Postgres RLS (see `docs/PRODUCTION-READINESS.md` A7). Full field/invariant/mutation-path table: `docs/ai/contracts/db-contracts.md`.

### Migrations

`packages/db/drizzle/*`, numbered sequentially `0000`–`0019` as of 2026-07-08. All additive except migration `0016` (F2 ticket trends), which `ALTER`s the hot `tickets` table to add nullable `category`/`resolvedAt`/`assigneeId` columns — the one non-purely-additive change in the set, still non-destructive. Known drizzle-kit quirk: generated `vector(1536)` columns come out quoted (`"vector(1536)"`), which Postgres rejects — hand-fix to unquoted `vector(1536)` before applying (hit in migrations `0014`/`0015`, see `docs/ai/risk-register.md`). After any `packages/db/src/schema/*` change, run `bun run --cwd packages/db build` before API e2e/runtime verification so `@repo/db`'s `dist/*` stays aligned with the schema `apps/api`'s Nest runtime actually resolves.

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

CONTEXT DRIFT resolved 2026-07-01/04 for workspace runtime packaging:
- `apps/api` runtime build no longer uses tsconfig `paths` aliases for `@repo/ai` or `@repo/db`, and `apps/api/package.json` no longer declares a stale `@repo/types` dependency.
- SWC/nest runtime now resolves those imports as normal workspace packages through `node_modules`, landing on each package `dist/index.js`.
- `apps/api` Jest unit tests still map `@repo/*` to package `src`, while e2e maps to built `dist` packages to match real runtime boot.
- `packages/ai/src/loaders/pdf.ts` now uses the exported `pdf-parse` API (`PDFParse`) instead of the no-longer-exported `pdf-parse/lib/pdf-parse.js` internal path, and lazy-imports it inside `loadPDF()` so API bootstrap does not load pdfjs/DOMMatrix code unless a PDF is ingested.
- `packages/ai/src/web/crawl.ts` lazy-imports ESM-only `p-limit` inside `crawlSite()` so the CommonJS `@repo/ai` package can be imported by the API without a top-level `ERR_REQUIRE_ESM` boot failure.
- `apps/web` source imports only `@repo/ui`; Docker/Turbo prod build graph is intentionally root + `@repo/web` + `@repo/ui`, and stale web deps/aliases for `@repo/ai`, `@repo/types`, `@ai-sdk/openai`, and `langchain` were removed.

CONTEXT DRIFT resolved 2026-07-01 for queue reliability:
- `documents` and `scrape_runs` now persist queue linkage (`queue_job_id`, `enqueued_at`) so API rows can be reconciled against Bull after dev-watch restarts or lost jobs.
- `documents` also persist `processing_started_at` and `last_error`; ingest startup now fails stale `pending`/`processing` rows whose Bull jobs are missing after grace periods.
- scrape startup now fails stale `queued`/`running` rows with missing Bull jobs and reuses an existing in-flight run for duplicate `workspaceId + knowledgeBaseId + seedUrl` requests instead of creating a second crawl row.
- `POST /workspaces/:workspaceId/knowledge-bases/:kbId/scrape` keeps the same body shape but now returns `200` when reusing an in-flight run and `202` when queueing a new one.
- scrape runs now persist `last_progress_at`, default crawl scope to the seed subtree when `includePrefixes` is omitted, stream live `pagesFound/pagesSucceeded/pagesFailed` updates during crawl, and fail `running` rows after 5 minutes with no progress heartbeat.
- knowledge-base document queue UI now sorts in-flight rows first and shows truthful live counts (`pending`, `processing`, `done`, `failed`) instead of treating total documents as “in queue”.

### Request/Response Patterns

Tenant-scoped list endpoints are mid-migration (since 2026-07-04) from keyset cursor pagination (`{items, nextCursor}`) to offset pagination (`{items, page, pageSize, total, totalPages}`, shared `OffsetQueryDto`/`resolveOffsetPage()`/`buildOffsetResult()` helpers) — per-endpoint status is tracked in `docs/ai/contracts/api-contracts.md`, do not assume a list endpoint's shape without checking that table. Chat's streamed answer endpoint carries citations/session-id/cache-status in response headers (`X-Chat-Sources`, `X-Chat-Session-Id`, `X-Chat-Cache`) rather than the streamed body, plus two V2 additions for structured-query result state (`X-Chat-Structured-State`, `X-Chat-Structured-Candidates`). Same-origin web proxy routes under `apps/web/app/api/**` mirror backend request/response shapes 1:1 except where explicitly noted (e.g. the chat proxy normalizes the AI SDK's `{messages}` payload into the backend's `{message, sessionId?}`).

## Auth / Permissions

### Auth Strategy

JWT access token (15m, `mnemra_at` httpOnly cookie) + refresh token (7d, `mnemra_rt` httpOnly cookie, rotated on every use — reuse of an already-rotated token is treated as theft and revokes every active refresh token for that user). Email OTP verification via Resend (console-log fallback in dev when `EMAIL_OTP_ENABLED!=='true'`). The JWT payload carries only `{sub, email}` — no workspace/role claim is ever baked into the token. `apps/web`'s same-origin proxies translate the cookie into a backend `Authorization: Bearer` header per request; `apps/web/middleware.ts` handles the access-token refresh-on-navigation path, while `apps/web/src/lib/api/client.ts`'s `apiFetch`/`uploadFile` (as of 2026-07-08) handle the refresh-on-401 path for client-side data fetches from an already-open page.

### Permission Model

Workspace-scoped RBAC with three roles (`owner`/`admin`/`member`), resolved fresh per request — never cached in the JWT or anywhere client-side. Guard chain order matters: `JwtAuthGuard` (is this a valid access token) → `WorkspaceMemberGuard` (is this user a member of the route's `:workspaceId`, attaches `{workspaceId, role}` to the request) → `RolesGuard` (does `req.workspaceMember.role` satisfy the route's `@Roles(...)` decorator). General pattern: `member` = read, `owner`/`admin` = most mutations (invite, create/delete KB, start crawl, rename workspace, approve/reject FAQ drafts, manage digest settings), `owner`-only = remove member / last-owner protection. Full per-endpoint auth requirement: `docs/ai/contracts/api-contracts.md`.

## Jobs / Automations

### Job Queue

Bull 4 on Redis. Queues as of 2026-07-08: `ingest-queue`, `scrape-queue`, `ticket-extraction-queue` (Priority 1-3 product surface); `dataset-profiling-queue` (V2 S1); and the V2 S2 scheduler substrate's repeatable "tick" + per-workspace fan-out pairs — `freshness-tick-queue`/`freshness-check-queue`, `faq-cluster-tick-queue`/`faq-cluster-queue`, `topic-gap-tick-queue`/`topic-gap-queue`, `digest-tick-queue`/`digest-queue`. All Bull processors run in-process with the API HTTP server (no separate worker process yet — see `docs/PRODUCTION-READINESS.md` C4).

### Background Jobs

Priority 1-3 jobs (ingest/scrape/ticket-extraction) each persist queue linkage (`queueJobId`, `enqueuedAt`) plus lifecycle timestamps on their owning row so API startup can reconcile stale `pending`/`processing`/`queued`/`running` rows whose Bull job went missing (dev-watch restarts, lost jobs) — see `docs/ai/risk-register.md` for exact grace periods per domain. V2's scheduler substrate (`docs/ai/module-ownership-map.md` "Insights / Scheduler" row) is this repo's first *repeatable* job pattern: one Bull repeatable "tick" job per feature (weekly cron, fixed `jobId` so re-registration on every API boot is a no-op) fans out one per-workspace job, each wrapped in `BackgroundRunsService.start()/succeed()/fail()` since these jobs have no natural entity row to anchor status on the way ingest/scrape/tickets do.

## Storage

### Object Storage

SeaweedFS is the current object storage backend for local development and production planning.

- Local S3 endpoint: `http://localhost:8333`
- Local filer UI: `http://localhost:8888`
- Local master UI: `http://localhost:9333`
- Bucket name: `mnemra-documents`

SeaweedFS uses S3-compatible auth from env (`S3_*`) plus an identities JSON file mounted into the container.
Production deploys generate that identity JSON from `.env`, keep it readable by the SeaweedFS
container user, and force-recreate containers so changed credentials are reloaded before API/Web
health and S3 round-trip checks pass.

### Storage Service

`apps/api/src/storage/storage.service.ts` owns object-storage access:
- `ensureBucket()` on module init
- `save(key, body, contentType?)`
- `getBuffer(key)` for exact-byte API downloads
- `getToTempFile(key)` for downstream loader/ingest steps
- `delete(key)`

Slice 3A added infra + storage abstraction + schema groundwork. Upload and ingest behavior arrived in Slice 3B. Slice 1 workspace UX added `getBuffer()` so document download endpoints can return stored bytes without invoking the ingest loader path.

## Verification Commands

Full per-app command inventory (with what each covers and known gaps) lives in `docs/ai/testing-strategy.md` — this section is a quick pointer only, do not treat it as the source of truth for a new command.

### Type Check

Root: `bun run type-check` (turbo, runs every package). Per-app: `apps/api`/`apps/web`/`packages/db`/`packages/ai` each expose `bun run type-check` (`tsc --noEmit`).

### Lint

Root: `bun run lint` (turbo). Historically flagged broken in `docs/PRODUCTION-READINESS.md` F2 (`eslint: command not found`) as of 2026-06-30 — re-verify current state before relying on it rather than trusting that note as still current.

### Test

`apps/api`: `bun run test` (Jest unit), `bun run test:e2e` (Jest e2e, boots a real `AppModule` via Supertest), `bun run test:cov`. `apps/web`: `bun run test` (Vitest, config must stay named `.mts` — see `testing-strategy.md`). `packages/ai`: `bun run test` (Vitest). `packages/db`/`packages/ui` currently expose no test command, only `type-check`/`build`/`lint`. No Playwright/browser e2e exists anywhere in the repo yet (a logged, known gap — see the "Post-Login Redirect Target" and "Client-Side Session Refresh" rows in `docs/ai/risk-register.md`).

### Build

Root: `bun run build` (turbo, respects the per-app dependency graphs noted under Project Shape above). Docker: `docker compose build api web` (dev) / `docker compose -f docker-compose.prod.yml build api web` (prod) are the pre-flight dry-run before trusting a live deploy — see `docs/ai/testing-strategy.md`'s Infrastructure/Docker/Deployment Verification section for the full operational checklist (this is Deep-task infra verification, not a Jest command).
