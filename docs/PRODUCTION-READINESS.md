# Production Readiness Checklist

> Grounded against the codebase on 2026-06-30. Severity: 🔴 blocker · 🟠 important · 🟢 nice-to-have.
> "Demo" = a controlled single-client demo. "Prod" = real multi-tenant, paying, under load.
> Status of features: P1 (auth) ✅, P2 (workspaces/KB/docs/ingest) ✅, scrape ✅, P3 (chat RAG + history + sources) ✅. Production-RAG: Stage 1a caching (in progress), then 1b limits, 2 RAGAS, 3 LangGraph.

---

## A. Security

| # | Item | Current state (checked) | Action | Sev | Blocks |
|---|------|-------------------------|--------|-----|--------|
| A1 | **SSRF on scrape seed URL** | Fixed 2026-07-01. Scrape API rejects non-public/internal targets before queueing, and crawler revalidates every fetched URL with hostname/IP/DNS checks (`packages/ai/src/web/ssrf.ts`). | Keep allow/block rules centralized; consider optional per-workspace allow-domain lists later. | ✅ | — |
| A2 | **File upload limits** | Fixed 2026-07-01. Uploads now enforce `MAX_UPLOAD_MB` and a supported MIME/extension allowlist before storage/ingest. | Consider disk/stream storage later for larger files, but RAM-DoS gap is closed. | ✅ | — |
| A3 | **`.env.production` not gitignored** | Fixed 2026-07-01. `.env.production` and `docker/seaweedfs/s3.prod.json` are gitignored; tracked `.env.production` removed from index. | Keep verifying no prod secrets are tracked. | ✅ | — |
| A4 | **Strong secrets in prod** | `.env.example` `JWT_SECRET=change-me-in-prod`. | Generate strong `JWT_SECRET`, real `OPENAI_API_KEY`/`RESEND_*`/S3 creds; inject via secrets manager, never commit. Rotate policy. | 🔴 | Demo |
| A5 | **Security headers (helmet)** | `main.ts` sets CORS + cookies + ValidationPipe(whitelist) but no `helmet`. | Add `helmet()`; review CSP for the web app. | 🟠 | Prod |
| A6 | **Global exception filter** | None; relying on Nest defaults. | Add a global filter: safe client messages, no stack/internal leakage, structured error logging. | 🟠 | Prod |
| A7 | **DB Row-Level Security (RLS)** | No RLS in migrations; isolation is app-level (guards + `workspaceId`/`userId` filters) — correct but single-layer. | Add Postgres RLS on `chunks`, `documents`, chat tables keyed by `workspace_id` (defense-in-depth) per roadmap P3. | 🟠 | Prod |
| A8 | **Untrusted-input parsing** | Upload → `packages/ai` loaders parse user files (pdf/docx/xlsx/etc.); scrape parses arbitrary HTML. | Treat as untrusted: resource limits, timeouts, sandboxing where feasible; keep parser deps patched. | 🟠 | Prod |
| A9 | **Security review pass** | Not done. | Run `/security-review` on the branch; pen-test auth, upload, scrape, chat before launch. | 🟠 | Prod |

## B. Cost & abuse control (BPO volume)

| # | Item | Current state | Action | Sev | Blocks |
|---|------|---------------|--------|-----|--------|
| B1 | **Per-tenant rate limit + token/cost budget** | Global `ThrottlerModule` 60/min only; no per-user/workspace chat limit, no token cap. | **Stage 1b** (planned): per-user + per-workspace chat rate limit (Redis sliding window) + monthly token/cost budget, reject over-budget. | 🔴 | Prod |
| B2 | **Answer cache** | In progress. | **Stage 1a** (in progress): exact (Redis) + semantic (pgvector) cache, version-invalidated. | 🟠 | Prod |
| B3 | **Crawl/ingest bounds** | ✅ maxDepth/maxPages clamps, per-workspace doc quota, robots/UA/throttle. | Keep; expose quotas per plan tier later. | 🟢 | — |
| B4 | **Embedding/LLM cost visibility** | LangSmith traces only. | Track cost per workspace (tokens × price); surface in admin; alert on spikes. | 🟠 | Prod |

## C. Reliability & ops

| # | Item | Current state | Action | Sev | Blocks |
|---|------|---------------|--------|-----|--------|
| C1 | **Backups** | None for Postgres (pgvector) or SeaweedFS. | Automated Postgres dumps + SeaweedFS volume backups; test restore. | 🔴 | Prod |
| C2 | **Health checks** | No `/health` endpoint. | Add `/health` (DB + Redis + S3 ping) via `@nestjs/terminus`; wire to Caddy/uptime + container healthcheck. | 🟠 | Prod |
| C3 | **Error monitoring** | None. | Sentry (or similar) for API + web; alerting. | 🟠 | Prod |
| C4 | **Worker separation** | Bull `ingest-queue`/`scrape-queue` processors run IN the API process → ingest/crawl compete with chat latency. | Run a separate worker process/container for queues; scale independently. | 🟠 | Prod (load) |
| C5 | **Graceful shutdown** | Not handled. | `enableShutdownHooks`, drain Bull, close PG pool on SIGTERM. | 🟠 | Prod |
| C6 | **DB connection pooling** | `new Pool({ connectionString })` = default (max ~10); `dotenv` relative path. | Tune `max`/idle/timeouts for concurrency; consider PgBouncer; load-from-env robustly in prod. | 🟠 | Prod (load) |
| C7 | **Prod stack dry-run** | Partially de-risked 2026-07-01: local `bun run build`, `bun run --cwd apps/api start`, and `bun run --cwd apps/api dev` now boot after removing broken `@repo/*` source-path runtime aliases. Full prod compose dry-run still not done. | One full deploy dry-run (DB migrate, SeaweedFS bucket, Caddy TLS, register→chat smoke). | 🔴 | Demo |

## D. Quality (answers)

| # | Item | Current state | Action | Sev | Blocks |
|---|------|---------------|--------|-----|--------|
| D1 | **RAGAS evaluation** | Not built; LangSmith tracing ✅. | **Stage 2** (planned): faithfulness/answer-relevancy/context-precision/recall from traces, weekly; baseline before tuning. | 🟠 | Prod |
| D2 | **User feedback loop** | None. | Thumbs up/down per answer → `chat_feedback` table → surface low-rated, feed eval set. | 🟠 | Prod |
| D3 | **Conditional LangGraph** | Built, flag-off (`LANGGRAPH_ENABLED=false`). **Known limitation:** the graph path buffers the full answer and yields it as one chunk (`graph.ts` `collectAnswer`) — loses token-by-token streaming. | Before enabling in prod: restore streaming via `graph.streamEvents` (stream the `generate`/`fallback` node tokens) so chat stays progressive. | 🟠 | Prod (only if flag on) |
| D4 | **Grounding/hallucination guard** | System prompt + "I don't know" fallback ✅. | Strengthen with self-grade (D3) once measured (D1). | 🟢 | — |

## E. Observability

| # | Item | Current state | Action | Sev |
|---|------|---------------|--------|-----|
| E1 | LLM/retrieval tracing | LangSmith ✅ | Keep; ensure prod project + sampling | 🟢 |
| E2 | Structured logs + request IDs | Nest `Logger`, ad-hoc | Correlation IDs, JSON logs, ship to a log store | 🟠 |
| E3 | Product metrics | None | Cache hit-rate, p95 chat latency, cost/workspace, ingest success rate | 🟠 |

## F. Deploy / infra / process

| # | Item | Current state | Action | Sev | Blocks |
|---|------|---------------|--------|-----|--------|
| F1 | **Commit the work** | Everything uncommitted on `main` (P2 + scrape + P3 + …). | Branch off `main`; commit in logical chunks; PRs. Can't deploy uncommitted code. | 🔴 | Demo |
| F2 | **Lint tooling broken** | `bun run lint` → `eslint: command not found` (seen during slices). | Install/repair eslint config in each package so lint actually runs. | 🟠 | Prod |
| F3 | **CI** | None (`.github/workflows` absent). | CI: type-check + lint + unit + e2e (with infra services) on PR. | 🟠 | Prod |
| F4 | **Staging env** | None. | A staging deploy mirroring prod for dry-runs. | 🟠 | Prod |
| F5 | **Dockerfile hardening** | `apps/{api,web}/Dockerfile` exist; not reviewed for non-root/multi-stage/size. | Review: multi-stage, non-root user, minimal base, pinned. | 🟢 | Prod |
| F6 | **Migration runner in deploy** | Migrations run manually (`db:push`). | Run migrations as a deploy step (drizzle migrate) with the `0000–0004` history; avoid `push` in prod. | 🟠 | Prod |

Dependency pin note:
- `packages/ai` now pins `@langchain/langgraph` exactly to `0.2.39` so `bun install` cannot silently drift to the incompatible `0.2.7x` line while `@langchain/core` stays on `0.2.36`.

## G. Data / compliance (BPO = customer PII)

| # | Item | Current state | Action | Sev |
|---|------|---------------|--------|-----|
| G1 | **PII handling** | Support tickets/docs may contain customer PII; stored in DB + SeaweedFS + sent to OpenAI. | Document data flow; OpenAI data-processing terms (no-train); per-client DPA; consider PII redaction before embedding. | 🟠 |
| G2 | **Encryption at rest** | Not configured (DB volume, SeaweedFS). | Enable encryption at rest for Postgres + object storage. | 🟠 |
| G3 | **Tenant data export/delete** | Cascade deletes exist; no export; no full tenant purge endpoint. | "Delete my workspace + all data" + export, for compliance. | 🟠 |
| G4 | **Audit logging** | None. | Audit trail for sensitive actions (member changes, deletes, data access). | 🟢 |
| G5 | **Data retention** | Indefinite. | Retention policy for chat history + scraped content. | 🟢 |

## H. Product completeness

| # | Item | Current state | Action | Sev |
|---|------|---------------|--------|-----|
| H1 | **Password reset** | Auth has register/verify/login/refresh/logout — **no forgot-password flow**. Users who forget are locked out. | Add forgot-password → email reset token → set new password. | 🟠 |
| H2 | **Workspace member list/remove UI** | Backend `DELETE members/:userId` exists; no `GET members` (flagged earlier). | Add `GET /workspaces/:id/members` + member-management UI. | 🟢 |
| H3 | **Resend OTP / email change** | None. | Resend verification code; email change flow. | 🟢 |

---

## Suggested sequencing

**Before the client demo (minimum):** F1 (commit) → C7 (prod deploy dry-run) → A3/A4 (gitignore + real secrets) → live Suprema crawl + pre-seed. Everything else can follow.

**Before real production launch (blockers):** A1 (SSRF), A2 (upload limits), B1 (Stage 1b limits), C1 (backups), + A5–A9/C2–C6 hardening, D1 (RAGAS), F2/F3 (lint/CI), G1/G2 (PII/encryption), H1 (password reset), then A9 security review.

**Quality upgrades (post-launch):** Stage 3 LangGraph (D3), D2 feedback loop, the 🟢 items.

Parallelizable now while the RAG stages proceed: A1, A2, A3, A5, A6, C2, H1 are small, isolated, and don't depend on the cache/RAGAS/LangGraph work.
