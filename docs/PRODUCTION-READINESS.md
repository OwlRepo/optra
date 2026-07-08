# Production Readiness Checklist

> Grounded against the codebase on 2026-06-30, drift-checked 2026-07-08 against the last 3 days of commits (see rows below marked "updated 2026-07-08"; everything else unchanged since the 2026-06-30 grounding — re-verify before trusting an unmarked row on anything Deep). Severity: 🔴 blocker · 🟠 important · 🟢 nice-to-have.
> "Demo" = a controlled single-client demo. "Prod" = real multi-tenant, paying, under load.
> Status of features: P1 (auth) ✅, P2 (workspaces/KB/docs/ingest) ✅, scrape ✅, P3 (chat RAG + history + sources) ✅. Production-RAG: Stage 1a caching ✅, Stage 1b limits ✅ (both shipped 2026-06-30/07-01, this header was stale), Stage 2 RAGAS not started, Stage 3 LangGraph built but flag-off (`LANGGRAPH_ENABLED=false`). V2 batch (structured query + insights, `docs/ai/planning/v2-features.md`) shipped 2026-07-08, separate from this Stage 1-3 RAG-quality track.

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
| B1 | **Per-tenant rate limit + token/cost budget** | ✅ Updated 2026-07-08 (stale row — shipped 2026-07-01). `apps/api/src/limits/*`: per-user + per-workspace chat rate limits (Redis fixed-window per-minute counters, `429`) plus a monthly per-workspace token budget on miss-path generations only (`402` when exhausted). Both fail open on Redis errors. | Keep monitoring real usage against the configured caps once there's production traffic; no code gap remains. | ✅ | — |
| B2 | **Answer cache** | ✅ Updated 2026-07-08 (stale row — shipped 2026-06-30). Exact Redis cache + semantic pgvector (`chat_cache`) cache, both scoped by `workspaceId` + version, version bumped on document/ticket-chunk mutation, semantic rows also TTL-expired (`SEMANTIC_CACHE_TTL_HOURS`). | No gap remains for v1; revisit only if cache hit-rate observability (E3) surfaces a tuning need. | ✅ | — |
| B3 | **Crawl/ingest bounds** | ✅ maxDepth/maxPages clamps, per-workspace doc quota, robots/UA/throttle. | Keep; expose quotas per plan tier later. | 🟢 | — |
| B4 | **Embedding/LLM cost visibility** | LangSmith traces only. | Track cost per workspace (tokens × price); surface in admin; alert on spikes. | 🟠 | Prod |

## C. Reliability & ops

| # | Item | Current state | Action | Sev | Blocks |
|---|------|---------------|--------|-----|--------|
| C1 | **Backups** | None for Postgres (pgvector) or SeaweedFS. | Automated Postgres dumps + SeaweedFS volume backups; test restore. | 🔴 | Prod |
| C2 | **Health checks** | ✅ Updated 2026-07-08 (stale row — endpoint has existed since 2026-07-04). `GET /health` (`apps/api/src/health/health.controller.ts`) is live, dependency-free (deliberately not DB/Redis/S3-backed so it never false-fails a startup race), and is what Docker `HEALTHCHECK` directives and `.github/workflows/deploy.yml`'s healthcheck-poll actually consume today. | Consider a second, deeper `/health/ready` (DB + Redis + S3 ping) for readiness-vs-liveness distinction if a future orchestrator needs it — not needed for the current single-VPS Docker Compose deploy. | ✅ | — |
| C3 | **Error monitoring** | None. | Sentry (or similar) for API + web; alerting. | 🟠 | Prod |
| C4 | **Worker separation** | Bull `ingest-queue`/`scrape-queue` processors run IN the API process → ingest/crawl compete with chat latency. | Run a separate worker process/container for queues; scale independently. | 🟠 | Prod (load) |
| C5 | **Graceful shutdown** | Not handled. | `enableShutdownHooks`, drain Bull, close PG pool on SIGTERM. | 🟠 | Prod |
| C6 | **DB connection pooling** | `new Pool({ connectionString })` = default (max ~10); `dotenv` relative path. | Tune `max`/idle/timeouts for concurrency; consider PgBouncer; load-from-env robustly in prod. | 🟠 | Prod (load) |
| C7 | **Prod stack dry-run** | ✅ Updated 2026-07-08. Well past "not done": a live shared-VPS deploy exists (`mnemra.tyvera.app`), `.github/workflows/deploy.yml` auto-deploys push-to-`main` with DB backup + healthcheck-poll + S3 round-trip, and 4 real Docker/duckdb production bugs have already been found and fixed live on that deploy this week (see `docs/ai/risk-register.md` "Structured SQL Execution" Docker gaps #1-4, and the `.dockerignore`/`coverage` route-folder collision bug under "Production Deployment"). | Row kept 🟠 not ✅ because two 2026-06-30-era gaps are still genuinely open: no automated Postgres/SeaweedFS backup+restore test (C1), and CI does not gate merges (F3) — a bad `main` push still auto-deploys. | 🟠 | Prod |

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
| F1 | **Commit the work** | ✅ Updated 2026-07-08 (stale row — this was fixed weeks ago). Working on `development`, merged into `main` via PRs (`#1`-`#3` so far); every feature since P2 has landed as its own logical commit(s), pushed to `origin`. | Keep the discipline: no direct pushes to `main`, PR-per-feature/slice. | ✅ | — |
| F2 | **Lint tooling broken** | `bun run lint` → `eslint: command not found` (seen during slices). | Install/repair eslint config in each package so lint actually runs. | 🟠 | Prod |
| F3 | **CI** | Updated 2026-07-08 (stale row — `.github/workflows` is no longer absent, but it is a deploy pipeline, not a test-gate). `.github/workflows/deploy.yml` exists: push-to-`main` auto-deploys to the VPS (SSH, backup, build, healthcheck-poll, S3 round-trip) — it runs no type-check/lint/unit/e2e and does not gate the merge, it triggers *after* merge. | Add a separate PR-triggered workflow: type-check + lint + unit + e2e (with Postgres/Redis services) before merge is allowed — the deploy workflow should stay deploy-only. | 🟠 | Prod |
| F4 | **Staging env** | None. | A staging deploy mirroring prod for dry-runs. | 🟠 | Prod |
| F5 | **Dockerfile hardening** | `apps/{api,web}/Dockerfile` exist; not reviewed for non-root/multi-stage/size. | Review: multi-stage, non-root user, minimal base, pinned. | 🟢 | Prod |
| F6 | **Migration runner in deploy** | API container startup runs `db:migrate`; deploy scripts no longer call `db:push`. | Keep migrations as source of truth and avoid `push` in prod. | 🟢 | Prod |

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

**Updated 2026-07-08** — the original sequencing below assumed F1/C7/A1/A2/B1/B2/C2 were still open; all seven are now ✅ (see rows above), so the pre-demo gate is already cleared. Remaining pre-launch blockers, current as of this pass:

**Before real production launch (blockers):** C1 (backups — still genuinely not built), A4 (strong prod secrets — verify actual rotation, not just that the template exists), + A5–A9/C3–C6 hardening, D1 (RAGAS), F3 (PR-gating CI — the deploy workflow that exists is not a test gate), G1/G2 (PII/encryption), H1 (password reset), then A9 security review.

**Quality upgrades (post-launch):** Stage 3 LangGraph (D3), D2 feedback loop, F7b RAGAS-dependent coverage dashboard half (`docs/ai/planning/v2-features.md`), the 🟢 items.

Parallelizable now: A5, A6, A9, C3, C5, C6, H1 are small, isolated, and don't depend on RAGAS/LangGraph/backups work.
