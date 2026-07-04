# Risk Register

Purpose:

Map high-risk project areas.

This file is map only.

It is not proof of behavior.

If task touches listed high-risk area, default to Deep.

Only downgrade Deep if repository evidence proves task is isolated and low-risk.

Verify risk against source code and related contracts.

If risk area is missing, mark `UNMAPPED RISK`.

---

## Risk Areas

| Risk Area              | Why Risky                                    | Default Task Size | Required Checks                        | Manual QA              | Notes                                    |
| ---------------------- | -------------------------------------------- | ----------------- | -------------------------------------- | ---------------------- | ---------------------------------------- |
| Billing                | Revenue impact, customer trust               | Deep              | DB invariants, mutation paths, tests   | Full billing flow      | Verify against DB contracts              |
| Payments               | Financial transactions, compliance           | Deep              | Transaction safety, rollback, tests    | Full payment flow      | Verify against DB contracts              |
| SMS Credits            | Resource billing, cost control               | Deep              | Credit balance invariants, tests       | Credit flow            | Verify against DB contracts              |
| Plan Upgrades          | Subscription state, feature access           | Deep              | Plan state invariants, tests           | Upgrade/downgrade flow | Verify against DB contracts              |
| Auth / Permissions     | Security, access control                     | Deep              | Auth flows, permission checks, tests   | Full auth flow         | Verify against auth middleware           |
| Workspaces / RBAC      | Tenant boundary, member removal, invite misuse | Deep            | Membership invariants, guard order, tests | Invite/member flow  | Enforce RBAC server-side; keep ≥1 owner per workspace; single-use invite token with expiry |
| Automations            | Background behavior, side effects            | Deep              | Job safety, idempotency, tests         | Automation trigger     | Verify against job queue contracts       |
| Jobs                   | Background processing, retry logic           | Deep              | Queue safety, idempotency, tests       | Job execution          | Verify against job queue contracts       |
| Webhooks               | External integrations, failure handling      | Deep              | Webhook safety, retry, tests           | Webhook flow           | Verify against integration contracts     |
| Database Migrations    | Schema changes, data integrity               | Deep              | Migration safety, rollback, data check | Pre/post migration     | Verify against migration tooling         |
| Transactions           | Data consistency, atomicity                  | Deep              | Transaction boundaries, rollback       | Transactional flow     | Verify against DB contracts              |
| External Integrations  | Third-party dependencies, failure modes      | Deep              | Error handling, retry, tests           | Integration flow       | Verify against integration documentation |
| Production Deployment  | Availability, rollback, monitoring           | Deep              | Deploy safety, rollback plan           | Smoke test             | Verify against deployment docs           |
| Workspace Events       | Shared cross-job write hooks plus per-member unread state | Standard | Job terminal-state safety, membership-row scoping, tests | Upload/crawl/extract then inspect feed/badge | Event recording must never fail or retry ingest/scrape/ticket jobs; `events_seen_at` updates only caller row |
| Search                 | Cross-workspace retrieval leaks, mixed retrieval mechanisms | Standard | Workspace scoping, grouped response shape, tests | Search docs/tickets/chat in 2 workspaces | Documents use vector chunk search while tickets/chat use full-text; scores are not comparable and must stay in separate arrays |
| Unbounded List Responses | Every list-returning endpoint (workspaces, knowledge bases, documents, chat sessions, chat messages, scrape runs, tickets) returns full unbounded arrays with no limit/offset/cursor; documents can approach the 5000/workspace quota, tickets/chat-sessions/scrape-runs have no cap at all | Deep for Documents/Chat/Tickets/Scraping (matches their existing domain risk), Standard for Workspaces/Knowledge Bases | Keyset/offset correctness under concurrent insert/delete, response-shape contract change on list endpoints, proxy query-string forwarding | Paginate through a seeded large list and confirm no skipped/duplicated rows across pages | Found during 2026-07-01 production-readiness audit. Workstream A shipped on 2026-07-01: all 7 endpoints used keyset cursor pagination. 2026-07-04 workspace UX slices began the offset contract shift: members, documents, and scrape runs now return `{items,page,pageSize,total,totalPages}` with query-string passthrough. Remaining keyset rows are intentional until their slices land. |
| Document Download Streaming | Member-readable document list now has matching single/bulk download endpoints that read object storage and stream bytes/zip through API + web proxy | Deep | Route-scope verification before storage read, missing object handling, zip response headers, raw proxy passthrough, memory pressure on large selected sets | Download one file and two selected docs from a seeded KB as member; verify foreign IDs are skipped/not leaked | Slice 1 (2026-07-04) adds `StorageService.getBuffer()`, `GET .../documents/:documentId/download`, and `POST .../documents/download`. Current implementation buffers file bodies before response/zip; acceptable for current upload cap but revisit streaming/temp-file zip if bulk download size grows. |

## Current Notes

- Docker/CI hardening + Mnemra rebrand (2026-07-04): local dev is now fully containerized
  (`docker compose up` runs postgres/redis/seaweedfs/api/web with hot reload, replacing the
  former host-based `bun run dev` + infra-only-Docker split via the now-deleted `scripts/dev.sh`).
  Production `docker-compose.prod.yml` fixed three real bugs found during discovery, not just
  documentation drift: (1) `apps/api/Dockerfile`/`apps/web/Dockerfile` referenced a nonexistent
  `bun.lockb` instead of the repo's actual `bun.lock`, silently breaking every prod image build;
  (2) `docker/seaweedfs/s3.prod.json` was bind-mounted but never existed on disk, breaking a fresh
  `docker compose -f docker-compose.prod.yml up`; (3) `env_file:` pointed at a template rather than a
  real-secrets file, risking a deploy running with placeholder values (`CHANGE_ME_STRONG_PASSWORD`,
  `your-domain.com`). Env model has since been unified: dev and prod compose both `env_file: .env`
  (single gitignored file, `cp .env.example .env`), which Compose also auto-reads for `${VAR}`
  interpolation; the deploy workflow reads `.env` for `DOMAIN` without shell-sourcing it, so the former
  `DEPLOY_DOMAIN` GitHub Secret is no longer used. Added
  `depends_on: condition: service_healthy` wiring for api/web/caddy (previously only infra services
  had healthchecks) plus a dependency-free `GET /health` endpoint
  (`apps/api/src/health/health.controller.ts`) consumed by both the new prod `HEALTHCHECK`
  directives and the new `.github/workflows/deploy.yml` auto-deploy healthcheck-poll. Also
  completed the in-progress "Second Brain" → "Mnemra" rebrand across browser UI, docs, and
  Docker/DB naming (`support_brain` → `mnemra`).
  Docker cache/perf follow-up (2026-07-04): `.dockerignore` now recursively excludes nested
  build outputs and dependency folders (`**/node_modules`, `**/.next`, `**/dist`, `**/build`,
  `**/.turbo`, `**/*.tsbuildinfo`, `.gstack`) so Docker does not send stale local artifacts in
  the build context. Web's build graph is source-verified as `@repo/web` + `@repo/ui`; API's graph
  is `@repo/api` + `@repo/ai` + `@repo/db`. Dockerfiles use Bun install cache mounts, Turbo build
  cache mounts, and filtered installs. Dev images no longer prebuild package `dist` files that
  bind mounts hide at runtime; API/Web dev entrypoints now repair stale named `node_modules`
  volumes by rerunning filtered `bun install` when lockfile/package manifests are newer than
  app-specific stamp files, or when required runtime deps such as `archiver`/`next` are missing.
  API dev also conditionally rebuilds only stale/missing `@repo/db`/`@repo/ai` package output
  before `db:migrate`. The Bun Alpine base image has no real
  `node`; container repro showed `nest build`/`swc` hanging under Bun's Node shim, so API/Web
  Dockerfiles install `nodejs` and production uses Node for API/Next standalone startup. Web runner
  copies the filtered web `node_modules` from the deps stage because Bun workspace installs do not
  leave `next` inside `.next/standalone`, and `server.js` requires it at runtime. Bun and Turbo cache
  mounts use locked app-specific ids so a corrupt package tarball in one cache does not poison another service build. Prod compose keeps `api`/`web` ports internal to Compose,
  scopes `env_file: .env` to app services only. Bundled Caddy is now opt-in with
  `COMPOSE_PROFILES=public` so the app can deploy on a shared VPS where another service already
  owns host ports `80`/`443`.
  Deploy scripts preserve cache, do not `docker compose down` before replacement, and use
  `--remove-orphans --force-recreate` so regenerated env/config bind mounts are actually reloaded
  by long-running containers.
  Local `docker-compose.yml` overrides API `S3_*` values to match `docker/seaweedfs/s3.json`
  (`mnemra-local` / `mnemra-local-secret`) so production S3 keys in `.env` cannot break local
  SeaweedFS authentication.
  Prod compose must never publish app/internal service host ports (`3000`, `3001`, `5432`, `6379`,
  `8333`, `8888`, `9333`) because Suki/Tyvera already uses `3000`/`3001` on the same target class;
  bundled Caddy must stay disabled unless this app owns host `80`/`443`. Local Mnemra dev publishes web/API on
  `3100`/`3101` by default (`MNEMRA_WEB_PORT`/`MNEMRA_API_PORT`) to avoid Suki's local ports.
  Required checks:
  - Turbo dry graph for web is exactly `@repo/web`, `@repo/ui`; Turbo dry graph for API is exactly `@repo/api`, `@repo/ai`, `@repo/db`
  - `docker compose build api web` and `docker compose -f docker-compose.prod.yml build api web` both succeed locally as dry runs before trusting a live VPS deploy
  - `docker compose config --quiet` and prod `docker compose ... config --quiet` with required env set both pass
  - `apps/api`'s `/health` returns `200 {"status":"ok"}` with zero dependencies reachable (verifies it never false-fails the container `HEALTHCHECK` during startup race windows)
  - GitHub Actions `deploy.yml` requires `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`/`VPS_PORT` secrets configured on `OwlRepo/mnemra` before the auto-deploy path can run; it reads `DOMAIN` from the VPS `.env`, not a separate domain secret
  - prod API/Web health checks must run inside containers (`docker compose exec -T api/web wget ...`) because their ports are not host-published
  - when `COMPOSE_PROFILES=public` enables bundled Caddy, public Caddy routes must send all browser traffic to `web:3000`; Next.js owns same-origin `/api/*` proxy route handlers and forwards server-side to `api:3001`
  - when `COMPOSE_PROFILES` does not include `public`, deploy scripts must remove any stale `mnemra-prod-caddy` container before `up` so a previous Caddy run cannot keep colliding with shared host ingress
  - `scripts/ensure-seaweedfs-s3-config.sh` must rewrite `docker/seaweedfs/s3.prod.json` from non-placeholder `S3_ACCESS_KEY`/`S3_SECRET_KEY` in `.env` before prod `up`, and the deploy path must force-recreate services plus run an S3 round-trip from inside `api`, or the `seaweedfs` service bind-mount/auth can drift from the API env
  - generated prod SeaweedFS identity JSON must remain container-readable (`0644` today) because the `chrislusf/seaweedfs` image runs the service as uid/gid `1000` and Docker Desktop may mount host files as `root:root`
  - no live production data existed anywhere under the old `support_brain` name at the time of this change (confirmed with the project owner) — if that assumption is ever wrong for a specific deploy target, stop and reconcile via `pg_dump`/restore before cutting over, per the rollback notes in the implementation plan

- SeaweedFS / S3-compatible storage is a live external-integration risk as of Slice 3A.
  Required checks:
  - container comes up and S3 endpoint responds
  - `StorageService.ensureBucket()` is idempotent
  - save/get/delete round-trip passes against the real endpoint
  - `StorageService.getBuffer()` returns exact stored bytes for download paths

- Migration `0001_panoramic_spiral.sql` changes document storage semantics.
  Required checks:
  - `documents.storage_key` exists after apply
  - `chunks.document_id` FK includes `ON DELETE CASCADE`
  - rerunning schema generation shows no diff

- Documents / ingest queue is a live jobs risk as of Slice 3B.
  Required checks:
  - upload creates SeaweedFS object + `documents.status='pending'`
  - enqueue failure after row insert marks the document terminal `failed` with `lastError`
  - Bull job uses retry `attempts=3` with exponential backoff
  - deterministic Bull job id is `ingest:{documentId}`
  - processor always cleans temp files in `finally`
  - processor writes terminal `done` or `failed`, never leaves stuck `processing` on handled errors
  - startup reconciliation fails stale `pending` rows after 2 minutes and stale `processing` rows after 30 minutes when Bull no longer has the job
  - `syncChunks()` receives tenant metadata and document/workspace ids

- OpenAI embeddings are now in the document ingest critical path.
  Required checks:
  - upload path does not require a working OpenAI key to return `201 pending`
  - embed failure isolates to the document row (`status='failed'`) and does not crash the worker
  - retry remains safe because chunk sync is content-hash diff based

- Priority 2 workspace/knowledge-base/document pages now poll document status client-side.
  Required checks:
  - `setInterval` is created only while at least one document is `pending` or `processing`
  - the interval is cleared on unmount/navigation so route changes do not leak background polling
  - 401s from any workspace/KB/document page route back to `/login`

- Web crawling for knowledge-base sources is a live jobs + external-integration + quota risk as of 2026-06-30.
  Required checks:
  - crawler stays same-origin, honors robots.txt, sets explicit User-Agent, throttles requests, and caps depth/pages
  - seed URL is rejected before queueing when hostname/IP/DNS resolution points to private or internal targets
  - when `includePrefixes` is omitted, crawl scope defaults to the seed subtree and `/.../home` seeds widen to their parent section
  - enqueue failure after row insert marks the scrape run terminal `failed` with `error`
  - deterministic Bull job id is `scrape:{runId}`
  - each fetched page URL is revalidated against the same SSRF guard before any network fetch
  - crawler tests never hit live network (`fetchImpl` injected)
  - `scrape_runs` always reaches terminal `completed` or `failed`, never hangs in `running` on handled errors
  - startup reconciliation fails stale `queued` rows after 2 minutes and stale `running` rows after 30 minutes when Bull no longer has the job
  - startup reconciliation also fails `running` rows after 5 minutes with no `lastProgressAt` heartbeat
  - page-level crawl persistence failures increment `pagesFailed` without aborting whole run
  - live crawl progress updates persist `pagesFound/pagesSucceeded/pagesFailed` during the run instead of only at the end
  - workspace doc quota clamps `maxPages` before queueing
  - duplicate in-flight crawl requests for the same workspace + KB + seed URL reuse the existing run instead of inserting a second queued row
  - recrawl of same page upserts one `documents` row by `(knowledge_base_id, source_url)` and reuses ingest safely
  - web page polls crawl runs every 3 seconds only while a run is `queued` or `running`
  - web page disables crawl submit while the POST is in flight and surfaces duplicate-run reuse clearly
  - crawl-row UI must keep terminal status separate from page-level counts (`Found` / `Queued` / `Page errors`) so ongoing runs are not mistaken for failed runs
  - scrape modal must autofocus URL input and keep focus while typing through rerenders
  - document queue UI must show truthful in-flight counts (`pending`/`processing`) rather than total documents as “in queue”

- Document upload ingress is a live DoS + parser-safety risk as of 2026-07-01.
  Required checks:
  - multipart uploads reject payloads above `MAX_UPLOAD_MB` before storage/ingest
  - upload allowlist matches supported loader extensions/MIME types only
  - unsupported extensions/MIME return `400`; oversized uploads return `413`
  - small allowed uploads still return `201 pending`

- Workspace chat / RAG is a live tenant-isolation + history-privacy risk as of 2026-06-30.
  Required checks:
  - backend route stays nested under `:workspaceId` with `JwtAuthGuard` + `WorkspaceMemberGuard`
  - retrieval only uses guarded route `workspaceId`, never body-supplied tenant identifiers
  - ticket chunks below `TICKET_SLOT_MIN_SCORE` never get force-included, reserved ticket chunks never exceed `TICKET_SLOT_RESERVE`, and total retrieved chunk count never exceeds caller `limit`
  - session/message reads filter by both `workspaceId` and owning `userId`
  - web proxy never forwards raw OpenAI credentials or calls OpenAI from browser-facing API routes
  - plain-text stream keeps citations out of token body; sources persist on assistant message for reload-safe history
  - citations correctly discriminate document vs ticket sources in both straight-line and LangGraph paths
  - legacy persisted `sources` without `sourceType` still render as document citations in FE history/cache reads
  - markdown rendering stays safe (no raw HTML execution) while preserving basic formatting such as bold text, lists, links, and code blocks
  - full-width chat rows still cap inner text width for readability rather than stretching prose edge-to-edge

- Answer caching on workspace chat is a live tenant-isolation + staleness risk as of 2026-06-30.
  Required checks:
  - exact cache keys include `workspaceId` and current version
  - semantic cache lookup filters by both `workspaceId` and `version`
  - semantic cache rows older than `SEMANTIC_CACHE_TTL_HOURS` are never served as hits even when version still matches
  - first cache version bootstraps to `1`; invalidation bumps move to `2+` so old exact keys go dark
  - document ingest `done` and document delete both call `cache.bumpVersion(workspaceId)`
  - ticket-driven chunk changes (`syncTicketChunk` outcomes `embedded`/`deleted`) also bump workspace cache version, including backfill path once per changed workspace
  - fallback/insufficient-info responses (`isFallback: true`) never get written to either cache layer, in both straight-line and LangGraph paths
  - semantic-cache writes opportunistically delete that workspace's expired rows without blocking successful cache writes if cleanup fails
  - Redis/cache failures fail soft to normal chat answers; cache outage must not 500 chat
  - optional `X-Chat-Cache` header reflects `exact|semantic|miss` for observability/tests

- RAG performance changes (2026-07-03) carry answer-quality regression risk; each is behind an env flag defaulting to prior behavior, roll out one at a time.
  Required checks:
  - streaming vs grading: confident answers stream and skip self-grade; only low-confidence (top score < `SELF_GRADE_MIN_SCORE`) take buffered generate→grade→regenerate. Unset `SELF_GRADE_MIN_SCORE` = grade every answer (legacy)
  - query routing: `classifyQuery()` must not send troubleshooting/procedural questions down the light path; simple path uses `SIMPLE_QUERY_CHUNK_LIMIT` and skips rewrite/grade
  - question integrity: generation/grading use `originalQuestion`; only `retrievalQuery` is rewritten
  - embedding reuse: `precomputedEmbedding` is only reused for the first retrieval; a rewrite re-embeds the new query
  - context budget: `buildEvidencePack()` output token count stays within `RAG_CONTEXT_TOKEN_BUDGET`, highest-scored chunks kept
  - migration `0011_sticky_scream` is additive (columns + btree/hnsw indexes + backfill), reversible by dropping them; hnsw requires pgvector ≥ 0.5 (installed 0.8.3)
  - retrieval metadata filters are NOT yet exposed via `ChatDto` because the exact/semantic cache key does not include filters — must be added to the cache key before exposing per-request filters

- Chat rate/budget controls are a live abuse + cost risk as of 2026-07-01.
  Required checks:
  - per-user and per-workspace counters key by minute bucket and caller/workspace ids
  - rate-limit guard runs on every chat POST, including cache hits
  - monthly token budget applies only to miss-path generations, never cache hits
  - Redis counter failures fail open and log warnings instead of blocking support agents
  - `429` and `402` response behaviors stay covered in unit/e2e tests

- Conditional LangGraph on chat miss path is a live quality + cost risk as of 2026-07-01.
  Required checks:
  - `LANGGRAPH_ENABLED` defaults `false` and disables agentic path instantly
  - high-score retrieval path does not add rewrite/self-grade calls
  - low-score path caps rewrites with `MAX_QUERY_REWRITES` then falls back cleanly
  - `SELF_GRADE_ENABLED` stays off by default because it can double generation cost
  - retrieval and sources remain scoped to `workspaceId` through every branch

- Offline RAGAS harness is a live measurement-process risk as of 2026-07-01.
  Required checks:
  - eval harness stays outside app runtime and never runs per request
  - dataset rows keep `question`, `answer`, `contexts`, `ground_truth` schema
  - weekly run records JSON output and lowest metric so prompt/retrieval fixes have evidence

- Ticket copilot is a live tenant-isolation + queue-reliability + extraction-quality risk as of 2026-07-01.
  Required checks:
  - backend routes stay nested under `:workspaceId` with `JwtAuthGuard` + `WorkspaceMemberGuard`
  - exact transcript dedup scopes by both `workspaceId` and `transcriptHash`, with DB unique enforcement to close concurrent-create races
  - create path stores transcript before enqueue and job payload carries only `ticketId`
  - queue enqueue failure after row insert marks ticket terminal `failed` with `lastError`
  - startup reconciliation fails stale `pending` rows only after pending grace exceeds the 5-minute job timeout, and fails stale `processing` rows after 30 minutes when Bull no longer has the job
  - extraction completion never overwrites a row that already left `pending|processing` due to human review or future retries
  - extraction failures surface as ticket `failed` state and web failure banner, never raw 500 to user
  - patch/save stamps `reviewedBy` and `reviewedAt`, preserving auditability for copied Linear tickets
  - review-save embedding sync only qualifies `done + reviewedBy + usefulness='useful'` tickets, and useful→not_useful transitions remove the ticket chunk
  - `syncTicketChunk` failures never fail the review-save request; backfill re-run stays idempotent
  - PATCH validators cap large free-text fields before they can bloat row size or API memory
  - usefulness/edit-state feedback stays queryable for dashboard usefulness-rate observability

- Workspace Events are a live jobs + tenant-state risk as of 2026-07-02.
  Required checks:
  - every terminal processor hook (`ingest`, `scrape`, `ticket-extraction`) wraps `events.record(...)` in `.catch(...)`
  - event-record failure never changes job terminal DB update or retry behavior
  - unread count uses caller membership row only and treats `events_seen_at IS NULL` as "all unread"
  - viewing Overview marks events seen once per visit and clears the sidebar badge on next load

- Search is a live tenant-isolation + relevance-shape risk as of 2026-07-02.
  Required checks:
  - `GET /workspaces/:workspaceId/search` stays behind `JwtAuthGuard` + `WorkspaceMemberGuard`
  - document results fetch `documents` rows scoped to route `workspaceId`, even if a chunk hit references another workspace document id
  - ticket full-text search filters `tickets.workspace_id = :workspaceId`
  - chat full-text search joins `chat_sessions` because `chat_messages` has no `workspace_id`
  - response shape stays `{documents, tickets, chatMessages}` and never becomes one merged ranking
  - shared search modal autofocuses query input on open and never steals focus back while results rerender
