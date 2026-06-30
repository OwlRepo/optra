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

## Current Notes

- SeaweedFS / S3-compatible storage is a live external-integration risk as of Slice 3A.
  Required checks:
  - container comes up and S3 endpoint responds
  - `StorageService.ensureBucket()` is idempotent
  - save/get/delete round-trip passes against the real endpoint

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
  - session/message reads filter by both `workspaceId` and owning `userId`
  - web proxy never forwards raw OpenAI credentials or calls OpenAI from browser-facing API routes
  - plain-text stream keeps citations out of token body; sources persist on assistant message for reload-safe history

- Answer caching on workspace chat is a live tenant-isolation + staleness risk as of 2026-06-30.
  Required checks:
  - exact cache keys include `workspaceId` and current version
  - semantic cache lookup filters by both `workspaceId` and `version`
  - first cache version bootstraps to `1`; invalidation bumps move to `2+` so old exact keys go dark
  - document ingest `done` and document delete both call `cache.bumpVersion(workspaceId)`
  - Redis/cache failures fail soft to normal chat answers; cache outage must not 500 chat
  - optional `X-Chat-Cache` header reflects `exact|semantic|miss` for observability/tests

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
