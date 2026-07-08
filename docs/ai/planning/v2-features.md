# V2 Feature Batch — Structured Query & Insights

> **Purpose:** approved batch-level dependency, risk, and sequencing plan for the 7-feature v2 set. This is the standing reference for slice-by-slice implementation.
> **Load rule:** read this before planning or implementing any v2 slice (S1-S4, F1-F7a). Per-feature implementation still requires its own predict-then-verify pass + two-layer plan (Risk + Backward-Compat matrices) per CLAUDE.md Plan Contract — this doc does not replace those.
> **Source of truth rule:** map only, never proof. All file:line citations were verified 2026-07-08; re-verify against real source before relying on them. Code wins; drift here = `CONTEXT DRIFT`, fix in the same change.
> **Safety gates:** every slice inherits the Mnemra invariants (workspaceId filter on all tenant queries, 1536-dim embeddings, queue status integrity, budgets/rate limits never bypassed, packages/ui tokens). Deep slices need explicit approval before implementation.

**Status:** approved 2026-07-08 (batch plan).
- S3 (chat_query_metrics telemetry): **implemented 2026-07-08**, backend complete, tested, docs synced.
- S1+F1 (structured CSV querying): **implemented 2026-07-08**, backend and frontend complete, tested (datasets table+migration, dataset upload+profiling pipeline incl. XLSX-to-CSV conversion, hardened DuckDB execution engine, text-to-SQL chain, structured intent routing in ChatService, 4-state result contract rendered distinctly on the web chat page plus a dedicated Datasets management page). See `docs/ai/module-ownership-map.md` "Datasets / Structured Query" row and `docs/ai/risk-register.md` "Structured SQL Execution" for full detail. **Known gap (infra-only):** the API's Docker image can't currently run this feature — no Linux ARM64 prebuilt binary for `duckdb@1.4.4`, no build toolchain to compile from source; `bun run dev` locally is fully verified and unaffected.
- **Known infra gap:** Docker dev/prod API image cannot run DuckDB-dependent code — no Linux ARM64 prebuilt binary for `duckdb@1.4.4`, no build toolchain to compile from source. Base image fixed Alpine→Debian + `ca-certificates` fix landed regardless (real improvements). `bun run dev` locally is the verified working path; Docker fix needs a follow-up decision (build toolchain vs `linux/amd64` target vs different duckdb package).
- F3 through F7a: not started.
**User decisions locked at approval:** F2 = 2b (extend tickets schema: `category`, `resolved_at`, `assignee_id`); F6 = Slack + email both in batch.

---

## Reality checks — where the original feature sketch diverges from the code

1. `classifyQuery()` is an LLM-free keyword/length heuristic returning binary `'simple' | 'complex'` (`packages/ai/src/chains/classify.ts:45`). No intent taxonomy exists; the header comment anticipates a cheap-model fallback layer — that's the designed extension point.
2. The answer cache runs BEFORE any routing: `ChatService.answer` serves exact (Redis) then semantic (pgvector `chat_cache`) hits at `apps/api/src/chat/chat.service.ts:74-99` before `answerQuestion()` classifies anything. Structured-query intent must be decided pre-cache or re-uploaded CSVs serve stale computed answers.
3. LangGraph exists but is off (`LANGGRAPH_ENABLED=false`; graph at `packages/ai/src/chains/graph.ts:377-393`; no checkpointer; graded path buffers the answer — D3). Roadmap gate: "RAGAS before LangGraph, always."
4. LangSmith is a dead end for the digest: `withTracing` (`packages/ai/src/tracing/index.ts`) has zero call sites; nothing reads traces back. Digest sources = `workspace_events` + new chat telemetry (S3) + ticket aggregates.
5. Tickets table lacks `category`/`resolvedAt`/`assignee` (`packages/db/src/schema/tickets.ts:20-52`). Proxies: `productArea`≈category, `reviewedAt−createdAt` per `reviewedBy`≈resolution time. Decision 2b: extend the schema.
6. No scheduler exists (no `@nestjs/schedule`, no Bull `repeat:`). Weekly jobs are a net-new substrate; Bull ^4.12.0 supports repeatable jobs.
7. CSV is accepted at upload (`apps/api/src/documents/documents.controller.ts:48,65`) but `packages/ai/src/loaders/csv.ts` flattens rows to prose for embedding. Structured storage/querying is genuinely new.
8. No answer-level confidence: `AnswerResult = {sources, stream, isFallback}` (`packages/ai/src/chains/index.ts:48-52`); the graph's `grounded` boolean is computed then dropped.
9. Token budget undercounts: `addUsage` meters only user msg + answer + condense delta (`chat.service.ts:120-125`). Every new LLM call must fold its tokens into the budget — invariant.
10. Tenant isolation is hand-carried: `WHERE workspace_id = ${workspaceId}::uuid` in every retrieval query (`packages/ai/src/vectorstore/index.ts:103,149,166`); no RLS (prod-readiness A7). Every new SQL path replicates this by hand.
11. Single-process API: Bull processors run in-process with HTTP (C4). Heavy DuckDB/clustering jobs compete with chat latency.
12. RAGAS (D1) not built — offline harness at `scripts/eval/*` is planned-not-run. F7b sequences after D1.
13. Dev trap: run API via `bun run dev`, not the compiled build (compiled build crashes scrape/ticket queue jobs — TODOS.md).

---

## Shared infrastructure — build once, serve many

### S1 — Structured Query Engine (serves F1, F2, F5)
- **`datasets` table** (new, tenant-scoped): workspaceId, name, filename, storageKey, description, `description_embedding vector(1536)`, `columns_schema` jsonb (headers + inferred types), rowCount, contentHash + queue-lifecycle columns copied from `packages/db/src/schema/documents.ts:21-25` (`status/queueJobId/enqueuedAt/processingStartedAt/lastError`).
- **Dataset ingestion path**, separate from document chunking: Multer upload (reuse allowlist + `MAX_UPLOAD_MB`), `StorageService.save` with `${workspaceId}/...` keys, Bull profiling job (ingest-queue pattern incl. `onModuleInit` reconciliation) parsing headers/types via the papaparse machinery in `loaders/csv.ts`, then embedding the description. Dataset CSVs are NOT chunked into `chunks` — only the description embedding enters pgvector.
- **DuckDB execution service** (new apps/api module): per-query ephemeral — `StorageService.getToTempFile` (`apps/api/src/storage/storage.service.ts:71`) pulls the CSV, DuckDB loads in-memory, runs validated SQL, temp file cleaned in `finally`.
- **Text-to-SQL chain** in packages/ai: new `'sql'` model role via `resolveModel` (`packages/ai/src/chains/models.ts:24`).
- **Dataset selector**: pgvector cosine over `description_embedding`, hand-written SQL replicating the workspace guard exactly.
- **`StructuredQueryBackend` seam** (schema-describer + row-provider) from day one — three confirmed consumers (F1/F2/F5).
- **S1.0 go/no-go spike first (~half day)**: DuckDB is a native module; verify under Bun dev runtime AND compiled build (repo has a compiled-build-breaks-queues trap). Fallback: Postgres `TEMP` tables via COPY, same abstraction.

### S2 — Scheduler substrate (serves F3, F4, F6)
- **Bull repeatable jobs** (`repeat: {cron}`), not `@nestjs/schedule`: Bull already present, Redis-persistent, dedup by jobId, moves to a separate worker for free when C4 lands.
- Pattern: one repeatable "tick" per feature fans out one Bull job per workspace.
- **`background_runs` table** (new): workspaceId nullable, kind, status, startedAt/finishedAt, lastError, stats jsonb — anchors the status/lastError integrity invariant for jobs with no entity row.
- Concurrency 1 + off-peak windows initially; promote C4 (worker separation) to co-requisite hardening before F6 ships broadly.

### S3 — Retrieval-quality telemetry (serves F6, F7a; replaces the LangSmith assumption)
- **`chat_query_metrics` table** (new): workspaceId, sessionId, chatMessageId, standalone question, `question_embedding vector(1536)`, topScore, sourceCount, isFallback, cacheStatus, queryClass/intent, latencyMs, createdAt.
- **Write point**: `ChatService.answer` — sees cache status, the already-computed embedding (`chat.service.ts:86` — persist it free; powers F7a topic-gap clustering), and isFallback at onComplete. Fire-and-forget with `.catch` (telemetry never fails the request).
- Also the substrate for prod-readiness D2/E3/B4 and Stage-3 failure-pattern analysis.

### S4 — Insights read-models + dashboard shell (serves F3, F4, F6, F7a)
- New web route `apps/web/app/workspaces/[id]/insights` + API `InsightsModule` with read-only aggregate endpoints behind `JwtAuthGuard + WorkspaceMemberGuard` (+ owner/admin roles). Thin: shell + tab 1 ship with F3; later features add tabs. UI primitives exist (`StatCard`, `Table`, `Badge`, `EmptyState`).

### Shared primitive — ticket↔doc coverage (serves F3, F4)
Ticket embeddings already exist: one chunk per done+reviewed+useful ticket via `syncTicketChunk` (`packages/ai/src/vectorstore/index.ts:209`). Primitive: per qualifying ticket chunk, nearest document-chunk cosine within the workspace → covered/uncovered. F3 reads doc-centric, F4 ticket-centric. Scope flag: only reviewed-useful tickets have embeddings — widening is a separate, explicit cost decision.

---

## Cross-cutting design decisions

**Intent routing — outside the graph, decided in ChatService (pre-cache).** Extend `QueryClass` to `'simple' | 'complex' | 'structured'`; hoist the decision into `ChatService` so structured queries bypass both caches (same policy as never-cached fallback answers). Requires exporting `classifyQuery` from the `@repo/ai` barrel (additive). Detection ladder, cheap-first: keyword/aggregation heuristic → "workspace has any done datasets?" (indexed count) → cheap `'classify'` model role only when ambiguous. The structured pipeline is a plain linear pipeline (select dataset → text-to-SQL → validate → execute → verbalize → one repair retry), NOT a LangGraph — zero regression surface on the RAG graph. Structured answers emit through the same `AsyncGenerator<string>` contract (`chat.controller.ts:54`); ambiguous/correction UX states ride a new additive `X-`header (precedent: `X-Chat-Sources`, `X-Chat-Cache`).

**Text-to-SQL tenant isolation (Deep security surface).**
1. *Physical isolation*: ephemeral DuckDB for ALL structured backends. Datasets: instance only contains that workspace's file. Tickets (F2): trusted Drizzle code exports that workspace's rows (mandatory workspaceId filter) into the same ephemeral DuckDB — LLM-generated SQL never touches shared Postgres. Isolation enforced by trusted code, never by validating untrusted SQL.
2. *Engine hardening*: DuckDB can escape via `read_csv('/etc/passwd')`, `ATTACH`, `COPY TO`, extension installs. Required: `enable_external_access=false`, locked config, single-statement SELECT-only validation, statement timeout, memory cap, result row-limit.
Rejected: read-only Postgres role (cross-tenant within a table), SQL AST workspace-predicate validation (fragile vs CTEs/subqueries), template allowlists (kills the NL value prop; fallback posture only).

**Token accounting.** Structured path + every background LLM job returns auxiliary token counts folded into `addUsage`/budget. Background jobs: same monthly workspace budget, per-job caps, per-workspace kill switch — confirm per feature at predict-verify.

**F6 sources & transport (decision: Slack + email both).** Sources: `workspace_events`, `chat_query_metrics`, ticket aggregates, plus F3 flags/F4 drafts once they exist. Renderer = content model → format adapters (email HTML via Resend; Slack). Slack v1 = per-workspace incoming webhook URL (no OAuth app, no token store; settings UI field). Webhook URL is user-supplied — SSRF surface: reuse `packages/ai/src/web/ssrf.ts` before posting. Blockers before ship: Resend domain verification still open; ship behind env flag + logged fallback.

**F7 split.** F7a (in batch, S3-backed): fallback-rate/zero-source trends, low-topScore query list, cache hit rate, topic gaps = cluster persisted question embeddings of fallback/low-score queries, LLM-label clusters, rank by frequency. F7b (OUT of batch): RAGAS quality scores — after D1, honoring the roadmap gate. Token usage is Redis-only monthly counters — F7a v1 scopes to quality/coverage panels, not spend history.

---

## Per-feature summary

| # | Feature | Depends on | Key reuse (verified) | Genuinely new | Risk | Order |
|---|---|---|---|---|---|---|
| S3 | Telemetry substrate | — | chat.service.ts:74-137 choke point; embedding at :86 | `chat_query_metrics` + write hook | Standard (additive, fail-soft) | 1 |
| F1 | CSV querying | S1.0 spike, S1 | upload allowlist; getToTempFile:71; queue-lifecycle cols; csv.ts metadata; models.ts roles; classify.ts | datasets table, DuckDB svc + hardening, text-to-SQL, 3-way intent pre-cache, `'dataset'` ChatSource variant, 4-state UX | **Deep** (migration, job, untrusted SQL, chat path, cache policy) | 2 |
| F2 | Ticket trends (2b) | S1, F1 routing | S1 engine; tickets fields as dimensions | tickets backend (Drizzle export→DuckDB); migration `category`/`resolved_at`/`assignee_id` + extraction-prompt update + backfill strategy | **Deep** (hot-table migration + LLM SQL near PII — schema-only in prompts, never rows) | 3 |
| F3 | Freshness detector | S2, coverage primitive, S4 | ticket chunks (vectorstore:209); Bull+reconciliation idiom | `document_review_flags` table (N-per-doc, provenance, dismissal audit — NOT a boolean on documents), compare job, Insights tab 1 | **Deep** (jobs + migration); flag-only, never mutates docs; thresholds env-tunable | 4 |
| F4 | FAQ generator | S2, primitive, S4; after F3 soak | approval materializes FAQ as normal `documents` row → existing ingest + cache bumpVersion | `faq_drafts` table, TS threshold-clustering job, approval endpoints/UI | **Deep** (LLM content entering corpus — human-approval gate is a hard invariant; PII/prompt-injection in transcripts) | 5 |
| F5 | Cross-file compare | F1 shipped + soaked | entire S1 engine (selector→top-N, N temp files as N tables) | multi-select disambiguation UX, multi-table SQL + join repair | **Deep** (inherits engine surface); no migration | 6 |
| F6 | Digest (email+Slack) | S2, S3 data (weeks), Notifications | workspace_events; S3; ticket aggregates; Resend wiring; ssrf.ts | digest job (per-ws fan-out), content model + 2 renderers, `workspace_digest_settings` (incl. Slack webhook), preview endpoint, settings UI | **Deep** (external integration ×2, cross-workspace fan-out = tenant-isolation hot spot, Resend domain blocker) | 7 |
| F7a | Coverage dashboard | S3 data, S4 | chat_query_metrics incl. embeddings; StatCard/Table | rollup endpoints, gap-clustering job (weekly on S2), report UI | Standard-candidate (read-only, no migration) | 8 |
| F7b | RAGAS quality scores | **D1 (not built)** | scripts/eval harness | score persistence + eval-run ingestion | Deep; **out of batch, post-D1** | — |

## Migrations inventory (rollback scoping)

Continues from `0014` (existing 0000-0013). All additive (rollback = drop) except the flagged alter:

1. **S3**: `chat_query_metrics`
2. **S1/F1**: `datasets`
3. **F2 (2b)**: ⚠️ `ALTER tickets` + `category`, `resolved_at`, `assignee_id` — the one hot-table alter; nullable, non-destructive; ships with extraction-prompt update; backfill lazy/null-allowed
4. **S2**: `background_runs`
5. **F3**: `document_review_flags`
6. **F4**: `faq_drafts`
7. **F6**: `workspace_digest_settings`
8. *(batched when first needed)*: `workspace_event_type` enum extension — all new values in ONE migration

Embedding dimension stays 1536 everywhere. Zero destructive changes.

## Build order

```
0. S1.0  DuckDB-under-Bun spike (go/no-go, ~half day)
1. S3    telemetry table + ChatService hook      ← starts the data clock
2. S1+F1 structured CSV querying (single dataset)
3. F2    ticket trends incl. 2b migration slice
4. S2 + coverage primitive + F3 freshness + S4 shell (Insights tab 1)
5. F4    FAQ drafts + approval→ingest loop (tab 2)
6. F5    cross-file comparison (extends S1)
7. F6    weekly digest, email + Slack webhook
8. F7a   coverage dashboard (tab 3)          F7b: post-D1, out of batch
```

Rationale for deviations from original 1-7 priority: S3 first (data accrual makes F6/F7a good later); F5 below F3/F4 (avoid three consecutive chat-path changes without soak); F6 late (wants S2 + S3 data + F3/F4 content; carries Resend + Slack blockers). Two-track option: Track A (chat) S1→F1→F2→F5; Track B (batch/insights) S3→S2→F3→F4→F6→F7a; sync points: S3 before F6/F7a, S4 shell built once.

## Roadmap interlock

- Gates respected: P1-3 shipped; "RAGAS before LangGraph" untouched (routing lives outside the graph); F7b after D1.
- S3 partially discharges E3/B4; S2 sharpens C4; F6 inherits the Resend domain open item; A7 (no RLS) is why every new SQL path hand-carries the workspace filter.
- docs/ai sync obligations as slices land: add module-ownership rows (Datasets/Structured Query; Insights/Analytics; Digest), risk-register rows (Structured SQL Execution; Scheduled Jobs; Digest Delivery), repository-map entries for new symbols — same-change, per Documentation Sync Rule.

## Per-feature open points (resolve at each predict-then-verify pass)

- **F1**: cache policy final call (bypass vs version-bump); 4-state UX header contract; DuckDB hardening checklist.
- **F2**: who/what sets `resolvedAt`/`assigneeId` (extraction can infer `category`; assignee/resolution are workspace-user facts — likely PATCH/review flow, not the LLM); backfill approach.
- **F3**: freshness comparison method (embedding-distance heuristic vs LLM compare) + threshold defaults; false-positive tolerance.
- **F4**: cluster threshold + minimum cluster size; draft-prompt PII handling.
- **F6**: budget caps for background LLM; digest cadence/timezone.
- **F7a**: gap-cluster labeling cost cap; v1 panel set.

## Process per slice

User prediction (Learning Contract) → two-layer plan (Risk + Backward-Compat matrices) → explicit approval (Deep) → TDD implementation → docs/ai sync in same change → Quality Gate.
